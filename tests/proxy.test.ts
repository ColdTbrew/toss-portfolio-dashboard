import { afterEach, expect, it, vi } from "vitest";
import { createProxy } from "../src/server/proxy";
import { deferred } from "./fixtures";

const upstream = new URL("http://upstream.invalid:8790");
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const make = (fetcher: typeof fetch, now?: () => number) =>
	createProxy({ upstream, fetch: fetcher, now });

it.each([
	"/api/portfolio",
	"/api/trend",
] as const)("proxies %s unchanged with no client or upstream headers", async (path) => {
	// Older trend points intentionally omit stocksEvalKrw.
	const body =
		path === "/api/trend"
			? '[ { "date": "2026-01-01", "totalAssetsKrw": 42 } ]'
			: '{ "holdings": [], "mock": false }';
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response(body, {
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Set-Cookie": "FAKE_COOKIE",
					"X-Fake": "private",
				},
			}),
	);
	const response = await make(fetcher).json(path);
	expect(await response.text()).toBe(body);
	expect(Object.fromEntries(response.headers)).toEqual({
		"cache-control": "no-store",
		"content-type": "application/json",
	});
	expect(fetcher.mock.calls[0]).toEqual([
		new URL(path, upstream),
		{
			method: "GET",
			redirect: "error",
			credentials: "omit",
			signal: expect.any(AbortSignal),
		},
	]);
});

it.each([
	"status",
	"type",
	"invalid-json",
	"redirect",
	"network",
])("returns a generic 502 on %s failure without logging details", async (failure) => {
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	const fetcher = vi.fn<typeof fetch>(async () => {
		if (failure === "network" || failure === "redirect")
			throw new Error(`FAKE failure at ${upstream}`);
		return new Response(failure === "invalid-json" ? "<invalid>" : "{}", {
			status: failure === "status" ? 503 : 200,
			headers: {
				"Content-Type": failure === "type" ? "text/html" : "application/json",
			},
		});
	});
	for (const path of ["/api/portfolio", "/api/trend"] as const) {
		const response = await make(fetcher).json(path);
		expect(response.status).toBe(502);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({
			error: "미리보기 데이터를 불러오지 못했어요.",
		});
	}
	expect(log).not.toHaveBeenCalled();
});

it.each([
	"headers",
	"body",
	"stream",
])("aborts stalled %s after 10 seconds", async (phase) => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((resolve, reject) => {
				if (phase === "body")
					resolve(
						new Response(
							new ReadableStream({
								start(controller) {
									init?.signal?.addEventListener(
										"abort",
										() => controller.error(new Error("FAKE timeout")),
										{ once: true },
									);
								},
							}),
							{ headers: { "Content-Type": "application/json" } },
						),
					);
				else
					init?.signal?.addEventListener(
						"abort",
						() => reject(new Error("FAKE timeout")),
						{ once: true },
					);
			}),
	);
	const proxy = make(fetcher);
	const response =
		phase === "stream"
			? proxy.stream(new AbortController().signal)
			: proxy.json("/api/portfolio");
	await vi.advanceTimersByTimeAsync(9999);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect((await response).status).toBe(502);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it.each([
	true,
	false,
])("reports upstream reachability (%s) without disclosing its URL or response", async (reachable) => {
	const fetcher = vi.fn<typeof fetch>(async () => {
		if (!reachable) throw new Error("FAKE private failure");
		return Response.json({ ok: false, private: "FAKE upstream detail" });
	});
	const response = await make(fetcher).health();
	expect(await response.json()).toEqual({
		ok: false,
		wsState: "idle",
		lastRefreshAt: "",
		proxy: true,
		mock: false,
		upstreamReachable: reachable,
	});
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(fetcher.mock.calls[0][0]).toEqual(new URL("/api/health", upstream));
});

