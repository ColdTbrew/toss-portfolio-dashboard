import type { AnalyticsData, DatedClose } from "../lib/types";
import { type Now, readConfig } from "./config";
import { createMockRaw, mockHistory } from "./mock";
import { exchangeDate, finiteNumber, record } from "./parse";

const symbols = ["^KS11", "^GSPC", "^IXIC", "KRW=X"] as const;
type HistorySymbol = (typeof symbols)[number];
export function parseYahooHistory(body: unknown): DatedClose[] {
	const chart = record(record(body).chart);
	if (chart.error || !Array.isArray(chart.result)) return [];
	const result = record(chart.result[0]);
	const meta = record(result.meta);
	const zone =
		typeof meta.exchangeTimezoneName === "string"
			? meta.exchangeTimezoneName
			: "UTC";
	const quotes = record(result.indicators).quote;
	const closes = Array.isArray(quotes) ? record(quotes[0]).close : null;
	if (!Array.isArray(result.timestamp) || !Array.isArray(closes)) return [];
	const points = new Map<string, number>();
	for (const [i, timestamp] of result.timestamp.entries()) {
		const seconds = finiteNumber(timestamp);
		const close = finiteNumber(closes[i]);
		const date = seconds === null ? null : exchangeDate(seconds * 1000, zone);
		if (date && close !== null && close > 0) points.set(date, close);
	}
	return [...points]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, close]) => ({ date, close }));
}

export type MarketHistory = Pick<AnalyticsData, "benchmarks" | "usdkrw">;
export function createHistoryService(options: {
	mock: boolean;
	fetch?: typeof fetch;
	now?: Now;
}) {
	const request = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const lastGood = new Map<HistorySymbol, DatedClose[]>();
	let cached: MarketHistory | undefined;
	let expires = 0;
	let pending: Promise<MarketHistory> | undefined;
	async function load(): Promise<MarketHistory> {
		const entries = await Promise.all(
			symbols.map(async (symbol, index) => {
				if (options.mock)
					return [
						symbol,
						mockHistory(
							symbol,
							[
								2650.75,
								5900.5,
								18500.25,
								Number(createMockRaw(now()).fx?.midRate),
							][index],
							now(),
						),
					] as const;
				const abort = new AbortController();
				const timer = setTimeout(() => abort.abort(), 6000);
				try {
					const response = await request(
						`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
						{
							method: "GET",
							headers: { "User-Agent": "Mozilla/5.0" },
							signal: abort.signal,
							redirect: "error",
							credentials: "omit",
						},
					);
					if (!response.ok) throw new Error();
					const series = parseYahooHistory(await response.json());
					if (!series.length) throw new Error();
					lastGood.set(symbol, series);
					return [symbol, series] as const;
				} catch {
					return [symbol, lastGood.get(symbol) ?? []] as const;
				} finally {
					abort.abort();
					clearTimeout(timer);
				}
			}),
		);
		return {
			benchmarks: Object.fromEntries(
				entries.filter(
					([symbol, series]) => symbol !== "KRW=X" && series.length,
				),
			),
			usdkrw: entries.find(([symbol]) => symbol === "KRW=X")?.[1] ?? [],
		};
	}
	return {
		async read(): Promise<MarketHistory> {
			if (cached && expires > now()) return cached;
			pending ??= load()
				.then((data) => {
					cached = data;
					expires = now() + 3_600_000;
					return data;
				})
				.finally(() => {
					pending = undefined;
				});
			return pending;
		},
	};
}
export type HistoryService = ReturnType<typeof createHistoryService>;
const globals = globalThis as typeof globalThis & {
	__tossHistory?: HistoryService;
};
export function getHistoryService() {
	const config = readConfig();
	if (config.proxy) throw new Error("Local history unavailable in proxy mode");
	globals.__tossHistory ??= createHistoryService({ mock: config.mock });
	return globals.__tossHistory;
}
