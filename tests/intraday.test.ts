import { afterEach, describe, expect, it, vi } from "vitest";
import { timeZoneOffsetMinutes } from "../src/lib/compute";
import { createIntradayService } from "../src/server/intraday";
import { mockIntraday } from "../src/server/mock";
import { createProxy } from "../src/server/proxy";
import { parseTimedCandles } from "../src/server/tossClient";
import { deferred } from "./fixtures";

afterEach(() => vi.useRealTimers());

describe("parseTimedCandles", () => {
	it("keeps only the latest session and sorts bars oldest-first", () => {
		expect(
			parseTimedCandles(
				{
					candles: [
						{ closePrice: "103", timestamp: "2026-10-30T10:00:00+09:00" },
						{ closePrice: "101", timestamp: "2026-10-30T09:01:00+09:00" },
						{ closePrice: "100", timestamp: "2026-10-30T09:00:00+09:00" },
						{ closePrice: "99", timestamp: "2026-10-29T15:30:00+09:00" },
						{ closePrice: "98", timestamp: "2026-10-29T09:00:00+09:00" },
					],
				},
				"KR",
			),
		).toEqual([
			{ t: "2026-10-30T09:00:00+09:00", close: 100 },
			{ t: "2026-10-30T09:01:00+09:00", close: 101 },
			{ t: "2026-10-30T10:00:00+09:00", close: 103 },
		]);
	});
	it("maps UTC stamps to the exchange-local session date", () => {
		expect(
			parseTimedCandles(
				{
					candles: [
						{ close: 11, timestamp: "2026-06-01T15:00:00Z" },
						{ close: 10, timestamp: "2026-06-01T14:00:00Z" },
						{ close: 9, timestamp: "2026-06-01T03:00:00Z" },
					],
				},
				"US",
			),
		).toEqual([
			{ t: "2026-06-01T14:00:00Z", close: 10 },
			{ t: "2026-06-01T15:00:00Z", close: 11 },
		]);
		expect(
			parseTimedCandles(
				{
					candles: [
						{ close: 11, timestamp: "2026-06-01T01:00:00Z" },
						{ close: 10, timestamp: "2026-06-01T00:30:00Z" },
						{ close: 9, timestamp: "2026-05-31T14:00:00Z" },
					],
				},
				"KR",
			),
		).toEqual([
			{ t: "2026-06-01T00:30:00Z", close: 10 },
			{ t: "2026-06-01T01:00:00Z", close: 11 },
		]);
	});
	it("groups US bars onto the New York session regardless of timestamp offset", () => {
		expect(
			parseTimedCandles(
				{
					candles: [
						{ close: 10, timestamp: "2026-06-01T22:30:00+09:00" },
						{ close: 11, timestamp: "2026-06-02T00:00:00+09:00" },
						{ close: 12, timestamp: "2026-06-02T02:00:00Z" },
						{ close: 99, timestamp: "2026-06-02T02:00:00+00:00" },
						{ close: 13, timestamp: "2026-06-02T02:30:00+00:00" },
						{ close: 9, timestamp: "2026-06-01T03:00:00+09:00" },
					],
				},
				"US",
			),
		).toEqual([
			{ t: "2026-06-01T22:30:00+09:00", close: 10 },
			{ t: "2026-06-02T00:00:00+09:00", close: 11 },
			{ t: "2026-06-02T02:00:00Z", close: 12 },
			{ t: "2026-06-02T02:30:00+00:00", close: 13 },
		]);
	});
	it("dedupes timestamps and skips junk defensively", () => {
		expect(
			parseTimedCandles(
				{
					candles: [
						{ closePrice: "100", timestamp: "2026-10-30T09:00:00+09:00" },
						{ close: 101, timestamp: "2026-10-30T09:00:00+09:00" },
						{ closePrice: "bad", timestamp: "2026-10-30T09:01:00+09:00" },
						{ closePrice: "102", timestamp: "not-a-date" },
						{ close: 0, timestamp: "2026-10-30T09:02:00+09:00" },
						{ close: -1, timestamp: "2026-10-30T09:02:00+09:00" },
						null,
						{},
						{ close: "105", timestamp: "2026-10-30T09:03:00+09:00" },
					],
				},
				"KR",
			),
		).toEqual([
			{ t: "2026-10-30T09:00:00+09:00", close: 100 },
			{ t: "2026-10-30T09:03:00+09:00", close: 105 },
		]);
		for (const result of [null, {}, { candles: {} }, { candles: [] }])
			expect(parseTimedCandles(result, "KR")).toEqual([]);
	});
});

