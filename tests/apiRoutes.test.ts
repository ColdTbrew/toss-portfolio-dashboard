import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "../src/routes/api/health";
import { GET as portfolio } from "../src/routes/api/portfolio";
import { GET as stream } from "../src/routes/api/stream";
import { GET as trend } from "../src/routes/api/trend";
import {
	getPortfolioService,
	type PortfolioService,
} from "../src/server/portfolioService";
import { getSseHub, type SseHub } from "../src/server/sseHub";

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	const forbidden = () => {
		throw new Error("File access forbidden in mock routes");
	};
	return {
		...fs,
		readFile: vi.fn(forbidden),
		open: vi.fn(forbidden),
		writeFile: vi.fn(forbidden),
	};
});
const globals = globalThis as typeof globalThis & {
	__tossPortfolioService?: PortfolioService;
	__tossSseHub?: SseHub;
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-29T16:11:00+09:00"));
	vi.stubEnv("TOSS_MOCK", "1");
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Network forbidden in mock routes");
		}),
	);
});
afterEach(async () => {
	await globals.__tossPortfolioService?.stop();
	delete globals.__tossPortfolioService;
	delete globals.__tossSseHub;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("server routes in mock mode", () => {
	it("returns cached data, trend and health with no external network or private files", async () => {
		const response = await portfolio();
		const data = await response.json();
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(data.mock).toBe(true);
		expect(data.holdings).toHaveLength(12);
		expect(data).toEqual(getPortfolioService().peek());
		expect(await (await trend()).json()).toHaveLength(60);
		expect(await (await health()).json()).toEqual({
			ok: true,
			mock: true,
			wsState: "idle",
			lastRefreshAt: data.fetchedAt,
		});
		expect(JSON.stringify(data)).not.toMatch(
			/accountSeq|accountNo|access_token|client_secret/,
		);
		expect(fetch).not.toHaveBeenCalled();
		const fs = await import("node:fs/promises");
		expect(fs.readFile).not.toHaveBeenCalled();
		expect(fs.open).not.toHaveBeenCalled();
		expect(fs.writeFile).not.toHaveBeenCalled();
	});
	it("keeps trend failures generic and prevents a failed ledger read from breaking the dashboard", async () => {
		vi.spyOn(getPortfolioService(), "getTrend").mockRejectedValueOnce(
			new Error("FAKE_PRIVATE_DETAIL"),
		);
		const response = await trend();
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("FAKE_PRIVATE_DETAIL");
		expect((await portfolio()).status).toBe(200);
	});
	it("streams snapshot/status/ticks and a heartbeat, and unsubscribes on request abort", async () => {
		const controller = new AbortController();
		const request = new Request("http://127.0.0.1/api/stream", {
			signal: controller.signal,
		});
		const response = await stream({ request });
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("X-Accel-Buffering")).toBe("no");
		expect(getSseHub().getClientCount()).toBe(1);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing stream");
		const first = new TextDecoder().decode((await reader.read()).value);
		expect(first).toContain("event: snapshot");
		expect(first).toContain("event: status");
		await vi.advanceTimersByTimeAsync(1250);
		expect(new TextDecoder().decode((await reader.read()).value)).toContain(
			"event: ticks",
		);
		await vi.advanceTimersByTimeAsync(13_750);
		let messages = "";
		controller.abort();
		expect(request.signal.aborted).toBe(true);
		expect(getSseHub().getClientCount()).toBe(0);
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			messages += new TextDecoder().decode(chunk.value);
		}
		expect(messages).toContain(": ping");
		expect(getSseHub().getClientCount()).toBe(0);
	});
	it("cleans up reader cancellation and handles already aborted requests", async () => {
		const response = await stream({
			request: new Request("http://127.0.0.1/api/stream"),
		});
		await response.body?.cancel();
		expect(getSseHub().getClientCount()).toBe(0);
		const aborted = await stream({
			request: new Request("http://127.0.0.1/api/stream", {
				signal: AbortSignal.abort(),
			}),
		});
		expect(await aborted.body?.getReader().read()).toEqual({
			done: true,
			value: undefined,
		});
		expect(getSseHub().getClientCount()).toBe(0);
	});
});
