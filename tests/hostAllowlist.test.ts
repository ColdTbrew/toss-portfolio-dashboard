import { expect, it } from "vitest";
import { buildHostAllowlist, isHostAllowed } from "../src/server/hostAllowlist";

it("allows the configured bind IP with any numeric port", () => {
	const allowed = buildHostAllowlist({ HOST: "127.0.0.2" });
	for (const host of ["127.0.0.2", "127.0.0.2:8790", "127.0.0.2:99999"]) {
		expect(isHostAllowed(host, allowed)).toBe(true);
	}
	expect(isHostAllowed("127.0.0.2", buildHostAllowlist({}))).toBe(false);
});

it("compares configured names case-insensitively", () => {
	const allowed = buildHostAllowlist({ HOST: "Example.Invalid" });
	expect(isHostAllowed("EXAMPLE.invalid:8790", allowed)).toBe(true);
});

it.each([
	"localhost",
	"LOCALHOST:8790",
	"127.0.0.1",
	"127.0.0.1:8790",
	"[::1]",
	"[::1]:8790",
])("always allows loopback Host %s", (host) => {
	expect(isHostAllowed(host, buildHostAllowlist({}))).toBe(true);
});

it("trims extra names, ignores empty entries, and keeps the defaults and HOST", () => {
	const allowed = buildHostAllowlist({
		HOST: "bind.example.invalid",
		ALLOWED_HOSTS: " Example.Invalid, , second.example.invalid , ,",
	});
	for (const host of [
		"localhost",
		"bind.example.invalid",
		"example.invalid:8790",
		"SECOND.EXAMPLE.INVALID",
	]) {
		expect(isHostAllowed(host, allowed)).toBe(true);
	}
	expect(isHostAllowed("", allowed)).toBe(false);
});

// Documentation-only IPv6 address; no deployment address is used here.
it.each([
	"[2001:db8::a]",
	"2001:db8::a",
])("accepts bracketed IPv6 headers for HOST=%s", (HOST) => {
	const allowed = buildHostAllowlist({ HOST });
	expect(isHostAllowed("[2001:DB8::A]:8790", allowed)).toBe(true);
	expect(isHostAllowed("[2001:db8::a]", allowed)).toBe(true);
	expect(isHostAllowed("2001:db8::a", allowed)).toBe(false);
});

it.each([
	undefined,
	null,
	"",
	" ",
	"evil.example",
	"evil.example:8790",
	"example.invalid.",
	"example.invalid.:8790",
	"localhost.",
	"allowed@evil.example",
	"evil.example@allowed",
	"evil.example, allowed",
	"allowed,allowed",
	"allowed/x",
	"allowed\\x",
	" allowed",
	"allowed ",
	"allow ed",
	"allowed\t",
	"allowed\n",
	"allowed:8790:1",
	"allowed:",
	"allowed:port",
	"allowed:-1",
	"allowed?x",
	"allowed#x",
	"::1",
	"::1:8790",
	"[::1",
	"[::1]evil.example",
	"[::1]:8790:1",
	"[localhost]",
	"[:::1]",
	"[::1%lo]",
	"http://allowed",
])("denies foreign, missing or malformed Host case %#", (host) => {
	const allowed = buildHostAllowlist({
		HOST: "example.invalid",
		ALLOWED_HOSTS: "allowed",
	});
	expect(isHostAllowed(host, allowed)).toBe(false);
});
