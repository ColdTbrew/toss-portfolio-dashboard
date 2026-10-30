import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

export async function writeJsonAtomic(
	path: string,
	value: unknown,
): Promise<void> {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(value)}\n`, "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporary, path);
	} catch {
		throw new Error(
			"Atomic JSON write failed; check configured file directory and permissions",
		);
	} finally {
		await unlink(temporary).catch(() => {});
	}
}