describe("timeZoneOffsetMinutes", () => {
	it("resolves fixed and DST-aware offsets", () => {
		const june = Date.parse("2026-06-01T12:00:00Z");
		const january = Date.parse("2026-01-01T12:00:00Z");
		expect(timeZoneOffsetMinutes("Asia/Seoul", june)).toBe(540);
		expect(timeZoneOffsetMinutes("Asia/Seoul", january)).toBe(540);
		expect(timeZoneOffsetMinutes("America/New_York", june)).toBe(-240);
		expect(timeZoneOffsetMinutes("America/New_York", january)).toBe(-300);
	});
});

describe("mockIntraday", () => {
	const now = Date.parse("2026-10-29T05:00:00Z"); // 14:00 KST, 01:00 NY (EDT)
	it("is deterministic per symbol and ends exactly at the mock last price", () => {
		const first = mockIntraday("FAKEK1", "KR", 9900, 10000, now);
		expect(first).toEqual(mockIntraday("FAKEK1", "KR", 9900, 10000, now));
		expect(first).not.toEqual(mockIntraday("FAKEK2", "KR", 9900, 10000, now));
		expect(first.at(-1)).toEqual({
			t: first.at(-1)?.t,
			close: 10000,
		});
		expect(Math.abs(first[0].close - 9900)).toBeLessThan(9900 * 0.01);
	});
	it("emits one-minute bars inside the exchange session window", () => {
		for (const [market, openUtc, closeUtc] of [
			["KR", "2026-10-29T00:00:00Z", "2026-10-29T06:30:00Z"],
			["US", "2026-10-29T13:30:00Z", "2026-10-29T20:00:00Z"],
		] as const) {
			const points = mockIntraday("FAKEU1", market, 90, 100, now);
			expect(points.length).toBeGreaterThanOrEqual(78);
			expect(points.length).toBeLessThanOrEqual(391);
			const first = Date.parse(points[0].t);
			const last = Date.parse(points.at(-1)?.t ?? "");
			expect(first).toBe(Date.parse(openUtc));
			expect(last).toBeLessThanOrEqual(Date.parse(closeUtc));
			for (let i = 1; i < points.length; i++)
				expect(Date.parse(points[i].t) - Date.parse(points[i - 1].t)).toBe(
					60_000,
				);
		}
	});
	it("shows the full session before the open or after the close", () => {
		const preMarket = Date.parse("2026-10-29T22:00:00Z"); // 07:00 KST next day
		const points = mockIntraday("FAKEK1", "KR", 9900, 10000, preMarket);
		expect(points).toHaveLength(391);
		expect(points.at(-1)?.close).toBe(10000);
	});
});

function makeService(
	options: Partial<Parameters<typeof createIntradayService>[0]> & {
		lookup: Parameters<typeof createIntradayService>[0]["lookup"];
	},
) {
	return createIntradayService({
		mock: false,
		getIntraday: vi.fn(async () => []),
		now: () => 0,
		...options,
	});
}

const held = {
	symbol: "FAKEUS",
	market: "US" as const,
	lastPrice: 200,
	previousClose: 198,
};

