import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAccountStore } from "../src/server/account";
import { fixtureConfig, NOW } from "./fixtures";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "toss-fake-account-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

it("uses the shared accountSeq cache without listing accounts", async () => {
	const config = fixtureConfig(directory);
	await writeFile(config.accountPath, JSON.stringify({ accountSeq: 42 }));
	const client = { listAccounts: vi.fn() };
	const store = createAccountStore({ config, client });
	expect(await store.getAccountSeq()).toBe(42);
	expect(client.listAccounts).not.toHaveBeenCalled();
});

it("lists once for concurrent calls and saves the brokerage account in the shared schema", async () => {
	const config = fixtureConfig(directory);
	const client = {
		listAccounts: vi.fn(async () => [
			{
				accountSeq: 41,
				accountType: "FAKE_OTHER",
				accountNoMasked: "*****1111",
			},
			{
				accountSeq: 42,
				accountType: "BROKERAGE",
				accountNoMasked: "*****9999",
			},
		]),
	};
	const store = createAccountStore({ config, client, now: () => NOW });
	expect(
		await Promise.all(Array.from({ length: 10 }, () => store.getAccountSeq())),
	).toEqual(Array(10).fill(42));
	expect(client.listAccounts).toHaveBeenCalledTimes(1);
	expect(JSON.parse(await readFile(config.accountPath, "utf8"))).toEqual({
		accountSeq: 42,
		accountType: "BROKERAGE",
		accountNoMasked: "*****9999",
		count: 2,
		cachedAt: "2026-10-29T16:11:00.000+09:00",
	});
});

it("blocks account IO in mock mode", async () => {
	const client = { listAccounts: vi.fn() };
	const store = createAccountStore({
		config: fixtureConfig(directory, { TOSS_MOCK: "1" }),
		client,
	});
	await expect(store.getAccountSeq()).rejects.toThrow("mock mode");
	expect(await readdir(directory)).toEqual([]);
	expect(client.listAccounts).not.toHaveBeenCalled();
});
