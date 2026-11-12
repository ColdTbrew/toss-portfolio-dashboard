import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildState } from "../src/lib/compute";
import { GET } from "../src/routes/api/realized";
import { getAccountSeq } from "../src/server/account";
import { getPortfolioService } from "../src/server/portfolioService";
import { getTossClient } from "../src/server/tossClient";
import { rawFixture } from "./fixtures";

const { getTransactions, getPortfolio } = vi.hoisted(() => ({
	getTransactions: vi.fn(),
	getPortfolio: vi.fn(),
}));
vi.mock("../src/server/account", () => ({
	getAccountSeq: vi.fn(async () => 42),
}));
vi.mock("../src/server/tossClient", () => ({
	getTossClient: vi.fn(() => ({ getTransactions })),
}));
vi.mock("../src/server/portfolioService", () => ({
	getPortfolioService: vi.fn(() => ({ getPortfolio })),
}));
const globals = globalThis as typeof globalThis & {
	__transactionsCache?: unknown;
	__tossProxy?: unknown;
};
let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "fake-realized-route-"));
	vi.stubEnv("PORTFOLIO_LEDGER_PATH", join(directory, "fake-ledger.jsonl"));
	vi.stubEnv("TRANSACTIONS_CACHE_PATH", undefined);
	vi.stubEnv("UPSTREAM_URL", undefined);
	vi.stubEnv("TOSS_MOCK", "0");
	getPortfolio.mockResolvedValue(buildState(rawFixture()));
	getTransactions.mockResolvedValue({
		transactions: [],
		hasNext: false,
		nextCursor: null,
	});
});
afterEach(async () => {
	delete globals.__transactionsCache;
	delete globals.__tossProxy;
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await rm(directory, { recursive: true, force: true });
});
it("wires real history and existing holdings/FX, caches subsequent requests and masks query responses", async () => {
	const response = await GET();
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=30");
	expect(await response.json()).toMatchObject({
		basis: "settlement",
		totals: { day: { realizedKrw: 0 } },
	});
	expect(getTransactions).toHaveBeenCalledExactlyOnceWith(42, { limit: 100 });
	expect(getPortfolio).toHaveBeenCalledOnce();
	const masked = await GET({
		request: new Request("https://fake.invalid/api/realized?masked=1"),
	});
	expect((await masked.json()).totals.day).toMatchObject({
		realizedKrw: null,
		byCcy: null,
		pendingKrw: null,
	});
	expect(getTransactions).toHaveBeenCalledOnce();
});
it("returns a safe 503 on initial history failure and keeps failing during the retry cooldown", async () => {
	getTransactions.mockRejectedValue(new Error("FAKE_PRIVATE_FAILURE"));
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		for (let i = 0; i < 2; i++) {
			const response = await GET();
			expect(response.status).toBe(503);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.text()).not.toContain("FAKE_PRIVATE_FAILURE");
		}
		expect(getTransactions).toHaveBeenCalledOnce();
	} finally {
		warn.mockRestore();
	}
});
it("forwards the privacy query in proxy mode, hides unsupported upstream, and never starts local services", async () => {
	vi.stubEnv("UPSTREAM_URL", "https://fake-upstream.invalid");
	const request = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 404 }),
	);
	vi.stubGlobal("fetch", request);
	const response = await GET({
		request: new Request("https://fake.invalid/api/realized?masked=1"),
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toBeNull();
	expect(String(request.mock.calls[0][0])).toBe(
		"https://fake-upstream.invalid/api/realized?masked=1",
	);
	expect(getTossClient).not.toHaveBeenCalled();
	expect(getAccountSeq).not.toHaveBeenCalled();
	expect(getPortfolioService).not.toHaveBeenCalled();
});
