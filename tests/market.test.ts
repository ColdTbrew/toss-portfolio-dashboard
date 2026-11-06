import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMarketService,
	parseYahooChart,
	parseYahooIntraday,
} from "../src/server/market";
import { deferred, NOW } from "./fixtures";

afterEach(() => vi.useRealTimers());
const asOf = "2026-10-29T00:00:00.000Z";
const fx = { midRate: 1350, buyRate: 1355, validFrom: asOf };
const chart = (meta: Record<string, unknown>, close: unknown[] = []) => ({
	chart: {
		result: [{ meta, indicators: { quote: [{ close }] } }],
		error: null,
	},
});
const intradayChart = (
	meta: Record<string, unknown>,
	timestamp: unknown,
	close: unknown[],
) => ({
	chart: {
		result: [{ meta, timestamp, indicators: { quote: [{ close }] } }],
		error: null,
	},
});
// One daily candle: chartPreviousClose is the prior session, not a five-day base (5550.30).
const kospiOneDayChart = chart(
	{
		symbol: "^KS11",
		range: "1d",
		dataGranularity: "1d",
		regularMarketPrice: 6000,
		chartPreviousClose: 5937.66,
		regularMarketTime: Date.parse(asOf) / 1000,
	},
	[6000],
);

describe("Yahoo parsing", () => {
	it("prefers chartPreviousClose and market time, accepting string numbers", () => {
		expect(
			parseYahooChart(
				chart(
					{
						regularMarketPrice: "110",
						chartPreviousClose: "100",
						previousClose: 90,
						regularMarketTime: Date.parse(asOf) / 1000,
					},
					[1, 2],
				),
				"fallback",
			),
		).toEqual({ value: 110, change: 10, changeRate: 0.1, asOf });
	});
	it("falls back to previousClose, then the penultimate valid close", () => {
		expect(
			parseYahooChart(
				chart(
					{
						regularMarketPrice: 90,
						chartPreviousClose: "bad",
						previousClose: 100,
					},
					[1, 2],
				),
				asOf,
			),
		).toMatchObject({ change: -10, changeRate: -0.1 });
		expect(
			parseYahooChart(
				chart({ regularMarketPrice: 110 }, [80, null, "100", "110", "bad"]),
				asOf,
			),
		).toEqual({ value: 110, change: 10, changeRate: 0.1, asOf });
	});
	it("keeps an available price when change is unavailable or the base is zero", () => {
		expect(parseYahooChart(chart({ regularMarketPrice: 20 }), asOf)).toEqual({
			value: 20,
			change: null,
			changeRate: null,
			asOf,
		});
		expect(
			parseYahooChart(
				chart({
					regularMarketPrice: 20,
					previousClose: 0,
					regularMarketTime: 1e100,
				}),
				asOf,
			),
		).toEqual({ value: 20, change: 20, changeRate: null, asOf });
	});
	it.each([
		null,
		{},
		{ chart: { result: [] } },
		{ chart: { error: { code: "bad" } } },
		chart({ regularMarketPrice: "bad" }),
		chart({ regularMarketPrice: null }),
		chart({ regularMarketPrice: "" }),
		chart({ regularMarketPrice: Infinity }),
	])("omits malformed prices", (body) => {
		expect(parseYahooChart(body, asOf)).toBeNull();
	});
});

