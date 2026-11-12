import { getAccountSeq } from "./account";
import { readConfig } from "./config";
import { createMockRealized } from "./mock";
import { getPortfolioService } from "./portfolioService";
import { getProxy } from "./proxy";
import {
	computeRealized,
	createTransactionsCache,
	maskRealized,
} from "./realized";
import { redact } from "./redact";
import { getTossClient } from "./tossClient";

const globals = globalThis as typeof globalThis & {
	__transactionsCache?: ReturnType<typeof createTransactionsCache>;
};
export async function realizedResponse(masked: boolean) {
	const headers = { "Cache-Control": "private, max-age=30" };
	try {
		const config = readConfig();
		const proxy = getProxy(config);
		if (proxy)
			return Response.json(await proxy.getRealized(masked), { headers });
		if (config.mock) {
			const data = createMockRealized();
			return Response.json(masked ? maskRealized(data) : data, { headers });
		}
		globals.__transactionsCache ??= createTransactionsCache({
			path: config.transactionsPath,
			fetchPage: async (query) =>
				getTossClient().getTransactions(await getAccountSeq(), query),
		});
		const [rows, portfolio] = await Promise.all([
			globals.__transactionsCache.read(),
			getPortfolioService().getPortfolio(),
		]);
		const data = computeRealized(
			rows,
			portfolio.holdings,
			portfolio.fx?.midRate ?? null,
		);
		return Response.json(masked ? maskRealized(data) : data, { headers });
	} catch {
		return Response.json(
			{ error: redact("실현 손익을 불러오지 못했어요.") },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
