import { expect, it } from "vitest";
import { validateBindHost } from "../src/server/bindHost";

it.each([
	undefined,
	"",
	" \t ",
	"0.0.0.0",
	"::",
	"[::]",
	" 0.0.0.0 ",
	"<tailscale-ip>",
	"prefix-<host>-suffix",
])("rejects unsafe production HOST %s, including in mock mode", (HOST) => {
	for (const TOSS_MOCK of [undefined, "1"]) {
		expect(() =>
			validateBindHost({ NODE_ENV: "production", HOST, TOSS_MOCK }),
		).toThrow("프로덕션 시작 거부: ~/.config/toss-dashboard.env에 HOST");
	}
});

it.each([
	"127.0.0.1",
	"192.168.0.10",
	"10.0.0.10",
])("accepts an explicit production bind address %s", (HOST) => {
	expect(() =>
		validateBindHost({ NODE_ENV: "production", HOST }),
	).not.toThrow();
});

it.each([
	undefined,
	"development",
	"test",
])("leaves non-production mode %s unchanged", (NODE_ENV) => {
	for (const HOST of [undefined, "", "0.0.0.0", "::", "<tailscale-ip>"]) {
		for (const TOSS_MOCK of [undefined, "1"]) {
			expect(() =>
				validateBindHost({ NODE_ENV, HOST, TOSS_MOCK }),
			).not.toThrow();
		}
	}
});

it("does not include the configured value in errors", () => {
	const HOST = "<FAKE_PRIVATE_VALUE>";
	const run = () => validateBindHost({ NODE_ENV: "production", HOST });
	expect(run).toThrow();
	expect(run).not.toThrow(HOST);
});
