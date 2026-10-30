import { describe, expect, it, vi } from "vitest";
import { createTossClient, parseCandleCloses } from "../src/server/tossClient";

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
	new Response(JSON.stringify(body), { status, headers });
function setup() {
	const tokens = {
		getToken: vi.fn(
			async (_options?: { rejectedToken?: string }) => "FAKE_ACCESS_TOKEN",
		),
	};
	const request = vi.fn<typeof fetch>();
	const sleep = vi.fn(async (_ms: number) => {});
	return {
		tokens,
		request,
		sleep,
		client: createTossClient({ tokens, fetch: request, sleep }),
	};
}

describe("read-only REST client", () => {
	it("parses newest-first candles defensively and returns oldest-first closes", () => {
		expect(
			parseCandleCloses({
				candles: [
					{ closePrice: "120" },
					{ close: 110 },
					{ closePrice: "bad", close: "105" },
					{ closePrice: 100 },
					null,
					{},
					{ close: "" },
					{ close: " " },
					{ close: null },
					{ close: false },
					{ close: "NaN" },
					{ close: Infinity },
					{ close: 0 },
					{ close: -2 },
				],
			}),
		).toEqual([100, 105, 110, 120]);
		for (const result of [null, {}, { candles: {} }, { candles: [] }])
			expect(parseCandleCloses(result)).toEqual([]);
	});
	it("fetches candles with only token authentication and the existing 429 backoff", async () => {
		const { client, request, sleep } = setup();
		request
			.mockResolvedValueOnce(json({}, 429, { "Retry-After": "2" }))
			.mockResolvedValueOnce(
				json({
					result: {
						candles: [
							{ closePrice: "12", timestamp: "2026-10-29T20:00:00Z" },
							{ close: 10, timestamp: "2026-10-28T20:00:00Z" },
						],
						nextBefore: null,
					},
				}),
			);
		expect(
			await client.getCandles("FAKEUS", { interval: "1d", count: 200 }),
		).toEqual([
			{ date: "2026-10-28", close: 10 },
			{ date: "2026-10-29", close: 12 },
		]);
		expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
		for (const [input, init] of request.mock.calls) {
			const url = new URL(String(input));
			expect(url.pathname).toBe("/api/v1/candles");
			expect(Object.fromEntries(url.searchParams)).toEqual({
				symbol: "FAKEUS",
				interval: "1d",
				count: "200",
			});
			expect(init).toMatchObject({ method: "GET", redirect: "error" });
			const headers = new Headers(init?.headers);
			expect(headers.has("Authorization")).toBe(true);
			expect(headers.has("X-Tossinvest-Account")).toBe(false);
		}
	});
	it("uses GET, account context, the response envelope and only fixed queries", async () => {
		const { client, request } = setup();
		request.mockImplementation(async () => json({ result: { fake: true } }));
		expect(await client.getHoldings(42)).toEqual({ fake: true });
		await client.getBuyingPower(42, "USD");
		await client.getExchangeRate();
		expect(
			request.mock.calls.map(([url]) => new URL(String(url)).pathname),
		).toEqual([
			"/api/v1/holdings",
			"/api/v1/buying-power",
			"/api/v1/exchange-rate",
		]);
		for (const [, init] of request.mock.calls) {
			expect(init?.method).toBe("GET");
			expect(init?.redirect).toBe("error");
			expect(new Headers(init?.headers).get("Authorization")).toBe(
				"Bearer FAKE_ACCESS_TOKEN",
			);
		}
		expect(
			new Headers(request.mock.calls[0][1]?.headers).get(
				"X-Tossinvest-Account",
			),
		).toBe("42");
		expect(new URL(String(request.mock.calls[1][0])).search).toBe(
			"?currency=USD",
		);
		expect(new URL(String(request.mock.calls[2][0])).search).toBe(
			"?baseCurrency=USD&quoteCurrency=KRW",
		);
		expect(
			new Headers(request.mock.calls[2][1]?.headers).has(
				"X-Tossinvest-Account",
			),
		).toBe(false);
	});
	it("returns masked accounts and immediately removes full numbers", async () => {
		const { client, request } = setup();
		request.mockResolvedValue(
			json({
				result: [
					{
						accountSeq: 42,
						accountType: "BROKERAGE",
						accountNo: "FAKE_ACCOUNT_9999",
					},
				],
			}),
		);
		expect(await client.listAccounts()).toEqual([
			{
				accountSeq: 42,
				accountType: "BROKERAGE",
				accountNoMasked: "*************9999",
			},
		]);
	});
	it("retries a rejected token once and exposes no raw headers or error data", async () => {
		const { client, tokens, request } = setup();
		request.mockImplementation(async () =>
			json(
				{
					error: {
						code: "expired-token",
						message: "Bearer FAKE_ACCESS_TOKEN",
						data: "FAKE_PRIVATE",
					},
				},
				401,
				{ "X-Fake": "FAKE_HEADER" },
			),
		);
		await expect(client.getHoldings(42)).rejects.toThrow(
			"HTTP 401 code=expired-token msg=Bearer [REDACTED]",
		);
		expect(request).toHaveBeenCalledTimes(2);
		expect(tokens.getToken).toHaveBeenLastCalledWith({
			rejectedToken: "FAKE_ACCESS_TOKEN",
		});
	});
	it.each([
		["2", 2000],
		[undefined, 1500],
	])("honors Retry-After %s and bounds 429 retries", async (header, expected) => {
		const { client, request, sleep } = setup();
		request.mockImplementation(async () =>
			json(
				{ error: { code: "rate-limit-exceeded" } },
				429,
				header ? { "Retry-After": header } : undefined,
			),
		);
		await expect(client.getExchangeRate()).rejects.toThrow("HTTP 429");
		expect(sleep).toHaveBeenCalledExactlyOnceWith(expected);
		expect(request).toHaveBeenCalledTimes(2);
	});
	it("aborts timed out requests with a fixed, safe transport error", async () => {
		const { tokens, request } = setup();
		request.mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("FAKE_SENSITIVE_TRANSPORT_DETAIL")),
					);
				}),
		);
		const client = createTossClient({ tokens, fetch: request, timeoutMs: 10 });
		await expect(client.getHoldings(42)).rejects.toThrow(
			"request failed or timed out",
		);
	});
});
