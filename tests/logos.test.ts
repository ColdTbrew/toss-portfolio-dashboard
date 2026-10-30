import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLogoService,
	logoUrl,
	normalizeLogoSymbol,
} from "../src/server/logos";
import { createMockRaw } from "../src/server/mock";
import { deferred, NOW } from "./fixtures";

afterEach(() => vi.useRealTimers());
const held = [{ symbol: "FAKEUS", name: "Fake Company" }];
function png(size = 8, type = "image/png") {
	return new Response(new Uint8Array(size), {
		headers: { "Content-Type": type },
	});
}
function setup(fetcher = vi.fn<typeof fetch>(async () => png())) {
	let time = 0;
	const getHoldings = vi.fn(async () => held);
	const service = createLogoService({
		mock: false,
		getHoldings,
		fetch: fetcher,
		now: () => time,
	});
	return {
		service,
		fetcher,
		getHoldings,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

describe("symbol mapping", () => {
	it.each([
		["005930", "005930"],
		["A005930", "005930"],
		["BRK-B", "BRK.B"],
		["BRK.B", "BRK.B"],
		["FAKEUS", "FAKEUS"],
	])("maps %s to %s", (symbol, normalized) => {
		expect(normalizeLogoSymbol(symbol)).toBe(normalized);
		expect(logoUrl(symbol)).toBe(
			`https://static.toss.im/png-icons/securities/icn-sec-fill-${normalized}.png`,
		);
	});
	it.each([
		"",
		"fake",
		"../FAKE",
		"FAKE/US",
		"FAKE?x",
		"FAKE#x",
		"FAKE%2FUS",
		" FAKE",
		"FAKE\n",
		".",
		"FAKE..US",
		"FAKE--US",
		"FAKE.",
		"ABCDEFGHIJKLM",
		"가상",
	])("rejects %j", (symbol) => {
		expect(logoUrl(symbol)).toBeNull();
	});
});

it("authorizes holdings before fetching or serving cached images", async () => {
	const { service, fetcher, getHoldings } = setup();
	expect((await service.respond("../FAKE")).status).toBe(404);
	expect(getHoldings).not.toHaveBeenCalled();
	expect((await service.respond("UNKNOWN")).status).toBe(404);
	expect(fetcher).not.toHaveBeenCalled();
	expect((await service.respond("FAKEUS")).status).toBe(200);
	getHoldings.mockResolvedValue([]);
	expect((await service.respond("FAKEUS")).status).toBe(404);
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("returns safe headers, uses GET without forwarded headers, and caches hits for 24 hours", async () => {
	const { service, fetcher, advance } = setup();
	const response = await service.respond("FAKEUS");
	expect(Object.fromEntries(response.headers)).toEqual({
		"content-type": "image/png",
		"cache-control": "private, max-age=86400",
		"x-content-type-options": "nosniff",
	});
	expect((await response.arrayBuffer()).byteLength).toBe(8);
	expect(fetcher.mock.calls[0][1]).toEqual({
		method: "GET",
		redirect: "error",
		credentials: "omit",
		signal: expect.any(AbortSignal),
	});
	advance(86_400_000 - 1);
	expect((await service.respond("FAKEUS")).status).toBe(200);
	expect(fetcher).toHaveBeenCalledTimes(1);
	advance(1);
	await service.respond("FAKEUS");
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
	403,
	404,
	500,
	"error",
])("negative caches %s for one hour", async (status) => {
	const fetcher = vi.fn<typeof fetch>(async () => {
		if (status === "error") throw new Error("FAKE_PRIVATE_DETAIL");
		return new Response(null, { status: Number(status) });
	});
	const { service, advance } = setup(fetcher);
	const response = await service.respond("FAKEUS");
	expect(response.status).toBe(404);
	expect(await response.text()).toBe("");
	advance(3_600_000 - 1);
	await service.respond("FAKEUS");
	expect(fetcher).toHaveBeenCalledTimes(1);
	advance(1);
	await service.respond("FAKEUS");
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it("deduplicates concurrent normalized symbols and gives each response its own bytes", async () => {
	const pending = deferred<Response>();
	const fetcher = vi.fn<typeof fetch>(() => pending.promise);
	const service = createLogoService({
		mock: false,
		fetch: fetcher,
		getHoldings: async () => [{ symbol: "FAKE-A", name: "Fake" }],
	});
	const first = service.respond("FAKE-A");
	const second = service.respond("FAKE.A");
	await Promise.resolve();
	expect(fetcher).toHaveBeenCalledTimes(1);
	pending.resolve(png());
	expect(await (await first).arrayBuffer()).toEqual(
		await (await second).arrayBuffer(),
	);
});

it("bounds the combined hit/miss cache to 200 entries", async () => {
	const rows = Array.from({ length: 201 }, (_, i) => ({
		symbol: `FAKE${i}`,
		name: "Fake",
	}));
	const fetcher = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 404 }),
	);
	const service = createLogoService({
		mock: false,
		fetch: fetcher,
		getHoldings: async () => rows,
	});
	for (const row of rows) await service.respond(row.symbol);
	await service.respond(rows[200].symbol);
	expect(fetcher).toHaveBeenCalledTimes(201);
	await service.respond(rows[0].symbol);
	expect(fetcher).toHaveBeenCalledTimes(202);
});

it.each([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/png; charset=binary",
])("accepts %s up to exactly 256 KB", async (type) => {
	const { service } = setup(vi.fn(async () => png(256 * 1024, type)));
	expect((await service.respond("FAKEUS")).status).toBe(200);
});

it.each([
	"image/svg+xml",
	"text/html",
	"application/json",
	"",
	"image/gif",
])("rejects %s", async (type) => {
	const { service } = setup(vi.fn(async () => png(8, type)));
	expect((await service.respond("FAKEUS")).status).toBe(404);
});

it("rejects oversized content-length before reading, oversized streamed bodies, and empty images", async () => {
	const read = vi.fn();
	const declared = new Response(
		new ReadableStream({ pull: read }, { highWaterMark: 0 }),
		{
			headers: {
				"Content-Type": "image/png",
				"Content-Length": String(256 * 1024 + 1),
			},
		},
	);
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(declared)
		.mockResolvedValueOnce(png(256 * 1024 + 1))
		.mockResolvedValueOnce(png(0));
	const { service, advance } = setup(fetcher);
	for (let i = 0; i < 3; i++) {
		expect((await service.respond("FAKEUS")).status).toBe(404);
		advance(3_600_000);
	}
	expect(read).not.toHaveBeenCalled();
});

it.each([
	false,
	true,
])("times out fetching or reading an image after 5 seconds (body: %s)", async (body) => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((resolve, reject) => {
				if (body)
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
							{ headers: { "Content-Type": "image/png" } },
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
	const { service } = setup(fetcher);
	const response = service.respond("FAKEUS");
	await vi.advanceTimersByTimeAsync(4999);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect((await response).status).toBe(404);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
});

it("makes distinct deterministic palette-coloured mock icons without network calls", async () => {
	const fetcher = vi.fn<typeof fetch>(() => {
		throw new Error("Network forbidden");
	});
	const rows = createMockRaw(NOW).holdings?.items ?? [];
	const service = createLogoService({
		mock: true,
		fetch: fetcher,
		getHoldings: async () => rows,
	});
	const icons = new Set<string>();
	const colors = new Set<string>();
	for (const row of rows) {
		const response = await service.respond(row.symbol);
		if (["FAKEK2", "FAKEU2"].includes(row.symbol)) {
			expect(response.status).toBe(404);
			continue;
		}
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
		const svg = await response.text();
		expect(svg).toBe(await (await service.respond(row.symbol)).text());
		expect(svg).toContain(`>${row.name[0]}${row.symbol.slice(-1)}</text>`);
		expect(svg).toContain('width="24" height="24"');
		expect(svg).toMatch(
			/<circle cx="12" cy="12" r="12" fill="#(?:6265e8|299f91|758198|172337)"\/>/,
		);
		expect(svg).not.toMatch(/#(?:e34e59|347ce4)/);
		colors.add(svg.match(/<circle[^>]+fill="([^"]+)"/)?.[1] ?? "");
		expect(svg).toContain('font-size="10"');
		expect(svg).toContain('fill="#ffffff"');
		icons.add(svg);
	}
	expect(icons.size).toBe(10);
	expect(colors.size).toBe(4);
	expect(fetcher).not.toHaveBeenCalled();
});

it("keeps markup characters out of mock initials", async () => {
	const service = createLogoService({
		mock: true,
		getHoldings: async () => [{ symbol: "000001", name: "<&가상>" }],
	});
	const svg = await (await service.respond("000001")).text();
	expect(svg).toContain(">가1</text>");
	expect(svg).not.toContain("<&");
});
