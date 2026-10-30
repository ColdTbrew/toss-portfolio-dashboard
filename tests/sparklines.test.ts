import { afterEach, expect, it, vi } from "vitest";
import type { DatedClose } from "../src/lib/types";
import { type CandleHolding, createCandleCache } from "../src/server/candles";
import { mockHistory } from "../src/server/mock";
import { createProxy } from "../src/server/proxy";
import { createSparklineService } from "../src/server/sparklines";

const series = [
	{ date: "2026-10-28", close: 10 },
	{ date: "2026-10-29", close: 11 },
];
function makeService(
	options: Parameters<typeof createCandleCache>[0] & {
		getHoldings: () => Promise<readonly CandleHolding[]>;
	},
) {
	return createSparklineService({
		getHoldings: options.getHoldings,
		candles: createCandleCache(options),
	});
}

import { deferred } from "./fixtures";

afterEach(() => vi.useRealTimers());
const held = [
	{ symbol: "FAKEKR", market: "KR" as const, lastPrice: 10000 },
	{ symbol: "FAKEUS", market: "US" as const, lastPrice: 200 },
];

it("fetches only held symbols, caches hits 15 minutes and misses 5 minutes, and drops sold symbols", async () => {
	let now = 0;
	const getHoldings = vi.fn(async () => held);
	const getCandles = vi.fn(async (symbol: string) => {
		if (symbol === "FAKEUS") throw new Error("FAKE_PRIVATE_DETAIL");
		return series;
	});
	const service = makeService({
		mock: false,
		getHoldings,
		getCandles,
		now: () => now,
	});
	const response = await service.respond();
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
	expect(await response.json()).toEqual({ FAKEKR: [10, 11] });
	expect(getCandles.mock.calls.map(([symbol]) => symbol)).toEqual([
		"FAKEKR",
		"FAKEUS",
	]);
	expect(getCandles).toHaveBeenCalledWith("FAKEKR", {
		interval: "1d",
		count: 200,
		market: "KR",
	});
	now = 299_999;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(2);
	now = 300_000;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(3);
	getHoldings.mockResolvedValue([held[0]]);
	now = 899_999;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(3);
	now = 900_000;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(4);
	getHoldings.mockResolvedValue([]);
	expect(await (await service.respond()).json()).toEqual({});
});

it("limits all concurrent requests to two candle calls and deduplicates symbols", async () => {
	const rows = Array.from({ length: 5 }, (_, i) => ({
		symbol: `FAKE${i}`,
		market: "US" as const,
		lastPrice: 100,
	}));
	const gates = rows.map(() => deferred<DatedClose[]>());
	let active = 0;
	let peak = 0;
	const getCandles = vi.fn(async (symbol: string) => {
		active++;
		peak = Math.max(peak, active);
		try {
			return await gates[Number(symbol.slice(4))].promise;
		} finally {
			active--;
		}
	});
	const service = makeService({
		mock: false,
		getHoldings: async () => rows,
		getCandles,
	});
	const responses = [service.respond(), service.respond()];
	await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(2));
	gates[0].reject(new Error("FAKE_ERROR"));
	await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(3));
	gates[1].resolve(series);
	await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(4));
	gates[2].resolve(series);
	await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(5));
	gates[3].resolve(series);
	gates[4].resolve(series);
	const data = await Promise.all(
		(await Promise.all(responses)).map((response) => response.json()),
	);
	expect(data[0]).toEqual(data[1]);
	expect(Object.keys(data[0])).toHaveLength(4);
	expect(peak).toBe(2);
	expect(getCandles).toHaveBeenCalledTimes(5);
});

it("caches empty responses as misses and safely handles unavailable holdings", async () => {
	let now = 0;
	const getHoldings = vi.fn(async () => held);
	const getCandles = vi.fn(async () => []);
	const service = makeService({
		mock: false,
		getHoldings,
		getCandles,
		now: () => now,
	});
	expect(await (await service.respond()).json()).toEqual({});
	now = 299_999;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(2);
	now++;
	await service.respond();
	expect(getCandles).toHaveBeenCalledTimes(4);
	getHoldings.mockRejectedValue(new Error("FAKE_PRIVATE_DETAIL"));
	expect(await (await service.respond()).json()).toEqual({});
});

it("produces deterministic mock series without candles or network, ending at the mock price", async () => {
	const getCandles = vi.fn(async () => {
		throw new Error("No network");
	});
	const service = makeService({
		mock: true,
		getHoldings: async () => held,
		getCandles,
	});
	const first = await (await service.respond()).json();
	expect(first).toEqual(await (await service.respond()).json());
	for (const row of held) {
		expect(first[row.symbol]).toHaveLength(30);
		expect(first[row.symbol].at(-1)).toBe(row.lastPrice);
	}
	expect(mockHistory(held[0].symbol, held[0].lastPrice)).not.toEqual(
		mockHistory("FAKEOTHER", held[0].lastPrice),
	);
	expect(getCandles).not.toHaveBeenCalled();
});

it.each([
	404,
	500,
	"transport",
	"json",
	"redirect",
])("proxy sparkline fallback is empty on %s", async (failure) => {
	const request = vi.fn<typeof fetch>(async () => {
		if (failure === "transport") throw new Error("FAKE_PRIVATE_DETAIL");
		if (failure === "json")
			return new Response("bad", {
				headers: { "Content-Type": "application/json" },
			});
		return new Response(null, {
			status: failure === "redirect" ? 302 : Number(failure),
		});
	});
	const proxy = createProxy({
		upstream: new URL("https://upstream.invalid"),
		fetch: request,
	});
	expect(await proxy.getSparklines()).toEqual({});
	expect(String(request.mock.calls[0][0])).toBe(
		"https://upstream.invalid/api/sparklines",
	);
	expect(request.mock.calls[0][1]).toMatchObject({
		method: "GET",
		redirect: "error",
		credentials: "omit",
	});
});

it("bounds proxy sparkline requests to ten seconds", async () => {
	vi.useFakeTimers();
	const request = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("FAKE_PRIVATE_DETAIL")),
				);
			}),
	);
	const proxy = createProxy({
		upstream: new URL("https://upstream.invalid"),
		fetch: request,
	});
	const result = proxy.getSparklines();
	await vi.advanceTimersByTimeAsync(9999);
	expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect(await result).toEqual({});
});
