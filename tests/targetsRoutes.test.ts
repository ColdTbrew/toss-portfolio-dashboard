import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TARGET_BODY_LIMIT, targetMessages } from "../src/lib/targets";
import { GET, methodNotAllowed, PUT, Route } from "../src/routes/api/targets";
import { createProxy } from "../src/server/proxy";
import { NOW } from "./fixtures";

let directory: string;
const globals = globalThis as typeof globalThis & {
	__mockTargets?: unknown;
	__tossProxy?: unknown;
};
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "fake-target-routes-"));
	vi.stubEnv("TOSS_MOCK", "0");
	vi.stubEnv("UPSTREAM_URL", undefined);
	vi.stubEnv("TARGET_WEIGHTS_PATH", join(directory, "targets.json"));
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Network forbidden");
		}),
	);
});
afterEach(async () => {
	delete globals.__mockTargets;
	delete globals.__tossProxy;
	await rm(directory, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});
const request = (
	body = JSON.stringify({ targets: { FAKE: 50, CASH: 5 } }),
	headers: Record<string, string | undefined> = {},
) =>
	new Request("https://dashboard.invalid/api/targets", {
		method: "PUT",
		body,
		headers: Object.fromEntries(
			Object.entries({
				"Content-Type": "application/json",
				Host: "dashboard.invalid",
				...headers,
			}).filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
	});

it("handles GET and PUT, rejects every other method and serves no-store documents", async () => {
	expect(Object.keys(Route.options.server?.handlers ?? {})).toEqual([
		"GET",
		"PUT",
		"ANY",
	]);
	expect(Route.options.server?.handlers).toMatchObject({
		ANY: methodNotAllowed,
	});
	expect(methodNotAllowed().status).toBe(405);
	expect(
		(
			await GET({
				request: new Request("https://dashboard.invalid/api/targets", {
					method: "HEAD",
				}),
			})
		).status,
	).toBe(405);
	const empty = await GET();
	expect(empty.headers.get("Cache-Control")).toBe("no-store");
	expect(await empty.json()).toEqual({
		targets: {},
		updatedAt: null,
		editable: true,
	});
	const response = await PUT({
		request: request(undefined, {
			Origin: "https://dashboard.invalid",
			"Sec-Fetch-Site": "same-origin",
		}),
	});
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	const saved = await response.json();
	expect(saved).toEqual({
		version: 1,
		updatedAt: expect.any(String),
		targets: { FAKE: 50, CASH: 5 },
	});
	expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true);
	expect(await (await GET()).json()).toEqual({
		targets: saved.targets,
		updatedAt: saved.updatedAt,
		editable: true,
	});
	expect(
		JSON.parse(await readFile(join(directory, "targets.json"), "utf8")),
	).toEqual(saved);
	expect((await stat(join(directory, "targets.json"))).mode & 0o777).toBe(
		0o600,
	);
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	{ "Sec-Fetch-Site": "cross-site" },
	{ "Sec-Fetch-Site": "same-site" },
	{ "Sec-Fetch-Site": "none" },
	{ "Sec-Fetch-Site": "" },
	{ Origin: "https://other.invalid" },
	{ Origin: "null" },
	{ Origin: "invalid" },
	{ Origin: "https://dashboard.invalid:444" },
	{ Origin: "https://dashboard.invalid", Host: "different.invalid" },
	{ "Sec-Fetch-Site": "same-origin", Origin: "https://other.invalid" },
])("rejects cross-site writes before touching files case %#", async (headers) => {
	const response = await PUT({
		request: request(undefined, headers),
	});
	expect(response.status).toBe(403);
	expect(await response.json()).toEqual({ error: targetMessages.origin });
	expect(await readdir(directory)).toEqual([]);
});

it.each([
	"text/plain",
	"application/x-www-form-urlencoded",
	"application/ld+json",
	"",
])("requires JSON Content-Type case %#", async (type) => {
	expect(
		(await PUT({ request: request(undefined, { "Content-Type": type }) }))
			.status,
	).toBe(415);
	expect(await readdir(directory)).toEqual([]);
});

it("accepts JSON charset and handles invalid JSON, payloads and percent constraints as Korean 400 errors", async () => {
	expect(
		(
			await PUT({
				request: request(undefined, {
					"Content-Type": "application/json; charset=utf-8",
				}),
			})
		).status,
	).toBe(200);
	const saved = await readFile(join(directory, "targets.json"), "utf8");
	for (const body of [
		"FAKE_BROKEN_BODY",
		"null",
		"[]",
		"{}",
		'{"targets":{"FAKE":-1}}',
		'{"targets":{"FAKE":1.111}}',
		'{"targets":{"FAKE":80,"CASH":30}}',
		'{"targets":{"bad":5}}',
		'{"targets":{"FAKE":5},"extra":true}',
	]) {
		const response = await PUT({ request: request(body) });
		expect(response.status).toBe(400);
		const message = await response.json();
		expect(message.error).toMatch(/[가-힣]/);
		expect(message.error).not.toContain("FAKE");
	}
	expect(await readFile(join(directory, "targets.json"), "utf8")).toBe(saved);
});

it("limits actual streamed UTF-8 bytes, including missing or dishonest Content-Length", async () => {
	const prefix = '{"targets":{}}';
	const exact = prefix.padEnd(TARGET_BODY_LIMIT, " ");
	expect((await PUT({ request: request(exact) })).status).toBe(200);
	for (const headers of [
		{},
		{ "Content-Length": "1" },
		{ "Content-Length": "4097" },
	]) {
		const response = await PUT({ request: request(`${exact} `, headers) });
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: targetMessages.size });
	}
	expect(
		(await PUT({ request: request(`"${"가".repeat(1400)}"`) })).status,
	).toBe(400);
	const cancel = vi.fn();
	let index = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			controller.enqueue(new TextEncoder().encode(index++ === 0 ? exact : " "));
		},
		cancel,
	});
	const streamed = new Request("https://dashboard.invalid/api/targets", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: stream,
		duplex: "half",
	} as RequestInit);
	expect((await PUT({ request: streamed })).status).toBe(400);
	expect(cancel).toHaveBeenCalled();
});

