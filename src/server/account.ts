import { readFile } from "node:fs/promises";
import { kstIso } from "../lib/compute";
import { writeJsonAtomic } from "./atomicWrite";
import { type Config, type Now, readConfig } from "./config";
import { withFileLock } from "./fileLock";
import { getTossClient, type TossClient } from "./tossClient";

export function createAccountStore(options: {
	config: Config;
	client: Pick<TossClient, "listAccounts">;
	now?: Now;
}) {
	let pending: Promise<number> | undefined;
	let seq: number | undefined;
	async function read(): Promise<number | null> {
		try {
			const value = JSON.parse(
				await readFile(options.config.accountPath, "utf8"),
			);
			if (!Number.isSafeInteger(value.accountSeq) || value.accountSeq <= 0)
				throw new Error();
			return value.accountSeq;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw new Error("Cannot read valid TOSS_ACCOUNT_PATH cache");
		}
	}
	async function resolve(): Promise<number> {
		const cached = await read();
		if (cached !== null) return cached;
		return withFileLock(`${options.config.accountPath}.lock`, async () => {
			const current = await read();
			if (current !== null) return current;
			const accounts = await options.client.listAccounts();
			const account =
				accounts.find((item) => item.accountType === "BROKERAGE") ??
				accounts[0];
			if (
				!account ||
				!Number.isSafeInteger(account.accountSeq) ||
				account.accountSeq <= 0
			)
				throw new Error("No supported account available");
			await writeJsonAtomic(options.config.accountPath, {
				accountSeq: account.accountSeq,
				accountType: account.accountType,
				accountNoMasked: account.accountNoMasked,
				count: accounts.length,
				cachedAt: kstIso((options.now ?? Date.now)()),
			});
			return account.accountSeq;
		});
	}
	return {
		async getAccountSeq() {
			if (options.config.mock)
				throw new Error("Account access disabled in mock mode");
			if (seq !== undefined) return seq;
			pending ??= resolve();
			try {
				seq = await pending;
				return seq;
			} finally {
				pending = undefined;
			}
		},
	};
}

type AccountStore = ReturnType<typeof createAccountStore>;
const globals = globalThis as typeof globalThis & {
	__tossAccountStore?: AccountStore;
};
export function getAccountSeq(): Promise<number> {
	globals.__tossAccountStore ??= createAccountStore({
		config: readConfig(),
		client: getTossClient(),
	});
	return globals.__tossAccountStore.getAccountSeq();
}
