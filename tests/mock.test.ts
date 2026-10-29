import { expect, it } from "vitest";
import { buildState, kstIso } from "../src/lib/compute";
import { createMockRaw, createMockTrend } from "../src/server/mock";
import { NOW } from "./fixtures";

it("provides 60 daily mock snapshots with three purchases and a current final valuation", () => {
	const state = buildState(createMockRaw(NOW));
	const points = createMockTrend(NOW);
	expect(points).toHaveLength(60);
	expect(points.at(-1)).toMatchObject({
		date: kstIso(NOW).slice(0, 10),
		purchaseKrw: state.totals.purchaseKrw,
		stocksEvalKrw: state.totals.stocksEvalKrw,
		totalAssetsKrw: state.totals.totalAssetsKrw,
	});
	let purchases = 0;
	for (const [index, point] of points.entries()) {
		expect(point.stocksEvalKrw).toBe(point.purchaseKrw + point.profitLossKrw);
		expect(point.totalAssetsKrw).toBe(
			point.stocksEvalKrw + (state.cash?.totalKrw ?? 0),
		);
		expect(point.returnRate).toBe(point.profitLossKrw / point.purchaseKrw);
		if (index === 0) continue;
		const previous = points[index - 1];
		expect(Date.parse(point.date) - Date.parse(previous.date)).toBe(86_400_000);
		expect(point.purchaseKrw).toBeGreaterThanOrEqual(previous.purchaseKrw);
		if (point.purchaseKrw > previous.purchaseKrw) purchases++;
	}
	expect(purchases).toBe(3);
});
