import type { HoldingRow, Sparklines } from "../lib/types";
import { type Now, readConfig } from "./config";
import { createMockRaw } from "./mock";
import { getProxy } from "./proxy";
import type { TossClient } from "./tossClient";

export const sparklineHeaders = { "Cache-Control": "private, max-age=300" };
type Holding = Pick<HoldingRow, "symbol" | "lastPrice">;

export function mockCloses({ symbol, lastPrice }: Holding): number[] {
	const seed = Array.from(symbol).reduce(
		(hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
		0,
	);
	return Array.from({ length: 30 }, (_, i) => {
		const trend = (((seed % 13) - 6) * (i - 29)) / 2400;
		const wave =
			(Math.sin(i / 3 + (seed % 7)) - Math.sin(29 / 3 + (seed % 7))) * 0.012;
		return Number((lastPrice * (1 + trend + wave)).toFixed(2));
	});
}

export function createSparklineService(options: {
	mock: boolean;
	getHoldings: () => Promise<readonly Holding[]>;
	getCandles: TossClient["getCandles"];
	now?: Now;
}) {
	const now = options.now ?? Date.now;
	const cache = new Map<string, { closes: number[]; expires: number }>();
	const pending = new Map<string, Promise<number[]>>();
	const waiting: (() => void)[] = [];
	let active = 0;

	async function download(symbol: string) {
		if (active >= 2)
			await new Promise<void>((resolve) => waiting.push(resolve));
		else active++;
		let closes: number[] = [];
		try {
			closes = (
				await options.getCandles(symbol, { interval: "1d", count: 30 })
			).slice(-30);
		} catch {
			// A failed symbol is a cached miss; never log holdings or transport errors.
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
		cache.set(symbol, {
			closes,
			expires: now() + (closes.length ? 900_000 : 300_000),
		});
		return closes;
	}

	async function getCloses(symbol: string) {
		const hit = cache.get(symbol);
		if (hit && hit.expires > now()) return hit.closes;
		let promise = pending.get(symbol);
		if (!promise) {
			promise = download(symbol).finally(() => pending.delete(symbol));
			pending.set(symbol, promise);
		}
		return promise;
	}

	return {
		async respond() {
			let holdings: readonly Holding[];
			try {
				holdings = await options.getHoldings();
			} catch {
				return Response.json({}, { headers: sparklineHeaders });
			}
			const symbols = new Set(holdings.map((row) => row.symbol));
			for (const symbol of cache.keys())
				if (!symbols.has(symbol)) cache.delete(symbol);
			const entries = await Promise.all(
				holdings.map(
					async (row) =>
						[
							row.symbol,
							options.mock ? mockCloses(row) : await getCloses(row.symbol),
						] as const,
				),
			);
			const data: Sparklines = Object.fromEntries(
				entries.filter(([, closes]) => closes.length),
			);
			return Response.json(data, { headers: sparklineHeaders });
		},
	};
}

export type SparklineService = ReturnType<typeof createSparklineService>;
const globals = globalThis as typeof globalThis & {
	__tossSparklines?: SparklineService;
};
export async function sparklinesResponse() {
	const config = readConfig();
	const proxy = getProxy(config);
	if (proxy)
		return Response.json(await proxy.getSparklines(), {
			headers: sparklineHeaders,
		});
	globals.__tossSparklines ??= createSparklineService({
		mock: config.mock,
		getHoldings: async () => {
			if (config.mock)
				return (createMockRaw().holdings?.items ?? []).map((row) => ({
					symbol: row.symbol,
					lastPrice: Number(row.lastPrice),
				}));
			const { getPortfolioService } = await import("./portfolioService");
			return (await getPortfolioService().getPortfolio()).holdings;
		},
		getCandles: async (symbol, options) => {
			const { getTossClient } = await import("./tossClient");
			return getTossClient().getCandles(symbol, options);
		},
	});
	return globals.__tossSparklines.respond();
}