describe("Yahoo intraday parsing", () => {
	const meta = { chartPreviousClose: 18500, previousClose: 18450 };
	it("zips timestamps with closes, converts to milliseconds and keeps the base", () => {
		const parsed = parseYahooIntraday(
			intradayChart(meta, [1000, "1001", 1002], ["18510", 18520, null]),
		);
		expect(parsed).toEqual({
			points: [
				{ t: 1_000_000, v: 18510 },
				{ t: 1_001_000, v: 18520 },
			],
			previousClose: 18500,
		});
	});
	it("falls back to previousClose and sorts out-of-order samples", () => {
		const parsed = parseYahooIntraday(
			intradayChart(
				{ previousClose: "18450" },
				[1002, 1000, 1001],
				[18530, 18510, 18520],
			),
		);
		expect(parsed?.previousClose).toBe(18450);
		expect(parsed?.points.map((point) => point.t)).toEqual([
			1_000_000, 1_001_000, 1_002_000,
		]);
	});
	it("downsamples long sessions to the cap, keeping both endpoints", () => {
		const length = 250;
		const parsed = parseYahooIntraday(
			intradayChart(
				meta,
				Array.from({ length }, (_, index) => 1000 + index * 300),
				Array.from({ length }, (_, index) => 18500 + index),
			),
		);
		expect(parsed?.points).toHaveLength(120);
		expect(parsed?.points[0]).toEqual({ t: 1_000_000, v: 18500 });
		expect(parsed?.points.at(-1)?.t).toBe((1000 + (length - 1) * 300) * 1000);
		expect(parsed?.points.at(-1)?.v).toBe(18500 + length - 1);
	});
	it.each([
		null,
		{},
		{ chart: { error: { code: "bad" } } },
		intradayChart(meta, "bad", [1, 2]),
		intradayChart(meta, [1000], [18500]),
		intradayChart(meta, [1000, 1001], [null, "bad"]),
		intradayChart(meta, [1000, 1001], [18500, Infinity]),
	])("returns null for junk input %j", (body) => {
		expect(parseYahooIntraday(body)).toBeNull();
	});
});

it("fetches only four fixed Yahoo symbols and reuses portfolio FX, caching for 60 seconds", async () => {
	let now = NOW;
	const gate = deferred<Response>();
	const request = vi.fn<typeof fetch>(() =>
		gate.promise.then((response) => response.clone()),
	);
	const getFx = vi.fn(async () => fx);
	const service = createMarketService({
		mock: false,
		fetch: request,
		getFx,
		now: () => now,
	});
	const first = service.respond();
	const second = service.respond();
	gate.resolve(Response.json(kospiOneDayChart));
	const response = await first;
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=30");
	const data = await response.json();
	expect(data).toEqual(await (await second).json());
	expect(data.items.map((item: { id: string }) => item.id)).toEqual([
		"^IXIC",
		"^GSPC",
		"^KS11",
		"CL=F",
		"USD/KRW",
	]);
	const kospi = data.items.find((item: { id: string }) => item.id === "^KS11");
	expect(kospi).toMatchObject({ value: 6000, asOf });
	expect(kospi.change).toBeCloseTo(62.34);
	expect(kospi.changeRate).toBeCloseTo(62.34 / 5937.66);
	expect(data.items.at(-1)).toMatchObject({
		label: "달러/원",
		value: 1350,
		change: null,
		changeRate: null,
		asOf,
	});
	expect(request).toHaveBeenCalledTimes(4);
	expect(getFx).toHaveBeenCalledTimes(1);
	for (const [input, init] of request.mock.calls) {
		const url = new URL(String(input));
		expect(url.origin).toBe("https://query1.finance.yahoo.com");
		expect(["^IXIC", "^GSPC", "^KS11", "CL=F"]).toContain(
			decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
		);
		expect(url.search).toBe("?range=1d&interval=5m");
		expect(init).toMatchObject({
			method: "GET",
			redirect: "error",
			headers: { "User-Agent": "Mozilla/5.0" },
		});
	}
	now += 59_999;
	await service.respond();
	expect(request).toHaveBeenCalledTimes(4);
	now++;
	await service.respond();
	expect(request).toHaveBeenCalledTimes(8);
	expect(getFx).toHaveBeenCalledTimes(2);
});

it("omits missing items, preserves last good values as stale on failure, and recovers", async () => {
	let now = NOW;
	const request = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 503 }),
	);
	const getFx = vi.fn(async () => fx);
	const service = createMarketService({
		mock: false,
		fetch: request,
		getFx,
		now: () => now,
	});
	expect((await (await service.respond()).json()).items).toHaveLength(1);
	now += 60_000;
	request.mockImplementation(async () =>
		Response.json(chart({ regularMarketPrice: 110, previousClose: 100 })),
	);
	const good = await (await service.respond()).json();
	now += 60_000;
	request.mockRejectedValue(new Error("FAKE_PRIVATE_DETAIL"));
	getFx.mockRejectedValue(new Error("FAKE_PRIVATE_DETAIL"));
	const stale = await (await service.respond()).json();
	expect(stale.items).toEqual(
		good.items.map((item: object) => ({ ...item, stale: true })),
	);
	expect(stale.fetchedAt).not.toBe(good.fetchedAt);
	expect(JSON.stringify(stale)).not.toContain("FAKE_PRIVATE_DETAIL");
	now += 60_000;
	request.mockImplementation(async () =>
		Response.json(chart({ regularMarketPrice: 120, previousClose: 100 })),
	);
	getFx.mockResolvedValue({ ...fx, midRate: 1400 });
	const recovered = await (await service.respond()).json();
	expect(recovered.items.some((item: { stale?: boolean }) => item.stale)).toBe(
		false,
	);
	expect(recovered.items[0].value).toBe(120);
	expect(recovered.items.at(-1).value).toBe(1400);
});

