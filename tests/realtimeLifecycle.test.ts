import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createRealtime, type Realtime } from "../src/server/realtime";
import { NOW } from "./fixtures";

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
