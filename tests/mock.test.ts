import { expect, it, vi } from "vitest";
import { buildState, kstIso } from "../src/lib/compute";
import { createMockRaw, createMockTrend, mockTicks } from "../src/server/mock";
import { NOW } from "./fixtures";

it("generates repeatable mock ticks when a deterministic random source is supplied", () => {
	const state = buildState(createMockRaw(NOW));
	expect(mockTicks(state, NOW, () => 0.75)).toEqual(
		mockTicks(state, NOW, () => 0.75),
	);
	expect(mockTicks(state, NOW + 1000, () => 0.75)).not.toEqual(
		mockTicks(state, NOW, () => 0.75),
	);
	expect(mockTicks(state, NOW, () => 0.25)).not.toEqual(
		mockTicks(state, NOW, () => 0.75),
	);
});

it("uses Math.random by default for every mock holding", () => {
	const state = buildState(createMockRaw(NOW));
	const random = vi.spyOn(Math, "random").mockReturnValue(0.75);
	try {
		expect(mockTicks(state, NOW)).toEqual(mockTicks(state, NOW, () => 0.75));
		expect(random).toHaveBeenCalledTimes(state.holdings.length);
	} finally {
		random.mockRestore();
	}
});

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
