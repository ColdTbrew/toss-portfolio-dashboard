import type { MarketItem, MarketState, PortfolioState } from "../lib/types";
import { type Now, readConfig } from "./config";
import { createMockRaw } from "./mock";
import { finiteNumber, record } from "./parse";
import { getProxy } from "./proxy";

// Only these fixed market symbols ever leave this server for Yahoo.
const markets = [
	{ id: "^IXIC", label: "나스닥" },
	{ id: "^GSPC", label: "S&P 500" },
	{ id: "^KS11", label: "코스피" },
	{ id: "CL=F", label: "WTI", currency: "USD" },
] as const;

export function parseYahooChart(
	body: unknown,
	fallbackAsOf: string,
): Pick<MarketItem, "value" | "change" | "changeRate" | "asOf"> | null {
	const chart = record(record(body).chart);
	if (chart.error) return null;
	const result = Array.isArray(chart.result) ? record(chart.result[0]) : {};
	const meta = record(result.meta);
	const value = finiteNumber(meta.regularMarketPrice);
	if (value === null) return null;
	const quotes = record(result.indicators).quote;
	const closes = Array.isArray(quotes) ? record(quotes[0]).close : null;
	const validCloses = Array.isArray(closes)
		? closes.flatMap((close: unknown) => {
				const number = finiteNumber(close);
				return number === null ? [] : [number];
			})
		: [];
	const previous =
		finiteNumber(meta.chartPreviousClose) ??
		finiteNumber(meta.previousClose) ??
		validCloses.at(-2) ??
		null;
	const change = previous === null ? null : value - previous;
	const changeRate = change !== null && previous ? change / previous : null;
	const timestamp = finiteNumber(meta.regularMarketTime);
	const date = timestamp === null ? null : new Date(timestamp * 1000);
	return {
		value,
		change,
		changeRate:
			changeRate !== null && Number.isFinite(changeRate) ? changeRate : null,
		asOf:
			date && Number.isFinite(date.getTime())
				? date.toISOString()
				: fallbackAsOf,
	};
}

export function createMarketService(options: {
	mock: boolean;
	getFx: () => Promise<PortfolioState["fx"]>;
	fetch?: typeof fetch;
	now?: Now;
}) {
	const request = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const lastGood = new Map<string, MarketItem>();
	let cached: MarketState | undefined;
	let expires = 0;
	let pending: Promise<MarketState> | undefined;

	async function load(): Promise<MarketState> {
		const fetchedAt = new Date(now()).toISOString();
		const items = await Promise.all(
			markets.map(async (market, index): Promise<MarketItem | null> => {
				if (options.mock)
					return {
						...market,
						value: [18500.25, 5900.5, 2650.75, 72.4][index],
						change: [125.25, -20.5, 15.75, -0.6][index],
						changeRate: [0.0068, -0.0035, 0.006, -0.0082][index],
						asOf: fetchedAt,
					};
				const abort = new AbortController();
				const timer = setTimeout(() => abort.abort(), 6000);
				try {
					// chartPreviousClose precedes the window; 1d gives the prior session's close.
					const response = await request(
						`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.id)}?range=1d&interval=1d`,
						{
							method: "GET",
							headers: { "User-Agent": "Mozilla/5.0" },
							signal: abort.signal,
							redirect: "error",
							credentials: "omit",
						},
					);
					if (!response.ok) throw new Error();
					const parsed = parseYahooChart(await response.json(), fetchedAt);
					if (!parsed) throw new Error();
					const item = { ...market, ...parsed };
					lastGood.set(market.id, item);
					return item;
				} catch {
					const previous = lastGood.get(market.id);
					return previous ? { ...previous, stale: true } : null;
				} finally {
					abort.abort();
					clearTimeout(timer);
				}
			}),
		);
		try {
			const fx = options.mock ? createMockRaw(now()).fx : await options.getFx();
			const value = finiteNumber(fx?.midRate);
			if (value === null || value <= 0 || !fx) throw new Error();
			const item: MarketItem = {
				id: "USD/KRW",
				label: "달러/원",
				value,
				currency: "KRW",
				change: null,
				changeRate: null,
				asOf: fx.validFrom,
			};
			lastGood.set(item.id, item);
			items.push(item);
		} catch {
			const previous = lastGood.get("USD/KRW");
			if (previous) items.push({ ...previous, stale: true });
		}
		return {
			items: items.filter((item): item is MarketItem => item !== null),
			fetchedAt,
		};
	}

	async function getMarket() {
		if (cached && expires > now()) return cached;
		pending ??= load()
			.then((state) => {
				cached = state;
				expires = now() + 60_000;
				return state;
			})
			.finally(() => {
				pending = undefined;
			});
		return pending;
	}
	return {
		async respond() {
			return Response.json(await getMarket(), {
				headers: { "Cache-Control": "private, max-age=30" },
			});
		},
	};
}

export type MarketService = ReturnType<typeof createMarketService>;
const globals = globalThis as typeof globalThis & {
	__tossMarket?: MarketService;
};
export function getMarketService(): MarketService {
	if (!globals.__tossMarket) {
		const config = readConfig();
		const proxy = getProxy(config);
		globals.__tossMarket = createMarketService({
			mock: config.mock,
			getFx: proxy
				? () => proxy.getFx()
				: async () => {
						const { getPortfolioService } = await import("./portfolioService");
						return (await getPortfolioService().getPortfolio()).fx;
					},
		});
	}
	return globals.__tossMarket;
}
