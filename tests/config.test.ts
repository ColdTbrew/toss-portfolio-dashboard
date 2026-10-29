import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readConfig, readCredentials } from "../src/server/config";
import { fixtureConfig } from "./fixtures";

it("expands home paths, validates timing, and disables snapshots in mock mode", () => {
	const config = readConfig({ TOSS_MOCK: "1" }, "/tmp/FAKE_HOME");
	expect(config.tokenPath).toBe("/tmp/FAKE_HOME/invest/.token.json");
	expect(config.snapshotEnabled).toBe(false);
	expect(config.refreshHoldingsMs).toBe(30_000);
	expect(config.refreshCashFxMs).toBe(60_000);
	expect(() => readConfig({ SNAPSHOT_TIME_KST: "25:00" })).toThrow(
		"SNAPSHOT_TIME_KST",
	);
	expect(() => readConfig({ REFRESH_HOLDINGS_SEC: "0" })).toThrow(
		"REFRESH_HOLDINGS_SEC",
	);
});

it("reads only configured fake credentials, honors env precedence, and masks file errors", async () => {
	const directory = await mkdtemp(join(tmpdir(), "toss-fake-config-"));
	try {
		const config = fixtureConfig(directory);
		await expect(readCredentials(config, {})).rejects.toThrow("TOSS_ENV_PATH");
		await writeFile(
			config.envPath,
			"# fake fixture only\nTOSS_CLIENT_ID=\"FAKE_FILE_ID\"\nTOSS_CLIENT_SECRET='FAKE_FILE_SECRET'\n",
		);
		expect(
			await readCredentials(config, { TOSS_CLIENT_ID: "FAKE_ENV_ID" }),
		).toEqual({ clientId: "FAKE_ENV_ID", clientSecret: "FAKE_FILE_SECRET" });
		await expect(
			readCredentials({ ...config, mock: true }, {}),
		).rejects.toThrow("mock mode");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
