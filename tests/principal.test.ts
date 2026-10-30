import { describe, expect, it } from "vitest";
import { principalSeries } from "../src/lib/principal";
import type { TrendPoint } from "../src/lib/types";

function point(date: string, overrides: Partial<TrendPoint> = {}): TrendPoint {
	return {
		date,
		ts: `${date}T16:11:00+09:00`,
		totalAssetsKrw: 15000000,
		stocksEvalKrw: 11000000,
		purchaseKrw: 10000000,
		profitLossKrw: 1000000,
		returnRate: 0.1,
		...overrides,
	};
}

describe("principalSeries", () => {
	it.each([
		7, 30, 90, 365,
	])("includes both ends of the %i-day window anchored to the latest recorded date", (periodDays) => {
		const end = Date.parse("2024-03-12T00:00:00Z");
		const date = (daysAgo: number) =>
			new Date(end - daysAgo * 86_400_000).toISOString().slice(0, 10);
		const points = [
			point(date(0)),
			point(date(periodDays)),
			point(date(periodDays - 1)),
			point(date(1)),
		];
		const original = structuredClone(points);
		expect(principalSeries(points, periodDays).map((row) => row.date)).toEqual([
			date(periodDays - 1),
			date(1),
			date(0),
		]);
		expect(points).toEqual(original);
	});
	it.each([0, 1, 2])("maps %i points without inventing history", (count) => {
		const points = [point("2026-10-28"), point("2026-10-29")].slice(0, count);
		expect(principalSeries(points, 30)).toEqual(
			points.map(({ date }) => ({
				date,
				value: 11000000,
				principal: 10000000,
				gap: 1000000,
				gapRate: 0.1,
			})),
		);
	});
	it("keeps a sparse window honest even when older points exist", () => {
		const points = [point("2026-08-01"), point("2026-10-29")];
		expect(principalSeries(points, 30)).toHaveLength(1);
		expect(principalSeries(points, 90)).toHaveLength(2);
	});
	it("uses explicit stock value instead of cash-inclusive assets or recorded profit/loss", () => {
		const points = [point("2026-10-29", { stocksEvalKrw: 9000000 })];
		expect(principalSeries(points, 30)[0]).toMatchObject({
			value: 9000000,
			principal: 10000000,
			gap: -1000000,
			gapRate: -0.1,
		});
	});
	it("falls back for old points missing stocksEvalKrw, including losses", () => {
		const { stocksEvalKrw: _stocks, ...legacy } = point("2026-10-29", {
			profitLossKrw: -2000000,
		});
		expect(principalSeries([legacy], 30)[0]).toMatchObject({
			value: 8000000,
			gap: -2000000,
			gapRate: -0.2,
		});
	});
	it("preserves a zero stock value and handles zero principal without NaN", () => {
		expect(
			principalSeries([point("2026-10-29", { stocksEvalKrw: 0 })], 30)[0],
		).toMatchObject({ value: 0, gapRate: -1 });
		expect(
			principalSeries(
				[point("2026-10-29", { purchaseKrw: 0, stocksEvalKrw: 0 })],
				30,
			)[0],
		).toMatchObject({ value: 0, principal: 0, gap: 0, gapRate: 0 });
	});
	it("does not send invalid dates or amounts to the chart", () => {
		expect(
			principalSeries(
				[
					point("invalid"),
					point("2026-10-29", { stocksEvalKrw: Number.NaN }),
					point("2026-10-29", { purchaseKrw: Number.POSITIVE_INFINITY }),
				],
				30,
			),
		).toEqual([]);
	});
});
