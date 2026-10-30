import { expect, it } from "vitest";
import { buildState } from "../src/lib/compute";
import { approximateShares, rebalance } from "../src/lib/rebalance";
import { rawFixture } from "./fixtures";

const state = buildState(rawFixture());
it("computes signed drift and needed KRW against total assets including cash", () => {
	const result = rebalance(state, { FAKEKR: 20, FAKEUS: 70, CASH: 5 });
	const [kr, us, cash] = result.rows;
	expect(kr.currentPercent).toBeCloseTo(state.holdings[0].weight * 100);
	expect(kr.driftPp).toBeCloseTo((20_000 / 168_000) * 100 - 20);
	expect(kr.neededKrw).toBeCloseTo(13_600);
	expect(kr.shares).toBe(1);
	expect(us.neededKrw).toBeCloseTo(-12_400);
	expect(us.shares).toBe(0.04);
	expect(cash.currentPercent).toBeCloseTo((18_000 / 168_000) * 100);
	expect(cash.neededKrw).toBeCloseTo(-9_600);
	expect(cash.shares).toBeNull();
	expect(result.targetTotal).toBe(95);
	expect(result.untargetedPercent).toBe(5);
	expect(result.netCashNeededKrw).toBeCloseTo(1_200);
});
it("does not suggest changes for untargeted or absent holdings, and retains explicit zero", () => {
	const result = rebalance(state, { FAKEKR: 0, FAKEOTHER: 20 });
	expect(result.rows[0].neededKrw).toBeCloseTo(-20_000);
	for (const row of result.rows.slice(1)) {
		expect(row.neededKrw).toBeNull();
		expect(row.driftPp).toBeNull();
		expect(row.shares).toBeNull();
	}
	expect(result.rows.at(-1)).toMatchObject({
		symbol: "FAKEOTHER",
		targetPercent: 20,
		currentPercent: null,
	});
	expect(result.targetTotal).toBe(20);
	expect(result.untargetedPercent).toBe(80);
	expect(rebalance(state, {}).netCashNeededKrw).toBeNull();
});
it("rounds absolute share counts down to US hundredths and KR integers using mid FX", () => {
	const [kr, us] = state.holdings;
	expect(approximateShares(9999.99, kr, null)).toBe(0);
	expect(approximateShares(-20000, kr, null)).toBe(2);
	expect(approximateShares(2599.99, us, 1300)).toBe(0);
	expect(approximateShares(-2600, us, 1300)).toBe(0.01);
	expect(approximateShares(75400, us, 1300)).toBe(0.29);
	expect(approximateShares(75399.99, us, 1300)).toBe(0.28);
	expect(approximateShares(5000, us, null)).toBeNull();
	expect(approximateShares(5000, { ...us, lastPrice: 0 }, 1300)).toBeNull();
});
it("handles missing cash, zero assets and exact target matches without nonfinite suggestions", () => {
	const missing = rebalance(
		{ ...state, cash: null, fx: null },
		{ FAKEUS: 80, CASH: 5 },
	);
	expect(missing.rows[1].shares).toBeNull();
	expect(missing.rows[2].currentPercent).toBeNull();
	expect(missing.rows[2].neededKrw).toBeNull();
	const zero = rebalance(
		{ ...state, totals: { ...state.totals, totalAssetsKrw: 0 } },
		{ FAKEKR: 20 },
	);
	expect(zero.rows.every((row) => row.neededKrw === null)).toBe(true);
	expect(
		rebalance(state, { FAKEKR: state.holdings[0].weight * 100 }).rows[0]
			.driftPp,
	).toBe(0);
});
