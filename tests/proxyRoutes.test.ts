import { afterEach, expect, it, vi } from "vitest";
import { GET as health } from "../src/routes/api/health";
import { GET as logo } from "../src/routes/api/logo";
import { GET as market } from "../src/routes/api/market";
import { GET as portfolio } from "../src/routes/api/portfolio";
import { GET as sparklines } from "../src/routes/api/sparklines";
import { GET as stream } from "../src/routes/api/stream";
import { GET as trend } from "../src/routes/api/trend";
import * as account from "../src/server/account";
import { readConfig } from "../src/server/config";
import * as ledger from "../src/server/ledger";
import type { LogoService } from "../src/server/logos";
import type { MarketService } from "../src/server/market";
import {
	createPortfolioService,
	getPortfolioService,
	stopPortfolioService,
} from "../src/server/portfolioService";
import { createProxy, type ProxyService } from "../src/server/proxy";
import * as realtime from "../src/server/realtime";
import * as tokens from "../src/server/tokenStore";
import * as toss from "../src/server/tossClient";

const { forbidden } = vi.hoisted(() => ({
	forbidden: () => {
		throw new Error("Local access forbidden in proxy mode");
	},
}));
vi.mock("../src/server/account", () => ({
	createAccountStore: vi.fn(forbidden),
	getAccountSeq: vi.fn(forbidden),
}));
vi.mock("../src/server/ledger", () => ({ createLedger: vi.fn(forbidden) }));
vi.mock("../src/server/realtime", () => ({
	createRealtime: vi.fn(forbidden),
	getRealtime: vi.fn(forbidden),
}));
vi.mock("../src/server/tokenStore", () => ({
	createTokenStore: vi.fn(forbidden),
	getTokenStore: vi.fn(forbidden),
}));
vi.mock("../src/server/tossClient", () => ({
	createTossClient: vi.fn(forbidden),
	getTossClient: vi.fn(forbidden),
}));
vi.mock("../src/server/portfolioService", async (original) => ({
	...(await original<typeof import("../src/server/portfolioService")>()),
	getPortfolioService: vi.fn(forbidden),
}));
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(forbidden),
	open: vi.fn(forbidden),
	writeFile: vi.fn(forbidden),
	mkdir: vi.fn(forbidden),
	rename: vi.fn(forbidden),
	unlink: vi.fn(forbidden),
	stat: vi.fn(forbidden),
}));

const globals = globalThis as typeof globalThis & {
	__tossProxy?: ProxyService;
	__tossLogos?: LogoService;
	__tossMarket?: MarketService;
};
afterEach(() => {
	delete globals.__tossProxy;
	delete globals.__tossLogos;
	delete globals.__tossMarket;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("proxies sparklines and gets FX from upstream while fetching only fixed Yahoo symbols locally", async () => {
	vi.stubEnv("TOSS_MOCK", "0");
	vi.stubEnv("UPSTREAM_URL", "https://upstream.invalid");
	const fetcher = vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input));
		if (url.pathname === "/api/sparklines")
			return Response.json({ FAKEUS: [10, 11] });
		if (url.pathname === "/api/portfolio")
			return Response.json({
				fx: { midRate: 1420, buyRate: 1425, validFrom: "2026-10-29T00:00:00Z" },
			});
		expect(url.hostname).toBe("query1.finance.yahoo.com");
		return Response.json({
			chart: {
				result: [{ meta: { regularMarketPrice: 110, previousClose: 100 } }],
			},
		});
	});
	vi.stubGlobal("fetch", fetcher);
	expect(await (await sparklines()).json()).toEqual({ FAKEUS: [10, 11] });
	const data = await (await market()).json();
	expect(data.items.at(-1)).toMatchObject({ id: "USD/KRW", value: 1420 });
	expect(
		fetcher.mock.calls.filter(
			([url]) => new URL(String(url)).hostname === "query1.finance.yahoo.com",
		),
	).toHaveLength(4);
	expect(getPortfolioService).not.toHaveBeenCalled();
	const fs = await import("node:fs/promises");
	for (const module of [account, ledger, realtime, tokens, toss, fs])
		for (const fn of Object.values(module))
			if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
});

