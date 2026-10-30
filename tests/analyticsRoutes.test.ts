import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildState } from "../src/lib/compute";
import { GET } from "../src/routes/api/analytics";
import { GET as sparklines } from "../src/routes/api/sparklines";
import { getPortfolioService } from "../src/server/portfolioService";
import { getTossClient } from "../src/server/tossClient";
import { NOW, rawFixture } from "./fixtures";

const { getPortfolio, getCandles } = vi.hoisted(() => ({
	getPortfolio: vi.fn(),
	getCandles: vi.fn(),
}));
vi.mock("../src/server/portfolioService", () => ({
	getPortfolioService: vi.fn(() => ({ getPortfolio })),
}));
vi.mock("../src/server/tossClient", () => ({
	getTossClient: vi.fn(() => ({ getCandles })),
}));
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(() => {
		throw new Error("Private file access forbidden");
	}),
}));
const globals = globalThis as typeof globalThis & {
	__tossCandles?: unknown;
	__tossHistory?: unknown;
	__tossProxy?: unknown;
};
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.stubEnv("UPSTREAM_URL", undefined);
});
afterEach(() => {
	delete globals.__tossCandles;
	delete globals.__tossHistory;
	delete globals.__tossProxy;
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("mock analytics route renders all series without network, files or portfolio startup", async () => {
	vi.stubEnv("TOSS_MOCK", "1");
	const request = vi.fn(() => {
		throw new Error("Network forbidden");
	});
	vi.stubGlobal("fetch", request);
	const response = await GET();
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
	const data = await response.json();
	expect(data).toEqual(await (await GET()).json());
	expect(Object.keys(data.candles)).toHaveLength(12);
	expect(Object.keys(data.benchmarks)).toEqual(["^KS11", "^GSPC", "^IXIC"]);
	expect(data.usdkrw).toHaveLength(200);
	for (const values of Object.values(data.candles))
		expect(values).toHaveLength(200);
	expect(request).not.toHaveBeenCalled();
	expect(getTossClient).not.toHaveBeenCalled();
	expect(getPortfolioService).not.toHaveBeenCalled();
	expect((await import("node:fs/promises")).readFile).not.toHaveBeenCalled();
});
it("real route reads only current holdings, omits failures and shares the sparkline cache", async () => {
	vi.stubEnv("TOSS_MOCK", "0");
	getPortfolio.mockResolvedValue(buildState(rawFixture()));
	getCandles.mockImplementation(async (symbol: string) => {
		if (symbol === "FAKEUS") throw new Error("FAKE_PRIVATE_DETAIL");
		return [
			{ date: "2026-10-28", close: 100 },
			{ date: "2026-10-29", close: 110 },
		];
	});
	const request = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 503 }),
	);
	vi.stubGlobal("fetch", request);
	const response = await GET();
	const data = await response.json();
	expect(Object.keys(data.candles)).toEqual(["FAKEKR"]);
	expect(data.benchmarks).toEqual({});
	expect(data.usdkrw).toEqual([]);
	expect(getCandles.mock.calls.map(([symbol]) => symbol)).toEqual([
		"FAKEKR",
		"FAKEUS",
	]);
	expect(await (await sparklines()).json()).toEqual({ FAKEKR: [100, 110] });
	expect(getCandles).toHaveBeenCalledTimes(2);
	for (const [url] of request.mock.calls)
		expect(String(url)).not.toContain("FAKE");
	getPortfolio.mockResolvedValue({ holdings: [] });
	expect((await (await GET()).json()).candles).toEqual({});
});
it("proxy route forwards analytics and never constructs a local data service", async () => {
	vi.stubEnv("TOSS_MOCK", "0");
	vi.stubEnv("UPSTREAM_URL", "https://upstream.invalid");
	const payload = {
		fetchedAt: new Date(NOW).toISOString(),
		candles: { FAKEUS: [{ date: "2026-10-29", close: 110 }] },
		benchmarks: { "^KS11": [{ date: "2026-10-29", close: 100 }] },
		usdkrw: [{ date: "2026-10-29", close: 1300 }],
	};
	const request = vi.fn<typeof fetch>(async () => Response.json(payload));
	vi.stubGlobal("fetch", request);
	expect(await (await GET()).json()).toEqual(payload);
	expect(request).toHaveBeenCalledTimes(1);
	expect(String(request.mock.calls[0][0])).toBe(
		"https://upstream.invalid/api/analytics",
	);
	expect(getTossClient).not.toHaveBeenCalled();
	expect(getPortfolioService).not.toHaveBeenCalled();
	expect(globals.__tossCandles).toBeUndefined();
	expect(globals.__tossHistory).toBeUndefined();
	request.mockResolvedValue(new Response(null, { status: 404 }));
	const response = await GET();
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
	expect(await response.json()).toEqual({
		fetchedAt: payload.fetchedAt,
		candles: {},
		benchmarks: {},
		usdkrw: [],
	});
});
