import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ALLOWED_ENDPOINTS, TOSS_WS_URL } from "../src/server/endpoints";

async function files(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) =>
				entry.isDirectory()
					? files(join(directory, entry.name))
					: [join(directory, entry.name)],
			),
		)
	).flat();
}

it("restricts all source paths, HTTP mutations and WS subscription types", async () => {
	const paths = new Set(Object.values(ALLOWED_ENDPOINTS));
	const found = new Set<string>();
	const forbidden = [
		"orders",
		"conditional",
		"sellable",
		"commission",
		"modify",
		"cancel",
	];
	for (const file of await files("src")) {
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(/\/api\/v1\/[A-Za-z0-9_/-]+/g)) {
			expect([...paths], file).toContain(match[0]);
			found.add(match[0]);
			for (const word of forbidden) expect(match[0], file).not.toContain(word);
		}
		for (const match of source.matchAll(/method\s*:\s*["']([^"']+)["']/g)) {
			expect(["GET", "POST"], file).toContain(match[1]);
			if (match[1] === "POST") {
				expect(file).toBe("src/server/tokenStore.ts");
				expect(source).toContain("ALLOWED_ENDPOINTS.token");
			}
		}
		expect(source, file).not.toMatch(
			new RegExp(["order" + "book:", "personal:" + "order"].join("|")),
		);
		for (const match of source.matchAll(/["'](wss:\/\/[^"']+)["']/g))
			expect(match[1]).toBe(TOSS_WS_URL);
	}
	expect([...found].sort()).toEqual(
		[
			ALLOWED_ENDPOINTS.accounts,
			ALLOWED_ENDPOINTS.holdings,
			ALLOWED_ENDPOINTS.buyingPower,
			ALLOWED_ENDPOINTS.exchangeRate,
		].sort(),
	);
});
