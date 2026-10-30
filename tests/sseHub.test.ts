import { afterEach, expect, it, vi } from "vitest";
import { buildState, kstIso } from "../src/lib/compute";
import { createSseHub } from "../src/server/sseHub";
import { NOW, rawFixture } from "./fixtures";

afterEach(() => {
	vi.useRealTimers();
});

it("ends every stream, clears timers and refuses connections after stop", async () => {
	vi.useFakeTimers();
	const hub = createSseHub();
	const state = buildState(rawFixture());
	const status = { ws: "idle" as const, lastRefreshAt: state.fetchedAt };
	const readers = [hub.connect(state, status), hub.connect(state, status)].map(
		(response) => response.body?.getReader(),
	);
	for (const reader of readers) await reader?.read();
	hub.queueTick({
		symbol: "FAKEUS",
		market: "us",
		price: 123,
		timestamp: kstIso(NOW),
	});
	hub.stop();
	hub.stop();
	for (const reader of readers)
		expect(await reader?.read()).toEqual({ done: true, value: undefined });
	expect(hub.getClientCount()).toBe(0);
	expect(hub.connect(state, status).status).toBe(503);
	expect(vi.getTimerCount()).toBe(0);
});
it("sends an initial snapshot, coalesces ticks, heartbeats and removes aborted clients", async () => {
	vi.useFakeTimers();
	const hub = createSseHub();
	const count = vi.fn();
	hub.onClientCount(count);
	const controller = new AbortController();
	const response = hub.connect(
		buildState(rawFixture(), { now: NOW }),
		{ ws: "open", lastRefreshAt: kstIso(NOW) },
		controller.signal,
	);
	expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	expect(response.headers.get("Cache-Control")).toBe("no-cache");
	expect(response.headers.get("X-Accel-Buffering")).toBe("no");
	const reader = response.body?.getReader();
	if (!reader) throw new Error();
	const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
	expect(decode((await reader.read()).value)).toContain("event: snapshot");
	for (const price of [100, 101, 102])
		hub.queueTick({
			symbol: "FAKEUS",
			market: "us",
			price,
			timestamp: kstIso(NOW),
		});
	await vi.advanceTimersByTimeAsync(250);
	const batch = decode((await reader.read()).value);
	expect(batch).toContain("event: ticks");
	expect(JSON.parse(batch.split("data: ")[1])).toEqual([
		{ symbol: "FAKEUS", market: "us", price: 102, timestamp: kstIso(NOW) },
	]);
	await vi.advanceTimersByTimeAsync(14_750);
	expect(decode((await reader.read()).value)).toBe(": ping\n\n");
	controller.abort();
	expect(await reader.read()).toEqual({ done: true, value: undefined });
	expect(count.mock.calls.map(([value]) => value)).toEqual([0, 1, 0]);
	expect(vi.getTimerCount()).toBe(0);
});

it("bounds slow-reader queues and treats stream cancellation as disconnection", async () => {
	const hub = createSseHub();
	const state = buildState(rawFixture());
	const response = hub.connect(state, {
		ws: "idle",
		lastRefreshAt: state.fetchedAt,
	});
	for (let i = 0; i < 100; i++) hub.broadcast("snapshot", state);
	expect(hub.getClientCount()).toBe(0);
	await response.body?.cancel();
	const next = hub.connect(state, {
		ws: "idle",
		lastRefreshAt: state.fetchedAt,
	});
	await next.body?.cancel();
	expect(hub.getClientCount()).toBe(0);
	hub.stop();
});
