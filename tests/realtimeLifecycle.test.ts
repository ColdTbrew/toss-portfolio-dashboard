import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createRealtime, type Realtime } from "../src/server/realtime";
import { deferred, NOW } from "./fixtures";

class FakeSocket extends EventEmitter {
	static instances: FakeSocket[] = [];
	readyState: number = WebSocket.CONNECTING;
	frames: string[] = [];
	constructor(_url: string, _options: unknown) {
		super();
		FakeSocket.instances.push(this);
	}
	open() {
		this.readyState = WebSocket.OPEN;
		this.emit("open");
	}
	send(frame: string) {
		this.frames.push(frame);
	}
	close() {
		this.terminate();
	}
	terminate() {
		if (
			this.readyState === WebSocket.CLOSED ||
			this.readyState === WebSocket.CLOSING
		)
			return;
		this.readyState = WebSocket.CLOSING;
		queueMicrotask(() => {
			this.readyState = WebSocket.CLOSED;
			this.emit("close");
		});
	}
}

let realtime: Realtime;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	FakeSocket.instances = [];
});
afterEach(async () => {
	await realtime?.stop();
	vi.useRealTimers();
});
async function setup(
	extra: Partial<Parameters<typeof createRealtime>[0]> = {},
) {
	const tokens = {
		getToken: vi.fn(
			async (_options?: { rejectedToken?: string }) => "FAKE_LIFECYCLE_TOKEN",
		),
	};
	realtime = createRealtime({
		tokens,
		WebSocket: FakeSocket as unknown as typeof WebSocket,
		random: () => 0.5,
		...extra,
	});
	realtime.setHoldings([{ symbol: "FAKEUS", market: "US" }]);
	realtime.setClientCount(1);
	await realtime.connect();
	return tokens;
}

