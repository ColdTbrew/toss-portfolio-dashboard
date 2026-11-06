import { expect, it, vi } from "vitest";
import { buildState, kstIso } from "../src/lib/compute";
import {
	createMockIntraday,
	createMockRaw,
	createMockTrend,
	mockTicks,
} from "../src/server/mock";
import { NOW } from "./fixtures";

it("generates deterministic intraday sessions anchored to the mock quote", () => {
	const series = createMockIntraday("^IXIC", 18500.25, 125.25, NOW);
	expect(series).toEqual(createMockIntraday("^IXIC", 18500.25, 125.25, NOW));
	expect(createMockIntraday("^IXIC", 18500.25, 125.25, NOW + 1000)).not.toEqual(
		series,
	);
	expect(series).toHaveLength(78);
	expect(createMockIntraday("CL=F", 72.4, -0.6, NOW)).toHaveLength(264);
	expect(series.at(-1)).toEqual({ t: NOW, v: 18500.25 });
	expect(series[0].v).toBe(18500.25 - 125.25);
	for (const [index, point] of series.entries()) {
		expect(Number.isFinite(point.v)).toBe(true);
		if (index === 0) continue;
		expect(point.t - series[index - 1].t).toBe(300_000);
	}
	const flat = createMockIntraday("^GSPC", 5900.5, 0, NOW);
	expect(flat[0].v).toBe(5900.5);
	expect(flat.at(-1)?.v).toBe(5900.5);
});

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

it("uses repeatable time-based mock movement by default", () => {
	const state = buildState(createMockRaw(NOW));
	const random = vi.spyOn(Math, "random").mockReturnValue(0.75);
	try {
		expect(mockTicks(state, NOW)).toEqual(mockTicks(state, NOW));
		expect(mockTicks(state, NOW)).not.toEqual(mockTicks(state, NOW + 1000));
		expect(random).not.toHaveBeenCalled();
	} finally {
		random.mockRestore();
	}
});

it("provides 90 daily mock snapshots with three purchases and a current final valuation", () => {
	const state = buildState(createMockRaw(NOW));
	const points = createMockTrend(NOW);
	expect(points).toHaveLength(90);
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