it("returns generic 500 for corrupt files on both GET and PUT without overwriting or logging contents", async () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	await writeFile(join(directory, "targets.json"), "FAKE_PRIVATE_CONTENT");
	for (const response of [await GET(), await PUT({ request: request() })]) {
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain("FAKE");
	}
	expect(warn.mock.calls).toEqual(
		Array(2).fill(["Targets: invalid file; left unchanged"]),
	);
	expect(await readFile(join(directory, "targets.json"), "utf8")).toBe(
		"FAKE_PRIVATE_CONTENT",
	);
});

it("returns generic errors for unavailable storage", async () => {
	vi.stubEnv("TARGET_WEIGHTS_PATH", join(directory, "missing", "targets.json"));
	const result = await PUT({ request: request() });
	expect(result.status).toBe(500);
	expect(await result.json()).toEqual({ error: targetMessages.save });
	vi.stubEnv("TARGET_WEIGHTS_PATH", directory);
	expect((await GET()).status).toBe(500);
});

it("serves seeded mock data and updates only shared memory even with unusable storage", async () => {
	vi.stubEnv("TOSS_MOCK", "1");
	vi.stubEnv("TARGET_WEIGHTS_PATH", join(directory, "missing", "targets.json"));
	const seed = await (await GET()).json();
	expect(Object.keys(seed.targets)).toHaveLength(13);
	expect(await (await GET()).json()).toEqual(seed);
	expect((await PUT({ request: request() })).status).toBe(200);
	expect((await (await GET()).json()).targets).toEqual({ FAKE: 50, CASH: 5 });
	expect(await readdir(directory)).toEqual([]);
	expect(fetch).not.toHaveBeenCalled();
});

it("forwards proxy GET only, forces editable false and rejects PUT without forwarding it", async () => {
	vi.stubEnv("UPSTREAM_URL", "https://upstream.invalid");
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({
			targets: { FAKE: 20 },
			updatedAt: new Date(NOW).toISOString(),
			editable: true,
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	expect(await (await GET()).json()).toEqual({
		targets: { FAKE: 20 },
		updatedAt: new Date(NOW).toISOString(),
		editable: false,
	});
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		new URL("https://upstream.invalid/api/targets"),
		{
			method: "GET",
			redirect: "error",
			credentials: "omit",
			signal: expect.any(AbortSignal),
		},
	);
	expect((await PUT({ request: request() })).status).toBe(405);
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(await readdir(directory)).toEqual([]);
});

it.each([
	"404",
	"500",
	"network",
	"invalid",
	"wrong-type",
])("returns empty read-only proxy data on failure case %s", async (kind) => {
	vi.stubEnv("UPSTREAM_URL", "https://upstream.invalid");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			if (kind === "network") throw new Error("FAKE_UPSTREAM_DETAIL");
			if (kind === "invalid")
				return Response.json({ targets: { FAKE: 101 }, updatedAt: null });
			if (kind === "wrong-type") return new Response("FAKE_HTML");
			return new Response(null, { status: Number(kind) });
		}),
	);
	const response = await GET();
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(await response.json()).toEqual({
		targets: {},
		updatedAt: null,
		editable: false,
	});
});

it("bounds target proxy fetches to 10 seconds", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("FAKE_TIMEOUT")),
				);
			}),
	);
	const pending = createProxy({
		upstream: new URL("https://upstream.invalid"),
		fetch: fetcher,
	}).getTargets();
	await vi.advanceTimersByTimeAsync(9999);
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect(await pending).toEqual({
		targets: {},
		updatedAt: null,
		editable: false,
	});
	expect(vi.getTimerCount()).toBe(0);
});
