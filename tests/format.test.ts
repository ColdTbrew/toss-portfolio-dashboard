import { describe, expect, it } from "vitest";
import { formatKrwManwon } from "../src/lib/format";

describe("compact KRW axis labels", () => {
	it.each([
		[60000000, "6,000만원"],
		[12345678, "1,235만원"],
		[-12345678, "-1,235만원"],
		[10000, "1만원"],
		[0, "0만원"],
		[-0, "0만원"],
		[Number.NaN, "—"],
		[Number.POSITIVE_INFINITY, "—"],
	])("formats %s as %s", (value, expected) => {
		expect(formatKrwManwon(value)).toBe(expected);
	});
});
