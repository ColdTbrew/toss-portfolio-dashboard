import { open, readFile, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { type Now, type Sleep, sleep } from "./config";

export interface LockOptions {
	timeoutMs?: number;
	staleMs?: number;
	now?: Now;
	sleep?: Sleep;
}

export async function withFileLock<T>(
	lockPath: string,
	fn: () => Promise<T>,
	options: LockOptions = {},
): Promise<T> {
	const now = options.now ?? Date.now;
	const wait = options.sleep ?? sleep;
	const started = now();
	const identity = JSON.stringify({
		pid: process.pid,
		host: hostname(),
		createdAt: now(),
	});
	let owned: Awaited<ReturnType<typeof stat>>;
	for (;;) {
		try {
			const file = await open(lockPath, "wx", 0o600);
			try {
				await file.writeFile(identity);
				owned = await file.stat();
			} finally {
				await file.close();
			}
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST")
				throw new Error(
					"Cannot create file lock; check configured directory and permissions",
				);
			try {
				const before = await stat(lockPath);
				let dead = false;
				try {
					const owner = JSON.parse(await readFile(lockPath, "utf8"));
					if (
						owner.host === hostname() &&
						Number.isInteger(owner.pid) &&
						owner.pid > 0
					) {
						try {
							process.kill(owner.pid, 0);
						} catch (error) {
							dead = (error as NodeJS.ErrnoException).code === "ESRCH";
						}
					}
				} catch {
					/* Incomplete lockfiles are reclaimed only after staleMs. */
				}
				if (dead || now() - before.mtimeMs > (options.staleMs ?? 30_000)) {
					const current = await stat(lockPath);
					if (current.ino === before.ino && current.mtimeMs === before.mtimeMs)
						await unlink(lockPath);
					continue;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					throw new Error("Cannot inspect file lock");
			}
			if (now() - started >= (options.timeoutMs ?? 10_000))
				throw new Error("File lock timeout");
			await wait(100);
		}
	}
	async function release() {
		try {
			const current = await stat(lockPath);
			if (current.ino === owned.ino) await unlink(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("Cannot release file lock");
		}
	}
	try {
		return await fn();
	} finally {
		await release();
	}
}
