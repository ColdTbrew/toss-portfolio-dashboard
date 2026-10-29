import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createRealtime, type Realtime } from "../src/server/realtime";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function until(condition: () => boolean, timeout = 3000) {
	const deadline = Date.now() + timeout;
	while (!condition()) {
		if (Date.now() >= deadline) throw new Error("Local WS condition timed out");
		await delay(5);
	}
}
async function setup(
	options: {
		timing?: Parameters<typeof createRealtime>[0]["timing"];
		deny?: number;
		disconnect?: number;
	} = {},
) {
	let attempts = 0;
	const server = new WebSocketServer({
		host: "127.0.0.1",
		port: 0,
		verifyClient: (_info, done) => {
			attempts++;
			done(!(options.deny && attempts === 1), options.deny);
		},
	});
	await once(server, "listening");
	const address = server.address();
	if (typeof address === "string" || !address)
		throw new Error("Missing local WS address");
	const peers: WebSocket[] = [];
	const frames: { text: string; at: number }[] = [];
	const connectedAt: number[] = [];
	let peak = 0;
	server.on("connection", (peer, request) => {
		expect(request.headers.authorization).toMatch(/^Bearer FAKE_/);
		peers.push(peer);
		connectedAt.push(Date.now());
		peak = Math.max(peak, server.clients.size);
		peer.on("message", (data) =>
			frames.push({ text: data.toString(), at: Date.now() }),
		);
		if (peers.length <= (options.disconnect ?? 0)) peer.terminate();
	});
	const tokens = { getToken: vi.fn(async () => "FAKE_WS_TOKEN") };
	const realtime = createRealtime({
		tokens,
		url: `ws://127.0.0.1:${address.port}`,
		WebSocket,
		random: () => 0.5,
		timing: { backoffMs: 40, ...options.timing },
	});
	cleanups.push(async () => {
		await realtime.stop();
		for (const peer of server.clients) peer.terminate();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return {
		realtime,
		tokens,
		peers,
		frames,
		connectedAt,
		peak: () => peak,
		attempts: () => attempts,
	};
}
function demand(realtime: Realtime) {
	realtime.setHoldings([
		{ symbol: "FAKEKR", market: "KR" },
		{ symbol: "FAKEUS", market: "US" },
	]);
	realtime.setClientCount(1);
}

describe("single realtime connection", () => {
	it("requires both clients and holdings; duplicate connect calls share one authenticated socket", async () => {
		const { realtime, tokens, peers, frames, peak } = await setup();
		realtime.setHoldings([{ symbol: "FAKEKR", market: "KR" }]);
		await realtime.connect();
		expect(peers).toHaveLength(0);
		demand(realtime);
		await Promise.all(Array.from({ length: 10 }, () => realtime.connect()));
		await until(() => frames.length > 0);
		expect(peers).toHaveLength(1);
		expect(tokens.getToken).toHaveBeenCalledTimes(1);
		expect(peak()).toBe(1);
		expect(JSON.parse(frames[0].text)).toEqual([
			{ id: "dash-1" },
			{ type: "trade:kr", codes: ["FAKEKR"] },
			{ type: "trade:us", codes: ["FAKEUS"] },
		]);
	});
	it("parses trade frames, drops invalid frames and uses full replacement without rejected targets", async () => {
		const { realtime, peers, frames } = await setup({
			timing: { declarationMs: 40 },
		});
		const tick = vi.fn();
		realtime.onTick(tick);
		demand(realtime);
		await until(() => frames.length === 1);
		const peer = peers[0];
		peer.send(
			JSON.stringify({
				type: "message",
				topic: "trade:us:FAKEUS",
				data: { price: "123.45", timestamp: "2026-10-29T10:00:00+09:00" },
			}),
		);
		peer.send("not JSON");
		peer.send(
			JSON.stringify({
				type: "message",
				topic: "trade:us:FAKEUS",
				data: { price: "NaN" },
			}),
		);
		peer.send(
			JSON.stringify({
				type: "subscriptions",
				rejected: [{ target: "trade:us:FAKEUS", code: "stock-not-found" }],
			}),
		);
		await until(() => tick.mock.calls.length === 1);
		expect(tick).toHaveBeenCalledExactlyOnceWith({
			symbol: "FAKEUS",
			market: "us",
			price: 123.45,
			timestamp: "2026-10-29T10:00:00+09:00",
		});
		realtime.setHoldings([
			{ symbol: "FAKEKR", market: "KR" },
			{ symbol: "FAKEUS", market: "US" },
			{ symbol: "FAKENEW", market: "US" },
		]);
		await until(() => frames.length === 2);
		expect(JSON.parse(frames[1].text)).toEqual([
			{ id: "dash-2" },
			{ type: "trade:kr", codes: ["FAKEKR"] },
			{ type: "trade:us", codes: ["FAKENEW"] },
		]);
	});
	it("debounces rapid declarations to at most once per second by default", async () => {
		const { realtime, frames } = await setup();
		demand(realtime);
		await until(() => frames.length === 1);
		for (let index = 0; index < 5; index++)
			realtime.setHoldings([{ symbol: `FAKE${index}`, market: "US" }]);
		await delay(100);
		expect(frames).toHaveLength(1);
		await until(() => frames.length === 2);
		expect(frames[1].at - frames[0].at).toBeGreaterThanOrEqual(990);
		expect(JSON.parse(frames[1].text)[1].codes).toEqual(["FAKE4"]);
	});
	it("sends text PING periodically and releases the slot after the last client leaves", async () => {
		const { realtime, frames, peers } = await setup({
			timing: { pingMs: 30, idleMs: 100, declarationMs: 10 },
		});
		demand(realtime);
		await until(
			() => frames.filter((frame) => frame.text === "PING").length >= 2,
		);
		const pings = frames.filter((frame) => frame.text === "PING");
		expect(pings[1].at - pings[0].at).toBeGreaterThanOrEqual(20);
		realtime.setClientCount(0);
		await delay(25);
		expect(realtime.getState()).toBe("open");
		await until(() => realtime.getState() === "idle");
		expect(frames.some((frame) => frame.text === "[]")).toBe(true);
		expect(peers).toHaveLength(1);
	});
	it("reconnects with increasing backoff and never overlaps connections", async () => {
		const { realtime, peers, connectedAt, peak } = await setup({
			disconnect: 3,
		});
		demand(realtime);
		await until(() => peers.length === 4);
		expect(connectedAt[1] - connectedAt[0]).toBeGreaterThanOrEqual(35);
		expect(connectedAt[2] - connectedAt[1]).toBeGreaterThanOrEqual(75);
		expect(connectedAt[3] - connectedAt[2]).toBeGreaterThanOrEqual(150);
		expect(peak()).toBe(1);
	});
	it("passes the rejected handshake token to the shared token store", async () => {
		const { realtime, peers, tokens } = await setup({ deny: 401 });
		demand(realtime);
		await until(() => peers.length === 1);
		expect(tokens.getToken.mock.calls).toEqual([
			[undefined],
			[{ rejectedToken: "FAKE_WS_TOKEN" }],
		]);
	});
	it("backs off on HTTP 403 and keeps a safe error status", async () => {
		const { realtime, peers, attempts } = await setup({
			deny: 403,
			timing: { forbiddenMs: 200 },
		});
		demand(realtime);
		await until(() => realtime.getState() === "backoff");
		expect(realtime.getError()).toContain("HTTP 403");
		await delay(80);
		expect(attempts()).toBe(1);
		await until(() => peers.length === 1);
	});
	it("redeclares after rate limiting and reconnects after server shutdown", async () => {
		const { realtime, frames, peers } = await setup();
		demand(realtime);
		await until(() => frames.length === 1);
		peers[0].send(
			JSON.stringify({ type: "error", error: { code: "rate-limit-exceeded" } }),
		);
		await until(() => frames.length === 2);
		expect(frames[1].at - frames[0].at).toBeGreaterThanOrEqual(990);
		peers[0].send(
			JSON.stringify({ type: "error", error: { code: "server-shutdown" } }),
		);
		await until(() => peers.length === 2);
	});
	it("does not open a socket when stopped while token acquisition is pending", async () => {
		let resolve: (token: string) => void = () => {};
		const socket = vi.fn();
		const realtime = createRealtime({
			tokens: {
				getToken: () =>
					new Promise<string>((done) => {
						resolve = done;
					}),
			},
			WebSocket: socket as unknown as typeof WebSocket,
		});
		demand(realtime);
		await realtime.stop();
		resolve("FAKE_LATE_TOKEN");
		await delay(5);
		expect(socket).not.toHaveBeenCalled();
		expect(realtime.getState()).toBe("stopped");
	});
});
