import type { IntradayData } from "../lib/types";
import { type Now, readConfig } from "./config";
import { createMockRaw, mockIntraday } from "./mock";
import { getProxy, proxyFailure } from "./proxy";
import { getTossClient, type TossClient } from "./tossClient";

export const intradayHeaders = { "Cache-Control": "private, max-age=30" };
const noStore = { "Cache-Control": "no-store" };

export interface IntradayHolding {
	symbol: string;
	market: "KR" | "US";
	lastPrice: number;
	previousClose: number | null;
}

async function lookupIntradayHolding(
	symbol: string,
): Promise<IntradayHolding | null> {
	const config = readConfig();
	if (config.mock) {
		const item = createMockRaw().holdings?.items.find(
			(row) => row.symbol === symbol,
		);
		if (!item) return null;
		const last = Number(item.lastPrice);
		const rate = Number(item.dailyProfitLoss.rate);
		return {
			symbol: item.symbol,
			market: item.marketCountry,
			lastPrice: last,
			previousClose:
				Number.isFinite(rate) && rate > -1 ? last / (1 + rate) : null,
		};
	}
	const { getPortfolioService } = await import("./portfolioService");
	const row = (await getPortfolioService().getPortfolio()).holdings.find(
		(holding) => holding.symbol === symbol,
	);
	if (!row) return null;
	return {
		symbol: row.symbol,
		market: row.market,
		lastPrice: row.lastPrice,
		previousClose:
			row.quantity > 0 ? row.lastPrice - row.dailyPl / row.quantity : null,
	};
}

export function createIntradayService(options: {
	mock: boolean;
	lookup: (symbol: string) => Promise<IntradayHolding | null>;
	getIntraday: TossClient["getIntraday"];
	now?: Now;
}) {
	const now = options.now ?? Date.now;
	const cache = new Map<string, { data: IntradayData; expires: number }>();
	const pending = new Map<string, Promise<IntradayData>>();
	const waiting: (() => void)[] = [];
	let active = 0;

	async function download(holding: IntradayHolding): Promise<IntradayData> {
		if (active >= 2)
			await new Promise<void>((resolve) => waiting.push(resolve));
		else active++;
		let data: IntradayData = {
			previousClose: holding.previousClose,
			points: [],
		};
		try {
			// Toss caps each /candles page at 200; the client pages with
			// `before` until the latest exchange session is covered.
			const points = await options.getIntraday(holding.symbol, {
				count: 200,
				market: holding.market,
			});
			if (points.length)
				data = { previousClose: holding.previousClose, points };
		} catch {
			// Cache a miss without logging transport details or holdings.
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
		cache.set(holding.symbol, {
			data,
			expires: now() + (data.points.length ? 60_000 : 30_000),
		});
		return data;
	}

	return {
		async respond(symbol: string) {
			if (!symbol) return new Response(null, { status: 400, headers: noStore });
			let holding: IntradayHolding | null;
			try {
				holding = await options.lookup(symbol);
			} catch {
				return proxyFailure();
			}
			if (!holding)
				return new Response(null, { status: 404, headers: noStore });
			if (options.mock) {
				const previousClose = holding.previousClose ?? holding.lastPrice;
				const data: IntradayData = {
					previousClose,
					points: mockIntraday(
						holding.symbol,
						holding.market,
						previousClose,
						holding.lastPrice,
						now(),
					),
				};
				return Response.json(data, { headers: intradayHeaders });
			}
			const hit = cache.get(symbol);
			if (hit && hit.expires > now())
				return Response.json(hit.data, { headers: intradayHeaders });
			let promise = pending.get(symbol);
			if (!promise) {
				promise = download(holding).finally(() => pending.delete(symbol));
				pending.set(symbol, promise);
			}
			return Response.json(await promise, { headers: intradayHeaders });
		},
	};
}

export type IntradayService = ReturnType<typeof createIntradayService>;
const globals = globalThis as typeof globalThis & {
	__tossIntraday?: IntradayService;
};
export function getIntradayService(): IntradayService {
	if (!globals.__tossIntraday) {
		const config = readConfig();
		globals.__tossIntraday = createIntradayService({
			mock: config.mock,
			lookup: lookupIntradayHolding,
			getIntraday: (symbol, options) =>
				getTossClient().getIntraday(symbol, options),
		});
	}
	return globals.__tossIntraday;
}

export async function intradayResponse(symbol: string) {
	const proxy = getProxy();
	if (proxy) {
		let rows: { symbol: string }[];
		try {
			rows = await proxy.getHoldings();
		} catch {
			return proxyFailure();
		}
		if (!symbol || !rows.some((row) => row.symbol === symbol))
			return new Response(null, {
				status: symbol ? 404 : 400,
				headers: noStore,
			});
		return Response.json(await proxy.getIntraday(symbol), {
			headers: intradayHeaders,
		});
	}
	return getIntradayService().respond(symbol);
}
