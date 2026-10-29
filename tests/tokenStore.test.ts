import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonAtomic } from "../src/server/atomicWrite";
import { withFileLock } from "../src/server/fileLock";
import { createTokenStore } from "../src/server/tokenStore";
import { fixtureConfig, NOW } from "./fixtures";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "toss-fake-token-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
function setup() {
	const config = fixtureConfig(directory);
	const request = vi.fn<typeof fetch>().mockImplementation(
		async () =>
			new Response(
				JSON.stringify({
					access_token: "FAKE_NEW_TOKEN",
					token_type: "Bearer",
					expires_in: 3600,
				}),
			),
	);
	const options = {
		config,
		fetch: request,
		now: () => NOW,
		credentials: async () => ({
			clientId: "FAKE_CLIENT_ID",
			clientSecret: "FAKE_CLIENT_SECRET",
		}),
	};
	return { config, request, options, store: createTokenStore(options) };
}
async function cache(
	path: string,
	token = "FAKE_CACHED_TOKEN",
	expires = NOW / 1000 + 3600,
	issued = NOW / 1000 - 1000,
) {
	await writeJsonAtomic(path, {
		access_token: token,
		token_type: "Bearer",
		issued_at: issued,
		expires_at: expires,
	});
}

describe("token cache and file locking", () => {
	it("reuses a valid cache without credentials, a lock, or issuance", async () => {
		const { config, request, store } = setup();
		await cache(config.tokenPath);
		expect(await store.getToken()).toBe("FAKE_CACHED_TOKEN");
		expect(request).not.toHaveBeenCalled();
		expect(await readdir(directory)).toEqual(["fake-token.json"]);
	});
	it("refreshes inside the 120 second margin and saves the exact shared format with mode 600", async () => {
		const { config, request, store } = setup();
		await cache(config.tokenPath, "FAKE_OLD", NOW / 1000 + 120);
		expect(await store.getToken()).toBe("FAKE_NEW_TOKEN");
		expect(request).toHaveBeenCalledTimes(1);
		expect(JSON.parse(await readFile(config.tokenPath, "utf8"))).toEqual({
			access_token: "FAKE_NEW_TOKEN",
			token_type: "Bearer",
			issued_at: NOW / 1000,
			expires_at: NOW / 1000 + 3600,
		});
		expect((await stat(config.tokenPath)).mode & 0o777).toBe(0o600);
		expect(await readdir(directory)).toEqual(["fake-token.json"]);
	});
	it("collapses ten concurrent calls into one issuance", async () => {
		const { store, request } = setup();
		expect(
			await Promise.all(Array.from({ length: 10 }, () => store.getToken())),
		).toEqual(Array(10).fill("FAKE_NEW_TOKEN"));
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("serializes rejections arriving during a normal cache read", async () => {
		const { config, store, request } = setup();
		await cache(config.tokenPath);
		const normal = store.getToken();
		const rejected = Array.from({ length: 10 }, () =>
			store.getToken({ rejectedToken: "FAKE_CACHED_TOKEN" }),
		);
		expect(await normal).toBe("FAKE_CACHED_TOKEN");
		expect(await Promise.all(rejected)).toEqual(
			Array(10).fill("FAKE_NEW_TOKEN"),
		);
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("independent stores contend on the file lock and only issue once", async () => {
		const { store, request, options } = setup();
		const second = createTokenStore(options);
		expect(await Promise.all([store.getToken(), second.getToken()])).toEqual([
			"FAKE_NEW_TOKEN",
			"FAKE_NEW_TOKEN",
		]);
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("rereads the cache after another process publishes while holding the lock", async () => {
		const { config, options, request } = setup();
		await writeFile(
			`${config.tokenPath}.lock`,
			JSON.stringify({ pid: process.pid, host: hostname(), createdAt: NOW }),
		);
		const store = createTokenStore({
			...options,
			lock: {
				sleep: async () => {
					await cache(config.tokenPath, "FAKE_OTHER_PROCESS");
					await rm(`${config.tokenPath}.lock`);
				},
			},
		});
		expect(await store.getToken()).toBe("FAKE_OTHER_PROCESS");
		expect(request).not.toHaveBeenCalled();
	});
	it("reclaims an old lock and releases its own lock after errors", async () => {
		const { config, store } = setup();
		await writeFile(`${config.tokenPath}.lock`, "incomplete fake lock");
		await utimes(
			`${config.tokenPath}.lock`,
			new Date(NOW - 31_000),
			new Date(NOW - 31_000),
		);
		expect(await store.getToken()).toBe("FAKE_NEW_TOKEN");
		await expect(
			withFileLock(`${directory}/test.lock`, async () => {
				throw new Error("FAKE failure");
			}),
		).rejects.toThrow("FAKE failure");
		expect(await readdir(directory)).toEqual(["fake-token.json"]);
	});
	it("times out on an active lock without deleting it", async () => {
		const path = `${directory}/test.lock`;
		await writeFile(
			path,
			JSON.stringify({ pid: process.pid, host: hostname(), createdAt: NOW }),
		);
		let time = NOW;
		await expect(
			withFileLock(path, async () => 1, {
				timeoutMs: 200,
				now: () => time,
				sleep: async (ms) => {
					time += ms;
				},
			}),
		).rejects.toThrow("timeout");
		expect((await stat(path)).isFile()).toBe(true);
	});
	it("reuses another process's replacement, refreshes rejected old tokens, and prevents 401 ping-pong", async () => {
		const { config, store, request } = setup();
		await cache(config.tokenPath, "FAKE_EXTERNAL_TOKEN");
		expect(await store.getToken({ rejectedToken: "FAKE_REJECTED" })).toBe(
			"FAKE_EXTERNAL_TOKEN",
		);
		expect(request).not.toHaveBeenCalled();
		expect(await store.getToken({ rejectedToken: "FAKE_EXTERNAL_TOKEN" })).toBe(
			"FAKE_NEW_TOKEN",
		);
		await expect(
			store.getToken({ rejectedToken: "FAKE_NEW_TOKEN" }),
		).rejects.toThrow("60 seconds");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("retries OAuth 401 once with Basic authentication", async () => {
		const { store, request } = setup();
		request.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "invalid_client" }), {
				status: 401,
			}),
		);
		await store.getToken();
		expect(request).toHaveBeenCalledTimes(2);
		const first = request.mock.calls[0][1];
		const second = request.mock.calls[1][1];
		expect(first?.body?.toString()).toContain("client_id=FAKE_CLIENT_ID");
		expect(new Headers(second?.headers).get("Authorization")).toMatch(
			/^Basic /,
		);
		expect(second?.body?.toString()).toBe("grant_type=client_credentials");
	});
	it("rejects mock access before opening cache files or invoking fetch", async () => {
		const { options, request } = setup();
		const store = createTokenStore({
			...options,
			config: { ...options.config, mock: true },
		});
		await expect(store.getToken()).rejects.toThrow("mock mode");
		expect(request).not.toHaveBeenCalled();
		expect(await readdir(directory)).toEqual([]);
	});
});

describe("Toss token compatibility", () => {
	it.each([
		"Bearer",
		"bearer",
		"bEaReR",
	])("reuses a %s cache without issuance", async (tokenType) => {
		const { config, store, request } = setup();
		await writeJsonAtomic(config.tokenPath, {
			access_token: "FAKE_CACHED_TOKEN",
			token_type: tokenType,
			issued_at: NOW / 1000 - 1000,
			expires_at: NOW / 1000 + 3600,
		});
		expect(await store.getToken()).toBe("FAKE_CACHED_TOKEN");
		expect(request).not.toHaveBeenCalled();
	});
	it.each([
		["bearer", "3600"],
		["Bearer", "3600.5"],
		["BEARER", 3600],
	])("accepts %s and numeric expiration %s", async (tokenType, expiration) => {
		const { config, store, request } = setup();
		request.mockResolvedValueOnce(
			Response.json({
				access_token: "FAKE_COMPATIBLE_TOKEN",
				token_type: tokenType,
				expires_in: expiration,
			}),
		);
		expect(await store.getToken()).toBe("FAKE_COMPATIBLE_TOKEN");
		expect(JSON.parse(await readFile(config.tokenPath, "utf8"))).toEqual({
			access_token: "FAKE_COMPATIBLE_TOKEN",
			token_type: "Bearer",
			issued_at: NOW / 1000,
			expires_at: NOW / 1000 + Number(expiration),
		});
	});
	it.each([
		null,
		true,
		[],
		{},
		"",
		"bad",
		"Infinity",
		"120",
		"-5",
	])("rejects invalid expiration %j", async (expiration) => {
		const { store, request } = setup();
		request.mockResolvedValueOnce(
			Response.json({
				access_token: "FAKE_INVALID_TOKEN",
				token_type: "bearer",
				expires_in: expiration,
			}),
		);
		await expect(store.getToken()).rejects.toThrow("Invalid token response");
	});
	it.each([
		"Basic",
		null,
		42,
	])("rejects invalid token types %j", async (tokenType) => {
		const { store, request } = setup();
		request.mockResolvedValueOnce(
			Response.json({
				access_token: "FAKE_INVALID_TOKEN",
				token_type: tokenType,
				expires_in: "3600",
			}),
		);
		await expect(store.getToken()).rejects.toThrow("Invalid token response");
	});
});
