import { describe, expect, it, vi } from "vitest";
import { log, redact, summarizeHttpError } from "../src/server/redact";

describe("redaction", () => {
	it.each([
		["Bearer FAKE_TOKEN", "FAKE_TOKEN"],
		["Basic RkFLRTpGQUtF", "RkFLRTpGQUtF"],
		["eyJfake.eyJfake.fakeSignature", "eyJfake"],
		[
			'{"access_token":"FAKE_TOKEN","client_secret":"FAKE_SECRET","client_id":"FAKE_ID"}',
			"FAKE_",
		],
		["client_secret=FAKE%20SECRET&client_id=FAKE_ID", "FAKE"],
		["X-Tossinvest-Account: FAKE_SEQ", "FAKE_SEQ"],
		['{"accountSeq":42,"accountNo":"FAKE_NUMBER"}', "42"],
		["FAKE account 99999999999 and 999-99-9999", "999"],
	])("masks sensitive patterns: %s", (source, secret) => {
		expect(redact(source)).not.toContain(secret);
		expect(redact(source)).toContain("[REDACTED]");
	});
	it("summarizes only status, code and 200 characters of redacted message", () => {
		const summary = summarizeHttpError(401, {
			error: {
				code: "expired-token",
				message: `Bearer FAKE_TOKEN ${"x".repeat(250)}`,
				data: "FAKE_PRIVATE_DATA",
			},
			headers: { anything: "FAKE_HEADER" },
		});
		expect(summary).toContain(
			"HTTP 401 code=expired-token msg=Bearer [REDACTED]",
		);
		expect(summary.split("msg=")[1]).toHaveLength(200);
		expect(summary).not.toContain("FAKE_");
		expect(summarizeHttpError(502, "FAKE_BODY")).not.toContain("FAKE_BODY");
	});
	it("routes every log level through redact", () => {
		for (const level of ["info", "warn", "error"] as const) {
			const spy = vi.spyOn(console, level).mockImplementation(() => {});
			log[level]("Bearer FAKE_TOKEN");
			expect(spy).toHaveBeenCalledExactlyOnceWith("Bearer [REDACTED]");
			spy.mockRestore();
		}
	});
	it("redacts known credentials before truncation can leave a partial secret", () => {
		const fake = `FAKE_${"x".repeat(250)}`;
		const summary = summarizeHttpError(
			401,
			{ error: { code: "invalid-token", message: `Invalid value ${fake}` } },
			[fake],
		);
		expect(summary).toContain("Invalid value [REDACTED]");
		expect(summary).not.toContain("FAKE_");
	});
});