it("deduplicates the holdings allowlist, expires it after 30 seconds, and fails closed on invalid data", async () => {
	let time = 0;
	const pending = deferred<Response>();
	const fetcher = vi
		.fn<typeof fetch>()
		.mockImplementationOnce(() => pending.promise)
		.mockResolvedValueOnce(Response.json({ holdings: [] }))
		.mockResolvedValueOnce(Response.json({ holdings: [{ symbol: 42 }] }))
		.mockResolvedValueOnce(Response.json({ invalid: true }));
	const proxy = make(fetcher, () => time);
	const first = proxy.getHoldings();
	const second = proxy.getHoldings();
	pending.resolve(
		Response.json({
			holdings: [{ symbol: "FAKEUS", name: "Fake", quantity: 999 }],
		}),
	);
	expect(await first).toEqual([{ symbol: "FAKEUS", name: "Fake" }]);
	expect(await second).toEqual(await first);
	time = 29_999;
	expect(await proxy.getHoldings()).toEqual(await first);
	expect(fetcher).toHaveBeenCalledTimes(1);
	time++;
	expect(await proxy.getHoldings()).toEqual([]);
	time += 30_000;
	await expect(proxy.getHoldings()).rejects.toThrow("Portfolio unavailable");
	await expect(proxy.getHoldings()).rejects.toThrow("Portfolio unavailable");
	expect(fetcher).toHaveBeenCalledTimes(4);
});

it("preserves existing health fields and excludes arbitrary upstream details", async () => {
	const lastRefreshAt = "2026-01-01T12:34:56.000+09:00";
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			Response.json({
				ok: true,
				wsState: "open",
				lastRefreshAt,
				url: upstream.href,
			}),
		)
		.mockResolvedValueOnce(
			Response.json({
				ok: true,
				wsState: upstream.href,
				lastRefreshAt: upstream.href,
			}),
		);
	const proxy = make(fetcher);
	expect(await (await proxy.health()).json()).toEqual({
		ok: true,
		wsState: "open",
		lastRefreshAt,
		proxy: true,
		mock: false,
		upstreamReachable: true,
	});
	expect(await (await proxy.health()).json()).toEqual({
		ok: true,
		wsState: "idle",
		lastRefreshAt: "",
		proxy: true,
		mock: false,
		upstreamReachable: true,
	});
});

it("forwards SSE chunks byte-for-byte and closes on EOF without a lifetime timeout", async () => {
	vi.useFakeTimers();
	const chunks = [
		new Uint8Array([58, 32, 240, 159]),
		new Uint8Array([146, 161, 10, 10]),
		new TextEncoder().encode('event: status\r\ndata: {"ws":"idle"}\r\n\r\n'),
	];
	let upstreamStream: ReadableStreamDefaultController<Uint8Array> | undefined;
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response(
				new ReadableStream({
					start(controller) {
						upstreamStream = controller;
					},
				}),
				{ headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
			),
	);
	const response = await make(fetcher).stream(new AbortController().signal);
	expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	await vi.advanceTimersByTimeAsync(60_000);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
	const reader = response.body?.getReader();
	for (const chunk of chunks) {
		upstreamStream?.enqueue(chunk);
		expect((await reader?.read())?.value).toEqual(chunk);
	}
	upstreamStream?.close();
	expect((await reader?.read())?.done).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it.each([
	"request",
	"reader",
	"drop",
])("ends SSE and cleans up on %s", async (end) => {
	const cancel = vi.fn();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const fetcher = vi.fn<typeof fetch>(
		async () =>
			new Response(
				new ReadableStream({
					start(value) {
						controller = value;
					},
					cancel,
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			),
	);
	const abort = new AbortController();
	const response = await make(fetcher).stream(abort.signal);
	const reader = response.body?.getReader();
	if (end === "reader") await reader?.cancel();
	else if (end === "request") abort.abort();
	else controller?.error(new Error("FAKE upstream disconnected"));
	expect((await reader?.read())?.done).toBe(true);
	if (end !== "drop") {
		expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(cancel).toHaveBeenCalledTimes(1);
	}
});

it("propagates disconnects during SSE setup and skips already aborted clients", async () => {
	const fetcher = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new Error("FAKE disconnected")),
					{ once: true },
				);
			}),
	);
	const proxy = make(fetcher);
	expect((await proxy.stream(AbortSignal.abort())).status).toBe(502);
	expect(fetcher).not.toHaveBeenCalled();
	const abort = new AbortController();
	const response = proxy.stream(abort.signal);
	abort.abort();
	expect((await response).status).toBe(502);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it.each([
	"status",
	"type",
	"body",
	"network",
])("returns 502 for invalid SSE %s", async (failure) => {
	const fetcher = vi.fn<typeof fetch>(async () => {
		if (failure === "network") throw new Error("FAKE private detail");
		return new Response(failure === "body" ? null : "fake", {
			status: failure === "status" ? 503 : 200,
			headers: {
				"Content-Type":
					failure === "type" ? "application/json" : "text/event-stream",
			},
		});
	});
	expect(
		(await make(fetcher).stream(new AbortController().signal)).status,
	).toBe(502);
});