describe("createIntradayService", () => {
	it("rejects empty symbols with 400 and unknown symbols with 404", async () => {
		const lookup = vi.fn(async (symbol: string) =>
			symbol === held.symbol ? held : null,
		);
		const service = makeService({ lookup });
		expect((await service.respond("")).status).toBe(400);
		expect((await service.respond("UNKNOWN")).status).toBe(404);
		expect(lookup).toHaveBeenCalledTimes(1);
	});
	it("returns a generic 502 when holdings are unavailable", async () => {
		const service = makeService({
			lookup: vi.fn(async () => {
				throw new Error("FAKE_PRIVATE_DETAIL");
			}),
		});
		const response = await service.respond(held.symbol);
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain("FAKE_PRIVATE_DETAIL");
	});
	it("serves a deterministic mock series without calling the client", async () => {
		const getIntraday = vi.fn(async () => [
			{ t: "2026-10-29T00:00:00Z", close: 1 },
		]);
		const service = makeService({
			mock: true,
			lookup: vi.fn(async () => held),
			getIntraday,
		});
		const first = await (await service.respond(held.symbol)).json();
		expect(first).toEqual(await (await service.respond(held.symbol)).json());
		expect(first.previousClose).toBe(held.previousClose);
		expect(first.points.length).toBeGreaterThanOrEqual(78);
		expect(first.points.at(-1).close).toBe(held.lastPrice);
		expect(getIntraday).not.toHaveBeenCalled();
	});
	it("fetches 1m candles for held symbols, caches hits 60s and misses 30s", async () => {
		let now = 0;
		const getIntraday = vi.fn(async () => [
			{ t: "2026-10-29T14:00:00Z", close: 199 },
			{ t: "2026-10-29T14:01:00Z", close: 200 },
		]);
		const service = makeService({
			lookup: vi.fn(async () => held),
			getIntraday,
			now: () => now,
		});
		const first = await service.respond(held.symbol);
		expect(first.headers.get("Cache-Control")).toBe("private, max-age=30");
		expect(await first.json()).toEqual({
			previousClose: 198,
			points: [
				{ t: "2026-10-29T14:00:00Z", close: 199 },
				{ t: "2026-10-29T14:01:00Z", close: 200 },
			],
		});
		expect(getIntraday).toHaveBeenCalledExactlyOnceWith(held.symbol, {
			count: 200,
			market: "US",
		});
		now = 59_999;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(1);
		now = 60_000;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(2);
	});
	it("limits concurrent fetches to two and dedupes pending symbols", async () => {
		const symbols = ["S1", "S2", "S3"];
		const lookup = vi.fn(async (symbol: string) => ({
			symbol,
			market: "US" as const,
			lastPrice: 100,
			previousClose: 99,
		}));
		const gates = symbols.map(() => deferred<{ t: string; close: number }[]>());
		let active = 0;
		let peak = 0;
		const getIntraday = vi.fn((symbol: string) => {
			active++;
			peak = Math.max(peak, active);
			return gates[symbols.indexOf(symbol)].promise.finally(() => {
				active--;
			});
		});
		const service = makeService({ lookup, getIntraday, now: () => 0 });
		const responses = [
			service.respond("S1"),
			service.respond("S1"),
			service.respond("S2"),
			service.respond("S3"),
		];
		await vi.waitFor(() => expect(getIntraday).toHaveBeenCalledTimes(2));
		expect(peak).toBe(2);
		for (const gate of gates)
			gate.resolve([{ t: "2026-10-29T14:00:00Z", close: 199 }]);
		const payloads = await Promise.all(
			responses.map(async (response) => (await response).json()),
		);
		expect(getIntraday).toHaveBeenCalledTimes(3);
		expect(
			getIntraday.mock.calls.filter(([symbol]) => symbol === "S1"),
		).toHaveLength(1);
		expect(payloads[0]).toEqual(payloads[1]);
		expect(payloads[2]).toEqual(payloads[3]);
	});
	it("serves a short-lived empty payload when the fetch fails", async () => {
		let now = 0;
		const getIntraday = vi.fn(async () => {
			throw new Error("FAKE_PRIVATE_DETAIL");
		});
		const service = makeService({
			lookup: vi.fn(async () => held),
			getIntraday,
			now: () => now,
		});
		const first = await (await service.respond(held.symbol)).json();
		expect(first).toEqual({ previousClose: 198, points: [] });
		expect(JSON.stringify(first)).not.toContain("FAKE_PRIVATE_DETAIL");
		now = 29_999;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(1);
		now = 30_000;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(2);
		now = 59_999;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(2);
		now = 60_000;
		await service.respond(held.symbol);
		expect(getIntraday).toHaveBeenCalledTimes(3);
	});
});

describe("proxy intraday", () => {
	it.each([
		404,
		500,
		"transport",
		"json",
		"redirect",
	])("getIntraday falls back to an empty payload on %s", async (failure) => {
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
		expect(await proxy.getIntraday("FAKEUS")).toEqual({
			previousClose: null,
			points: [],
		});
		expect(String(request.mock.calls[0][0])).toBe(
			"https://upstream.invalid/api/intraday?symbol=FAKEUS",
		);
		expect(request.mock.calls[0][1]).toMatchObject({
			method: "GET",
			redirect: "error",
			credentials: "omit",
		});
	});
	it("forwards valid upstream payloads and scrubs malformed points", async () => {
		const proxy = createProxy({
			upstream: new URL("https://upstream.invalid"),
			fetch: vi.fn(async () =>
				Response.json({
					previousClose: "198",
					points: [
						{ t: "2026-10-29T14:00:00Z", close: 199 },
						{ t: "bad", close: 1 },
						{ t: "2026-10-29T14:01:00Z", close: "NaN" },
						null,
					],
				}),
			),
		});
		expect(await proxy.getIntraday("FAKEUS")).toEqual({
			previousClose: 198,
			points: [{ t: "2026-10-29T14:00:00Z", close: 199 }],
		});
	});
});
