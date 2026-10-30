import type { DatedClose, HoldingRow } from "../lib/types";
import { type Now, readConfig } from "./config";
import { mockHistory } from "./mock";
import { getTossClient, type TossClient } from "./tossClient";

export type CandleHolding = Pick<HoldingRow, "symbol" | "market" | "lastPrice">;

export function createCandleCache(options: {
	mock: boolean;
	getCandles: TossClient["getCandles"];
	now?: Now;
}) {
	const now = options.now ?? Date.now;
	const cache = new Map<string, { series: DatedClose[]; expires: number }>();
	const pending = new Map<string, Promise<DatedClose[]>>();
	const waiting: (() => void)[] = [];
	let active = 0;
	async function download(row: CandleHolding) {
		if (active >= 2)
			await new Promise<void>((resolve) => waiting.push(resolve));
		else active++;
		let series: DatedClose[] = [];
		try {
			series = (
				await options.getCandles(row.symbol, {
					interval: "1d",
					count: 200,
					market: row.market,
				})
			).slice(-200);
		} catch {
			// Cache a miss without logging transport details or holdings.
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
		cache.set(row.symbol, {
			series,
			expires: now() + (series.length ? 900_000 : 300_000),
		});
		return series;
	}
	async function get(row: CandleHolding) {
		if (options.mock) return mockHistory(row.symbol, row.lastPrice, now());
		const hit = cache.get(row.symbol);
		if (hit && hit.expires > now()) return hit.series;
		let promise = pending.get(row.symbol);
		if (!promise) {
			promise = download(row).finally(() => pending.delete(row.symbol));
			pending.set(row.symbol, promise);
		}
		return promise;
	}
	return {
		async read(
			holdings: readonly CandleHolding[],
		): Promise<Record<string, DatedClose[]>> {
			const symbols = new Set(holdings.map((row) => row.symbol));
			for (const symbol of cache.keys())
				if (!symbols.has(symbol)) cache.delete(symbol);
			const entries = await Promise.all(
				holdings.map(async (row) => [row.symbol, await get(row)] as const),
			);
			return Object.fromEntries(entries.filter(([, series]) => series.length));
		},
	};
}

export type CandleCache = ReturnType<typeof createCandleCache>;
const globals = globalThis as typeof globalThis & {
	__tossCandles?: CandleCache;
};
export function getCandleCache(): CandleCache {
	const config = readConfig();
	if (config.proxy) throw new Error("Local candles unavailable in proxy mode");
	globals.__tossCandles ??= createCandleCache({
		mock: config.mock,
		getCandles: async (symbol, options) => {
			return getTossClient().getCandles(symbol, options);
		},
	});
	return globals.__tossCandles;
}

export async function currentCandleHoldings(): Promise<CandleHolding[]> {
	if (readConfig().mock) {
		const { createMockRaw } = await import("./mock");
		return (createMockRaw().holdings?.items ?? []).map((row) => ({
			symbol: row.symbol,
			market: row.marketCountry,
			lastPrice: Number(row.lastPrice),
		}));
	}
	const { getPortfolioService } = await import("./portfolioService");
	return (await getPortfolioService().getPortfolio()).holdings;
}