it("attaches the intraday series and keeps the last good one as stale", async () => {
	let now = NOW;
	const stamps = Array.from(
		{ length: 200 },
		(_, index) => NOW / 1000 + index * 300,
	);
	const closes = Array.from({ length: 200 }, (_, index) => 5900 + index * 0.5);
	const request = vi.fn<typeof fetch>(async () =>
		Response.json(
			intradayChart(
				{
					regularMarketPrice: closes.at(-1),
					chartPreviousClose: 5890,
				},
				stamps,
				closes,
			),
		),
	);
	const service = createMarketService({
		mock: false,
		fetch: request,
		getFx: async () => fx,
		now: () => now,
	});
	const good = await (await service.respond()).json();
	const gspc = good.items.find((item: { id: string }) => item.id === "^GSPC");
	expect(gspc.intraday).toHaveLength(120);
	expect(gspc.intraday[0].v).toBe(5900);
	const lastStamp = stamps.at(-1) ?? 0;
	const lastClose = closes.at(-1) ?? 0;
	expect(gspc.intraday.at(-1)).toEqual({ t: lastStamp * 1000, v: lastClose });
	expect(gspc.previousClose).toBe(5890);
	now += 60_000;
	request.mockRejectedValue(new Error("FAKE_PRIVATE_DETAIL"));
	const stale = await (await service.respond()).json();
	const staleGspc = stale.items.find(
		(item: { id: string }) => item.id === "^GSPC",
	);
	expect(staleGspc.stale).toBe(true);
	expect(staleGspc.intraday).toEqual(gspc.intraday);
	expect(staleGspc.previousClose).toBe(5890);
});

it("aborts Yahoo at six seconds and omits timed-out items", async () => {
	vi.useFakeTimers();
	const request = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("FAKE_ERROR")),
				);
			}),
	);
	const service = createMarketService({
		mock: false,
		fetch: request,
		getFx: async () => null,
	});
	const response = service.respond();
	await vi.advanceTimersByTimeAsync(5999);
	expect(request.mock.calls.every(([, init]) => !init?.signal?.aborted)).toBe(
		true,
	);
	await vi.advanceTimersByTimeAsync(1);
	expect((await (await response).json()).items).toEqual([]);
});

it("mock market data is deterministic and never calls either data source", async () => {
	const request = vi.fn<typeof fetch>();
	const getFx = vi.fn(async () => fx);
	const service = createMarketService({
		mock: true,
		fetch: request,
		getFx,
		now: () => NOW,
	});
	const first = await (await service.respond()).json();
	expect(first).toEqual(await (await service.respond()).json());
	expect(first.items.map((item: { label: string }) => item.label)).toEqual([
		"나스닥",
		"S&P 500",
		"코스피",
		"WTI",
		"달러/원",
	]);
	expect(request).not.toHaveBeenCalled();
	expect(getFx).not.toHaveBeenCalled();
	const ixic = first.items.find((item: { id: string }) => item.id === "^IXIC");
	expect(ixic.intraday).toHaveLength(78);
	expect(ixic.intraday.at(-1).t).toBe(NOW);
	expect(ixic.intraday.at(-1).v).toBe(ixic.value);
	expect(ixic.intraday[0].v).toBeCloseTo(ixic.value - ixic.change, 4);
	expect(ixic.previousClose).toBeCloseTo(ixic.value - ixic.change, 4);
	const wti = first.items.find((item: { id: string }) => item.id === "CL=F");
	expect(wti.intraday).toHaveLength(264);
	expect(wti.intraday[0].v).toBeCloseTo(wti.value - wti.change, 4);
	const usdkrw = first.items.at(-1);
	expect(usdkrw.intraday).toBeUndefined();
});
