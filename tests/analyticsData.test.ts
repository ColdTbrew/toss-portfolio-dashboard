import { afterEach, expect, it, vi } from "vitest";
import { createAnalyticsService } from "../src/server/analytics";
import { createCandleCache } from "../src/server/candles";
import { createHistoryService, parseYahooHistory } from "../src/server/history";
import {
	createMockRaw,
	createMockTrend,
	mockHistory,
} from "../src/server/mock";
import { createProxy } from "../src/server/proxy";
import { createSparklineService } from "../src/server/sparklines";
import { parseDatedCandles } from "../src/server/tossClient";
import { deferred, NOW } from "./fixtures";

const series = [
	{ date: "2026-10-28", close: 100 },
	{ date: "2026-10-29", close: 110 },
];
const held = [
	{ symbol: "FAKEKR", market: "KR" as const, lastPrice: 110 },
	{ symbol: "FAKEUS", market: "US" as const, lastPrice: 110 },
];
const yahoo = (zone = "America/New_York") => ({
	chart: {
		result: [
			{
				meta: { exchangeTimezoneName: zone },
				timestamp: [
					Date.parse("2026-10-29T00:30:00Z") / 1000,
					Date.parse("2026-10-30T00:30:00Z") / 1000,
					Date.parse("2026-10-31T00:30:00Z") / 1000,
				],
				indicators: { quote: [{ close: ["100", null, 110] }] },
			},
		],
	},
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("parses dated candles: mixed closes, newest first, invalid rows and exchange-local dates", () => {
	const candles = {
		candles: [
			{ timestamp: "2026-10-30T00:30:00Z", closePrice: "110" },
			{ timestamp: "2026-10-29T00:30:00Z", close: 100 },
			{ timestamp: "bad", close: 99 },
			{ close: 99 },
			{ timestamp: "2026-10-27T00:30:00Z", close: null },
			{ timestamp: "2026-10-26T00:30:00Z", close: -1 },
			null,
		],
	};
	expect(parseDatedCandles(candles, "US")).toEqual(series);
	expect(parseDatedCandles(candles, "KR")).toEqual([
		{ date: "2026-10-29", close: 100 },
		{ date: "2026-10-30", close: 110 },
	]);
	expect(
		parseDatedCandles(
			{
				candles: [
					{ timestamp: "2026-01-03T04:30:00Z", close: "10" },
					{ timestamp: "2026-07-03T04:30:00Z", close: 11 },
				],
			},
			"US",
		).map((p) => p.date),
	).toEqual(["2026-01-02", "2026-07-03"]);
	expect(
		parseDatedCandles(
			{
				candles: [
					{ timestamp: "2026-10-29T00:00:00+09:00", closePrice: "12" },
					{ timestamp: "2026-10-28T09:30:00-04:00", closePrice: "11" },
				],
			},
			"US",
		).map((p) => p.date),
	).toEqual(["2026-10-28", "2026-10-29"]);
	expect(parseDatedCandles(null, "KR")).toEqual([]);
});
it("parses Yahoo nulls by timestamp index, timezone dates and UTC fallback", () => {
	expect(parseYahooHistory(yahoo())).toEqual([
		{ date: "2026-10-28", close: 100 },
		{ date: "2026-10-30", close: 110 },
	]);
	expect(parseYahooHistory(yahoo("Asia/Seoul"))[0].date).toBe("2026-10-29");
	expect(parseYahooHistory(yahoo("FAKE_ZONE"))[0].date).toBe("2026-10-29");
	const body = yahoo();
	delete (
		body.chart.result[0].meta as Partial<(typeof body.chart.result)[0]["meta"]>
	).exchangeTimezoneName;
	expect(parseYahooHistory(body)[0].date).toBe("2026-10-29");
	for (const invalid of [null, {}, { chart: { error: true } }])
		expect(parseYahooHistory(invalid)).toEqual([]);
});
it("shares one in-flight 200-candle request per symbol between sparklines and analytics", async () => {
	const gate = deferred<typeof series>();
	const getCandles = vi.fn(() => gate.promise);
	const candles = createCandleCache({ mock: false, getCandles });
	const getHoldings = async () => held;
	const sparks = createSparklineService({ candles, getHoldings });
	const analytics = createAnalyticsService({
		candles,
		getHoldings,
		history: createHistoryService({ mock: true, now: () => NOW }),
	});
	const first = sparks.respond();
	const second = analytics.respond();
	await vi.waitFor(() => expect(getCandles).toHaveBeenCalledTimes(2));
	gate.resolve(series);
	expect(await (await first).json()).toEqual({
		FAKEKR: [100, 110],
		FAKEUS: [100, 110],
	});
	expect((await (await second).json()).candles).toEqual({
		FAKEKR: series,
		FAKEUS: series,
	});
	await Promise.all([sparks.respond(), analytics.respond()]);
	expect(getCandles).toHaveBeenCalledTimes(2);
});
it("requests only fixed Yahoo history symbols, caches for an hour and serves last good on errors", async () => {
	let now = NOW;
	const request = vi.fn<typeof fetch>(async () => Response.json(yahoo()));
	const service = createHistoryService({
		mock: false,
		fetch: request,
		now: () => now,
	});
	const [a, b] = await Promise.all([service.read(), service.read()]);
	expect(a).toEqual(b);
	expect(Object.keys(a.benchmarks)).toHaveLength(3);
	expect(a.usdkrw).toHaveLength(2);
	expect(request).toHaveBeenCalledTimes(4);
	expect(
		request.mock.calls.map(([url]) =>
			decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1) ?? ""),
		),
	).toEqual(["^KS11", "^GSPC", "^IXIC", "KRW=X"]);
	for (const [url, init] of request.mock.calls) {
		expect(new URL(String(url)).search).toBe("?range=1y&interval=1d");
		expect(init).toMatchObject({
			method: "GET",
			redirect: "error",
			credentials: "omit",
			headers: { "User-Agent": "Mozilla/5.0" },
		});
	}
	now += 3_599_999;
	await service.read();
	expect(request).toHaveBeenCalledTimes(4);
	now++;
	request.mockRejectedValue(new Error("FAKE_PRIVATE_DETAIL"));
	expect(await service.read()).toEqual(a);
	expect(request).toHaveBeenCalledTimes(8);
});
it("times Yahoo history out at six seconds and omits unavailable series", async () => {
	vi.useFakeTimers();
	const request = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) =>
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("FAKE_TIMEOUT")),
				),
			),
	);
	const service = createHistoryService({ mock: false, fetch: request });
	const pending = service.read();
	await vi.advanceTimersByTimeAsync(5999);
	expect(request.mock.calls.every(([, init]) => !init?.signal?.aborted)).toBe(
		true,
	);
	await vi.advanceTimersByTimeAsync(1);
	expect(await pending).toEqual({ benchmarks: {}, usdkrw: [] });
});
it("mock series and 90-day snapshots are deterministic, weekday-only candles end at mock prices", async () => {
	const request = vi.fn<typeof fetch>();
	vi.stubGlobal("fetch", request);
	const raw = createMockRaw(NOW);
	for (const row of raw.holdings?.items ?? []) {
		const points = mockHistory(row.symbol, Number(row.lastPrice), NOW);
		expect(points).toEqual(mockHistory(row.symbol, Number(row.lastPrice), NOW));
		expect(points).toHaveLength(200);
		expect(points.at(-1)?.close).toBe(Number(row.lastPrice));
		expect(
			points.every((p) => ![0, 6].includes(new Date(p.date).getUTCDay())),
		).toBe(true);
	}
	const history = await createHistoryService({
		mock: true,
		now: () => NOW,
	}).read();
	expect(history.usdkrw.at(-1)?.close).toBe(Number(raw.fx?.midRate));
	expect(createMockTrend(NOW)).toEqual(createMockTrend(NOW));
	expect(createMockTrend(NOW)).toHaveLength(90);
	expect(request).not.toHaveBeenCalled();
});
it.each([
	404,
	500,
	"json",
	"transport",
	"shape",
])("analytics proxy fallback remains valid on %s", async (failure) => {
	const request = vi.fn<typeof fetch>(async () => {
		if (failure === "transport") throw new Error("FAKE_PRIVATE_DETAIL");
		if (failure === "json")
			return new Response("bad", {
				headers: { "Content-Type": "application/json" },
			});
		if (failure === "shape") return Response.json({});
		return new Response(null, { status: Number(failure) });
	});
	const proxy = createProxy({
		upstream: new URL("https://upstream.invalid"),
		fetch: request,
		now: () => NOW,
	});
	expect(await proxy.getAnalytics()).toEqual({
		fetchedAt: new Date(NOW).toISOString(),
		candles: {},
		benchmarks: {},
		usdkrw: [],
	});
	expect(String(request.mock.calls[0][0])).toBe(
		"https://upstream.invalid/api/analytics",
	);
	expect(request.mock.calls[0][1]).toMatchObject({
		method: "GET",
		redirect: "error",
		credentials: "omit",
	});
});
it("times out analytics proxy after ten seconds", async () => {
	vi.useFakeTimers();
	const request = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) =>
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("FAKE_TIMEOUT")),
				),
			),
	);
	const pending = createProxy({
		upstream: new URL("https://upstream.invalid"),
		fetch: request,
	}).getAnalytics();
	await vi.advanceTimersByTimeAsync(9999);
	expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect((await pending).candles).toEqual({});
});