describe("realtime lifecycle without sockets", () => {
	it("stops once, closes the socket and clears ping, idle, stable and declaration timers", async () => {
		await setup();
		const socket = FakeSocket.instances[0];
		socket.open();
		realtime.setClientCount(0);
		expect(vi.getTimerCount()).toBe(4);
		const terminate = vi.spyOn(socket, "terminate");
		const status = vi.fn();
		realtime.onStatus(status);
		const stopped = realtime.stop();
		expect(realtime.stop()).toBe(stopped);
		await stopped;
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(socket.readyState).toBe(WebSocket.CLOSED);
		expect(status).toHaveBeenCalledExactlyOnceWith("stopped");
		expect(vi.getTimerCount()).toBe(0);

		// Late frames and fresh demand must never restart a stopped manager.
		socket.emit(
			"message",
			Buffer.from(
				JSON.stringify({
					type: "error",
					error: { code: "rate-limit-exceeded" },
				}),
			),
		);
		realtime.setClientCount(1);
		realtime.setHoldings([{ symbol: "FAKENEW", market: "US" }]);
		await realtime.connect();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(socket.frames).toEqual([]);
		expect(realtime.getState()).toBe("stopped");
		expect(vi.getTimerCount()).toBe(0);
	});
	it("cancels a queued reconnect", async () => {
		const tokens = await setup();
		FakeSocket.instances[0].terminate();
		await vi.advanceTimersByTimeAsync(0);
		expect(realtime.getState()).toBe("backoff");
		expect(vi.getTimerCount()).toBe(1);
		await realtime.stop();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(tokens.getToken).toHaveBeenCalledTimes(1);
		expect(FakeSocket.instances).toHaveLength(1);
	});
	it.each([
		false,
		true,
	])("drains pending token acquisition without opening a socket (failure=%s)", async (fail) => {
		const token = deferred<string>();
		await setup({ tokens: { getToken: () => token.promise } });
		const completed = vi.fn();
		const stopped = realtime.stop();
		void stopped.then(completed);
		await Promise.resolve();
		expect(completed).not.toHaveBeenCalled();
		if (fail) token.reject(new Error("FAKE token write failure"));
		else token.resolve("FAKE_FINISHED_TOKEN");
		await stopped;
		expect(completed).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(600_000);
		expect(FakeSocket.instances).toHaveLength(0);
		expect(realtime.getState()).toBe("stopped");
		expect(vi.getTimerCount()).toBe(0);
	});
	it("clears the idle close watchdog during shutdown", async () => {
		await setup();
		const socket = FakeSocket.instances[0];
		socket.open();
		await vi.advanceTimersByTimeAsync(1000);
		// Simulate a peer that does not acknowledge the normal close handshake.
		vi.spyOn(socket, "close").mockImplementation(() => {});
		realtime.setHoldings([]);
		expect(socket.frames.at(-1)).toBe("[]");
		await realtime.stop();
		expect(socket.readyState).toBe(WebSocket.CLOSED);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("terminates an in-progress handshake without allowing a late open to start timers", async () => {
		await setup();
		const socket = FakeSocket.instances[0];
		const stopped = realtime.stop();
		socket.open();
		await stopped;
		expect(socket.readyState).toBe(WebSocket.CLOSED);
		expect(vi.getTimerCount()).toBe(0);
		expect(realtime.getState()).toBe("stopped");
	});
	it("uses the production 60 second PING and 120 second idle grace", async () => {
		await setup();
		const socket = FakeSocket.instances[0];
		socket.open();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(59_999);
		expect(socket.frames).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(socket.frames.at(-1)).toBe("PING");
		realtime.setClientCount(0);
		await vi.advanceTimersByTimeAsync(119_999);
		expect(socket.readyState).toBe(WebSocket.OPEN);
		await vi.advanceTimersByTimeAsync(1);
		expect(socket.frames.at(-1)).toBe("[]");
		expect(socket.readyState).toBe(WebSocket.CLOSED);
		expect(realtime.getState()).toBe("idle");
	});
	it("doubles reconnect delay, caps jitter at 60 seconds, and resets after a stable minute", async () => {
		await setup({ random: () => 1 });
		for (const delay of [1200, 2400, 4800, 9600, 19200, 38400, 60000]) {
			const count = FakeSocket.instances.length;
			FakeSocket.instances.at(-1)?.terminate();
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(delay - 1);
			expect(FakeSocket.instances).toHaveLength(count);
			await vi.advanceTimersByTimeAsync(1);
			expect(FakeSocket.instances).toHaveLength(count + 1);
		}
		FakeSocket.instances.at(-1)?.open();
		await vi.advanceTimersByTimeAsync(60_000);
		FakeSocket.instances.at(-1)?.terminate();
		await vi.advanceTimersByTimeAsync(0);
		const count = FakeSocket.instances.length;
		await vi.advanceTimersByTimeAsync(1200);
		expect(FakeSocket.instances).toHaveLength(count + 1);
	});
	it("waits five minutes after 403 and requests a replacement after 401", async () => {
		const tokens = await setup();
		const response = { statusCode: 403, resume: vi.fn() };
		FakeSocket.instances[0].emit("unexpected-response", {}, response);
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(299_999);
		expect(FakeSocket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(FakeSocket.instances).toHaveLength(2);
		FakeSocket.instances[1].emit(
			"unexpected-response",
			{},
			{ ...response, statusCode: 401 },
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(tokens.getToken).toHaveBeenLastCalledWith({
			rejectedToken: "FAKE_LIFECYCLE_TOKEN",
		});
		expect(
			FakeSocket.instances.every(
				(socket, index) =>
					index === FakeSocket.instances.length - 1 ||
					socket.readyState === WebSocket.CLOSED,
			),
		).toBe(true);
	});
	it("keeps the socket when demand returns during a throttled empty declaration", async () => {
		await setup();
		const socket = FakeSocket.instances[0];
		socket.open();
		await vi.advanceTimersByTimeAsync(0);
		realtime.setHoldings([]);
		realtime.setHoldings([{ symbol: "FAKENEW", market: "US" }]);
		await vi.advanceTimersByTimeAsync(1001);
		expect(FakeSocket.instances).toHaveLength(1);
		expect(socket.readyState).toBe(WebSocket.OPEN);
		expect(JSON.parse(socket.frames.at(-1) ?? "null")[1].codes).toEqual([
			"FAKENEW",
		]);
	});
	it("does not lose demand when it changes during token acquisition", async () => {
		let resolve: (value: string) => void = () => {};
		const pending = new Promise<string>((done) => {
			resolve = done;
		});
		const tokens = {
			getToken: vi
				.fn()
				.mockReturnValueOnce(pending)
				.mockResolvedValue("FAKE_NEW"),
		};
		await setup({ tokens });
		realtime.setHoldings([]);
		realtime.setHoldings([{ symbol: "FAKENEW", market: "US" }]);
		resolve("FAKE_OLD");
		await vi.advanceTimersByTimeAsync(1000);
		expect(FakeSocket.instances).toHaveLength(1);
	});
});
