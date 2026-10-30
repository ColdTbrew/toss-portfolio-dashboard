import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createShutdownCoordinator } from "../src/server/shutdown";
import { deferred } from "./fixtures";

class FakeProcess extends EventEmitter {
	exitCode: string | number | undefined;
	exit = vi.fn();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("shares one drain and one deadline across repeated signals and the close hook", async () => {
	const runtime = new FakeProcess();
	const drain = deferred<void>();
	const stop = vi.fn(() => drain.promise);
	const shutdown = createShutdownCoordinator(stop, runtime);
	const timeout = vi.spyOn(globalThis, "setTimeout");
	runtime.emit("SIGTERM");
	const pending = shutdown();
	runtime.emit("SIGINT");
	runtime.emit("SIGTERM");
	expect(shutdown()).toBe(pending);
	await Promise.resolve();
	expect(stop).toHaveBeenCalledTimes(1);
	expect(runtime.listenerCount("SIGTERM")).toBe(1);
	expect(runtime.listenerCount("SIGINT")).toBe(1);
	expect(vi.getTimerCount()).toBe(1);
	expect(timeout.mock.results[0].value.hasRef()).toBe(false);
	expect(runtime.exitCode).toBeUndefined();
	expect(runtime.exit).not.toHaveBeenCalled();
	drain.resolve();
	await pending;
	expect(runtime.exitCode).toBe(0);
	expect(shutdown()).toBe(pending);
	expect(stop).toHaveBeenCalledTimes(1);
	// A leftover handle after successful cleanup is still bounded by the deadline.
	await vi.advanceTimersByTimeAsync(4999);
	expect(runtime.exit).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
});

it("forces exit after five seconds if cleanup is stuck, without extending on a second signal", async () => {
	const runtime = new FakeProcess();
	const drain = deferred<void>();
	const shutdown = createShutdownCoordinator(() => drain.promise, runtime);
	runtime.emit("SIGINT");
	await vi.advanceTimersByTimeAsync(4000);
	runtime.emit("SIGTERM");
	await vi.advanceTimersByTimeAsync(1000);
	expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
	drain.resolve();
	await shutdown();
});

it("handles cleanup failures without logging their private details or losing the fallback", async () => {
	const runtime = new FakeProcess();
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const shutdown = createShutdownCoordinator(async () => {
		throw new Error("Bearer FAKE_PRIVATE_DETAIL");
	}, runtime);
	await shutdown();
	expect(error).toHaveBeenCalledExactlyOnceWith("Shutdown cleanup failed");
	expect(runtime.exitCode).toBe(0);
	await vi.advanceTimersByTimeAsync(5000);
	expect(runtime.exit).toHaveBeenCalledExactlyOnceWith(0);
});
