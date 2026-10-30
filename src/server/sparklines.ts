import {
	type CandleCache,
	type CandleHolding,
	currentCandleHoldings,
	getCandleCache,
} from "./candles";
import { getProxy } from "./proxy";

export const sparklineHeaders = { "Cache-Control": "private, max-age=300" };
export function createSparklineService(options: {
	getHoldings: () => Promise<readonly CandleHolding[]>;
	candles: CandleCache;
}) {
	return {
		async respond() {
			try {
				const series = await options.candles.read(await options.getHoldings());
				return Response.json(
					Object.fromEntries(
						Object.entries(series).map(([symbol, points]) => [
							symbol,
							points.slice(-30).map((point) => point.close),
						]),
					),
					{ headers: sparklineHeaders },
				);
			} catch {
				return Response.json({}, { headers: sparklineHeaders });
			}
		},
	};
}
export type SparklineService = ReturnType<typeof createSparklineService>;
export async function sparklinesResponse() {
	const proxy = getProxy();
	if (proxy)
		return Response.json(await proxy.getSparklines(), {
			headers: sparklineHeaders,
		});
	return createSparklineService({
		getHoldings: currentCandleHoldings,
		candles: getCandleCache(),
	}).respond();
}
