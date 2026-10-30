import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
	envPath: string;
	tokenPath: string;
	accountPath: string;
	ledgerPath: string;
	mock: boolean;
	proxy: { upstream: URL } | null;
	snapshotEnabled: boolean;
	snapshotTimeKst: string;
	refreshHoldingsMs: number;
	refreshCashFxMs: number;
}
export type Now = () => number;
export type Sleep = (ms: number) => Promise<void>;
export const sleep: Sleep = (ms) =>
	new Promise((resolve) => setTimeout(resolve, ms));

export function readConfig(
	env: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): Config {
	const path = (value: string) =>
		value === "~"
			? home
			: value.startsWith("~/")
				? join(home, value.slice(2))
				: value;
	const seconds = (key: string, fallback: number) => {
		const value = Number(env[key] ?? fallback);
		if (!Number.isFinite(value) || value <= 0)
			throw new Error(`Invalid ${key}`);
		return value * 1000;
	};
	const snapshotTimeKst = env.SNAPSHOT_TIME_KST ?? "16:10";
	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(snapshotTimeKst))
		throw new Error("Invalid SNAPSHOT_TIME_KST");
	const mock = env.TOSS_MOCK === "1";
	let proxy: Config["proxy"] = null;
	if (env.UPSTREAM_URL !== undefined) {
		try {
			if (!/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(env.UPSTREAM_URL))
				throw new Error();
			const upstream = new URL(env.UPSTREAM_URL);
			if (
				!/^https?:$/.test(upstream.protocol) ||
				upstream.username ||
				upstream.password ||
				upstream.pathname !== "/" ||
				/[?#]/.test(env.UPSTREAM_URL)
			)
				throw new Error();
			proxy = { upstream };
		} catch {
			throw new Error("Invalid UPSTREAM_URL");
		}
		if (mock) throw new Error("TOSS_MOCK and UPSTREAM_URL are incompatible");
	}
	return {
		envPath: path(env.TOSS_ENV_PATH ?? "~/invest/.toss.env"),
		tokenPath: path(env.TOSS_TOKEN_PATH ?? "~/invest/.token.json"),
		accountPath: path(env.TOSS_ACCOUNT_PATH ?? "~/invest/account.json"),
		ledgerPath: path(env.PORTFOLIO_LEDGER_PATH ?? "~/invest/portfolio.jsonl"),
		mock,
		proxy,
		snapshotEnabled: !mock && !proxy && env.SNAPSHOT_ENABLED !== "0",
		snapshotTimeKst,
		refreshHoldingsMs: seconds("REFRESH_HOLDINGS_SEC", 30),
		refreshCashFxMs: seconds("REFRESH_CASH_FX_SEC", 60),
	};
}

export interface Credentials {
	clientId: string;
	clientSecret: string;
}
export async function readCredentials(
	config: Config,
	env: NodeJS.ProcessEnv = process.env,
): Promise<Credentials> {
	if (config.mock) throw new Error("Credentials unavailable in mock mode");
	if (config.proxy) throw new Error("Credentials unavailable in proxy mode");
	const values: Record<string, string | undefined> = { ...env };
	if (!values.TOSS_CLIENT_ID || !values.TOSS_CLIENT_SECRET) {
		let source: string;
		try {
			source = await readFile(config.envPath, "utf8");
		} catch {
			throw new Error("Cannot read TOSS_ENV_PATH credentials file");
		}
		for (const line of source.split(/\r?\n/)) {
			const match = line.match(
				/^\s*(TOSS_CLIENT_ID|TOSS_CLIENT_SECRET)\s*=\s*(.*?)\s*$/,
			);
			if (match) values[match[1]] ||= match[2].replace(/^(['"])(.*)\1$/, "$2");
		}
	}
	if (!values.TOSS_CLIENT_ID || !values.TOSS_CLIENT_SECRET)
		throw new Error("Missing TOSS_CLIENT_ID or TOSS_CLIENT_SECRET");
	return {
		clientId: values.TOSS_CLIENT_ID,
		clientSecret: values.TOSS_CLIENT_SECRET,
	};
}
