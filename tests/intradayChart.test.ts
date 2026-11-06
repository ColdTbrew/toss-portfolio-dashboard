import { describe, expect, it } from "vitest";
import {
	bucketCloses,
	chartSeries,
	dayRange,
	roundTicks,
} from "../src/lib/intradayChart";

const start = Date.parse("2026-11-05T14:30:00Z"); // 09:30 New York
const minutes = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		t: new Date(start + i * 60_000).toISOString(),
		close: 100 + Math.sin(i) * 2,
	}));
const minuteOfDay = (iso: string) => {
	const date = new Date(Date.parse(iso) - 5 * 3600_000);
	return date.getUTCHours() * 60 + date.getUTCMinutes();
};

describe("intraday chart helpers", () => {
	it("buckets 1m closes into 5m with last close and bucket start", () => {
		const out = bucketCloses(minutes(12), 5);
		expect(out).toHaveLength(3);
		expect(out[0]?.t).toBe("2026-11-05T14:30:00.000Z");
		expect(out[0]?.close).toBeCloseTo(100 + Math.sin(4) * 2);
		expect(out[2]?.close).toBeCloseTo(100 + Math.sin(11) * 2);
	});

	it("only aggregates long series", () => {
		expect(chartSeries(minutes(60))).toHaveLength(60);
		expect(chartSeries(minutes(390))).toHaveLength(78);
	});

	it("keeps day high/low from raw closes", () => {
		const raw = minutes(390);
		const range = dayRange(raw);
		expect(range?.high).toBe(Math.max(...raw.map((p) => p.close)));
		expect(range?.low).toBe(Math.min(...raw.map((p) => p.close)));
	});

	it("labels round clock times within the max count", () => {
		const series = chartSeries(minutes(390));
		const desktop = roundTicks(series, 7, minuteOfDay);
		const mobile = roundTicks(series, 4, minuteOfDay);
		expect(desktop.length).toBeGreaterThanOrEqual(6);
		expect(desktop.length).toBeLessThanOrEqual(7);
		expect(mobile.length).toBeGreaterThanOrEqual(3);
		expect(mobile.length).toBeLessThanOrEqual(4);
		for (const t of [...desktop, ...mobile])
			expect(minuteOfDay(t) % 30).toBe(0);
	});
});
