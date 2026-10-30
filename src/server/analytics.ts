import type { AnalyticsData } from "../lib/types";
import {
	type CandleCache,
	type CandleHolding,
	currentCandleHoldings,
	getCandleCache,
} from "./candles";
import type { Now } from "./config";
import { getHistoryService, type HistoryService } from "./history";
import { getProxy } from "./proxy";

export const analyticsHeaders = { "Cache-Control": "private, max-age=300" };
export function createAnalyticsService(options: {
	getHoldings: () => Promise<readonly CandleHolding[]>;
	candles: CandleCache;
	history: HistoryService;
	now?: Now;
}) {
	return {
		async respond() {
			const [candles, history] = await Promise.all([
				options
					.getHoldings()
					.then((rows) => options.candles.read(rows))
					.catch(() => ({})),
				options.history.read().catch(() => ({ benchmarks: {}, usdkrw: [] })),
			]);
			const data: AnalyticsData = {
				fetchedAt: new Date((options.now ?? Date.now)()).toISOString(),
				candles,
				...history,
			};
			return Response.json(data, { headers: analyticsHeaders });
		},
	};
}
export async function analyticsResponse() {
	const proxy = getProxy();
	if (proxy)
		return Response.json(await proxy.getAnalytics(), {
			headers: analyticsHeaders,
		});
	return createAnalyticsService({
		getHoldings: currentCandleHoldings,
		candles: getCandleCache(),
		history: getHistoryService(),
	}).respond();
}
