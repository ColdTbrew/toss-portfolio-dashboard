import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const script = readFileSync("scripts/check-private-hosts.sh", "utf8");
const source = script.match(/^PRIVATE_HOST_PATTERN='([^']+)'$/m)?.[1];
if (!source) throw new Error("Missing private host scan pattern");
const pattern = new RegExp(source, "i");
const address = (parts: number[]) => parts.join(".");

it.each([
	[100, 64, 0, 1],
	[100, 70, 1, 1],
	[100, 100, 1, 1],
	[100, 119, 255, 255],
	[100, 127, 255, 255],
])("detects private addresses built from %j", (...parts) => {
	const host = address(parts);
	expect(pattern.test(host)).toBe(true);
	expect(pattern.test(`http://${host}:8790`)).toBe(true);
	expect(pattern.test(`HOST=${host}`)).toBe(true);
});

it.each([
	[100, 63, 1, 1],
	[100, 128, 1, 1],
	[1100, 64, 1, 1],
	[1100, 70, 1, 1],
	[100, 640, 1, 1],
	[100, 64, 256, 1],
	[100, 64, 1, 256],
	[100, 64, 1000, 1],
	[100, 64, 1, 1000],
	[127, 0, 0, 1],
	[192, 168, 0, 10],
])("ignores out-of-range addresses and versions built from %j", (...parts) => {
	expect(pattern.test(address(parts))).toBe(false);
});

it("requires word boundaries", () => {
	const host = address([100, 64, 1, 1]);
	for (const value of [`v${host}`, `${host}beta`, `_${host}`, `${host}_`]) {
		expect(pattern.test(value)).toBe(false);
	}
});

it("detects MagicDNS hostnames without storing a literal hostname", () => {
	const host = ["fake-device", "fake-tailnet", "ts", "net"].join(".");
	expect(pattern.test(`http://${host}:8790`)).toBe(true);
	expect(pattern.test(host.toUpperCase())).toBe(true);
	expect(pattern.test(`${host}work`)).toBe(false);
	expect(pattern.test("localhost")).toBe(false);
});