it("returns an empty sparkline route response for an older upstream without that API", async () => {
	vi.stubEnv("TOSS_MOCK", "0");
	vi.stubEnv("UPSTREAM_URL", "https://upstream.invalid");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(null, { status: 404 })),
	);
	const response = await sparklines();
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
	expect(await response.json()).toEqual({});
	expect(getPortfolioService).not.toHaveBeenCalled();
});

it("routes every proxy API without constructing local services, accessing private files, or forwarding client headers", async () => {
	vi.stubEnv("TOSS_MOCK", "0");
	vi.stubEnv("UPSTREAM_URL", "http://upstream.invalid:8790");
	for (const key of [
		"TOSS_ENV_PATH",
		"TOSS_TOKEN_PATH",
		"TOSS_ACCOUNT_PATH",
		"PORTFOLIO_LEDGER_PATH",
	])
		vi.stubEnv(key, "/FAKE_UNREADABLE/unused");
	const fetcher = vi.fn<typeof fetch>(async (input) => {
		const url = new URL(String(input));
		if (url.pathname === "/api/portfolio")
			return Response.json({ holdings: [{ symbol: "FAKEUS", name: "Fake" }] });
		if (url.pathname === "/api/trend")
			return Response.json([{ date: "2026-01-01", totalAssetsKrw: 42 }]);
		if (url.pathname === "/api/health") return Response.json({ ok: true });
		if (url.pathname === "/api/stream")
			return new Response(": fake\n\n", {
				headers: { "Content-Type": "text/event-stream" },
			});
		return new Response(new Uint8Array([0]), {
			headers: { "Content-Type": "image/png" },
		});
	});
	vi.stubGlobal("fetch", fetcher);
	globals.__tossProxy = createProxy({
		upstream: new URL("http://upstream.invalid:8790"),
		fetch: fetcher,
	});
	expect((await portfolio()).status).toBe(200);
	expect(await (await trend()).json()).toEqual([
		{ date: "2026-01-01", totalAssetsKrw: 42 },
	]);
	expect(await (await health()).json()).toEqual({
		ok: true,
		wsState: "idle",
		lastRefreshAt: "",
		proxy: true,
		mock: false,
		upstreamReachable: true,
	});
	const request = (path: string) =>
		new Request(`http://preview.invalid${path}`, {
			headers: {
				Cookie: "FAKE_COOKIE",
				Authorization: "Bearer FAKE_TOKEN",
				"X-Fake": "private",
			},
		});
	expect(await (await stream({ request: request("/api/stream") })).text()).toBe(
		": fake\n\n",
	);
	expect(
		(await logo({ request: request("/api/logo?symbol=UNKNOWN") })).status,
	).toBe(404);
	expect(
		(await logo({ request: request("/api/logo?symbol=FAKEUS") })).status,
	).toBe(200);
	expect(
		fetcher.mock.calls.filter(([url]) =>
			String(url).endsWith("/api/portfolio"),
		),
	).toHaveLength(2);
	expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
		"https://static.toss.im/png-icons/securities/icn-sec-fill-FAKEUS.png",
	);
	for (const [, init] of fetcher.mock.calls) {
		expect(init).toMatchObject({
			method: "GET",
			redirect: "error",
			credentials: "omit",
		});
		expect(init?.headers).toBeUndefined();
	}
	expect(() => createPortfolioService({ config: readConfig() })).toThrow(
		"Local portfolio unavailable in proxy mode",
	);
	await stopPortfolioService();
	expect(getPortfolioService).not.toHaveBeenCalled();
	const fs = await import("node:fs/promises");
	for (const module of [account, ledger, realtime, tokens, toss, fs])
		for (const fn of Object.values(module))
			if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
});
