import { expect, it } from "vitest";
import { applyTick, buildState, kstIso } from "../src/lib/compute";
import { approximateShares, rebalance } from "../src/lib/rebalance";
import type { PortfolioState } from "../src/lib/types";
import { NOW, rawFixture } from "./fixtures";

const state = buildState(rawFixture());
const targets = { FAKEKR: 20, FAKEUS: 70, CASH: 5 };

function expectUnavailable(state: PortfolioState) {
	const result = rebalance(state, targets);
	for (const row of result.rows) {
		expect(row).toMatchObject({
			currentPercent: null,
			driftPp: null,
			neededKrw: null,
			shares: null,
		});
		expect(row.targetPercent).toBe(targets[row.symbol as keyof typeof targets]);
	}
	expect(result.netCashNeededKrw).toBeNull();
	expect(result.targetTotal).toBe(95);
	expect(result.untargetedPercent).toBe(5);
}

it("suppresses all calculations on actual missing-FX partial totals, including after ticks", () => {
	const raw = rawFixture();
	raw.fx = null;
	if (!raw.usd) throw new Error();
	raw.usd.cashBuyingPower = "0";
	const missing = buildState(raw, { now: NOW });
	expect(missing.totals.totalAssetsKrw).toBe(25_000);
	expect(missing.errors.fx).toContain("unavailable");
	expect(missing.valuationComplete).toBe(false);
	expectUnavailable(missing);
	expectUnavailable(
		applyTick(missing, {
			symbol: "FAKEKR",
			market: "kr",
			price: 11000,
			timestamp: kstIso(NOW + 1000),
		}),
	);
});

it.each([
	"0",
	"-1",
	"NaN",
	"Infinity",
])("suppresses calculations with unusable FX %s", (midRate) => {
	const raw = rawFixture();
	if (!raw.fx) throw new Error();
	raw.fx.midRate = midRate;
	expectUnavailable(buildState(raw));
});

it("requires FX for USD cash alone, while allowing KRW-only portfolios without FX", () => {
	const raw = rawFixture();
	if (!raw.holdings || !raw.usd) throw new Error();
	raw.fx = null;
	raw.holdings.items = raw.holdings.items.filter(
		(row) => row.currency === "KRW",
	);
	raw.holdings.marketValue.amount.usd = "0";
	const cashOnly = buildState(raw);
	expect(cashOnly.cash?.usd).toBe(10);
	expectUnavailable(cashOnly);
	raw.usd.cashBuyingPower = "0";
	const krwOnly = buildState(raw);
	expect(krwOnly.valuationComplete).toBe(true);
	expect(krwOnly.errors.fx).toBeUndefined();
	const result = rebalance(krwOnly, { FAKEKR: 60, CASH: 40 });
	expect(result.rows[0]).toMatchObject({
		currentPercent: 80,
		driftPp: 20,
		neededKrw: -5000,
		shares: 0,
	});
	expect(result.rows[1].neededKrw).toBeCloseTo(5000);
	expect(result.netCashNeededKrw).toBeCloseTo(-5000);
});

it.each([
	"holdings",
	"krw",
	"usd",
] as const)("suppresses calculations when %s data has never loaded", (part) => {
	const raw = rawFixture();
	raw[part] = null;
	expectUnavailable(buildState(raw));
});

it("restores calculations with valid FX and keeps cached valuations usable despite refresh errors", () => {
	const raw = rawFixture();
	const fx = raw.fx;
	raw.fx = null;
	expectUnavailable(buildState(raw));
	raw.fx = fx;
	const restored = buildState(raw);
	expect(restored.valuationComplete).toBe(true);
	expect(rebalance(restored, targets)).toEqual(rebalance(state, targets));
	const cached = buildState(raw, {
		errors: {
			fx: "Refresh failed",
			holdings: "Refresh failed",
			usd: "Refresh failed",
		},
	});
	expect(cached.valuationComplete).toBe(true);
	expect(rebalance(cached, targets)).toEqual(rebalance(restored, targets));
});
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
	const raw = rawFixture();
	raw.krw = null;
	const missing = rebalance(buildState(raw), { FAKEUS: 80, CASH: 5 });
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
