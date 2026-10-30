import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readConfig, readCredentials } from "../src/server/config";
import { fixtureConfig } from "./fixtures";

it("places targets beside the resolved ledger unless explicitly overridden", () => {
	expect(readConfig({}, "/tmp/FAKE_HOME").targetsPath).toBe(
		"/tmp/FAKE_HOME/invest/targets.json",
	);
	expect(
		readConfig(
			{ PORTFOLIO_LEDGER_PATH: "~/fake-data/history.jsonl" },
			"/tmp/FAKE_HOME",
		).targetsPath,
	).toBe("/tmp/FAKE_HOME/fake-data/targets.json");
	expect(
		readConfig({ PORTFOLIO_LEDGER_PATH: "/tmp/fake-ledger/history.jsonl" })
			.targetsPath,
	).toBe("/tmp/fake-ledger/targets.json");
	expect(
		readConfig(
			{ TARGET_WEIGHTS_PATH: "~/fake-targets/custom.json" },
			"/tmp/FAKE_HOME",
		).targetsPath,
	).toBe("/tmp/FAKE_HOME/fake-targets/custom.json");
	expect(
		readConfig({ TARGET_WEIGHTS_PATH: "/tmp/fake-targets/custom.json" })
			.targetsPath,
	).toBe("/tmp/fake-targets/custom.json");
});

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

it.each([
	"http://upstream.invalid:8790",
	"https://upstream.invalid/",
])("accepts an upstream origin and disables local snapshots: %s", (upstream) => {
	const config = readConfig({ UPSTREAM_URL: upstream });
	expect(config.proxy?.upstream.href).toBe(new URL(upstream).href);
	expect(config.mock).toBe(false);
	expect(config.snapshotEnabled).toBe(false);
	expect(readConfig({}).proxy).toBeNull();
});

it.each([
	"",
	"upstream.invalid",
	"ftp://upstream.invalid",
	"file:///fake",
	"http://user@upstream.invalid",
	"http://user:FAKE@upstream.invalid",
	"http://@upstream.invalid",
	"http://upstream.invalid/api",
	"http://upstream.invalid/path/..",
	"http://upstream.invalid//",
	"http://upstream.invalid?",
	"http://upstream.invalid#",
	"http://upstream.invalid?fake=1",
	"http://upstream.invalid/#fake",
	"http:\\upstream.invalid",
	" http://upstream.invalid",
	"http://upstream.invalid\n",
])("rejects invalid upstream configuration without echoing it: %j", (upstream) => {
	expect(() => readConfig({ UPSTREAM_URL: upstream })).toThrow(
		/^Invalid UPSTREAM_URL$/,
	);
});

it("rejects mixed mock/proxy mode and credential reads in proxy mode", async () => {
	expect(() =>
		readConfig({ TOSS_MOCK: "1", UPSTREAM_URL: "http://upstream.invalid" }),
	).toThrow("TOSS_MOCK and UPSTREAM_URL are incompatible");
	await expect(
		readCredentials(
			readConfig({ UPSTREAM_URL: "http://upstream.invalid" }),
			{},
		),
	).rejects.toThrow("Credentials unavailable in proxy mode");
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
