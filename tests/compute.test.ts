import { describe, expect, it } from "vitest";
import { applyTick, buildState, kstIso } from "../src/lib/compute";
import {
	formatKrw,
	formatMoney,
	formatPercent,
	formatUsd,
} from "../src/lib/format";
import { NOW, rawFixture } from "./fixtures";

describe("portfolio calculations", () => {
	it("uses REST overview amounts, mid FX, cash and total-asset weights", () => {
		const state = buildState(rawFixture(), { now: NOW });
		expect(state.fetchedAt).toBe("2026-10-29T16:11:00.000+09:00");
		expect(state.totals).toMatchObject({
			stocksEvalKrw: 150000,
			purchaseKrw: 135000,
			profitLossKrw: 15000,
			totalAssetsKrw: 168000,
			dailyPlKrw: 1500,
		});
		expect(state.totals.returnRate).toBeCloseTo(1 / 9);
		expect(state.cash).toEqual({ krw: 5000, usd: 10, totalKrw: 18000 });
		expect(state.holdings[1].weight).toBeCloseTo(130000 / 168000);
	});
	it("updates fractional US shares, daily P/L and every weight without accumulating tick deltas twice", () => {
		const original = buildState(rawFixture(), { now: NOW });
		const first = applyTick(original, {
			symbol: "FAKEUS",
			market: "us",
			price: 220,
			timestamp: kstIso(NOW + 1000),
		});
		const next = applyTick(first, {
			symbol: "FAKEUS",
			market: "us",
			price: 210,
			timestamp: kstIso(NOW + 2000),
		});
		expect(next.holdings[1]).toMatchObject({
			basePrice: 200,
			lastPrice: 210,
			evalAmount: 105,
			profitLoss: 15,
			dailyPl: 6,
			evalKrw: 136500,
		});
		expect(next.holdings[1].returnRate).toBeCloseTo(15 / 90);
		expect(next.totals).toMatchObject({
			stocksEvalKrw: 156500,
			totalAssetsKrw: 174500,
			profitLossKrw: 21500,
			dailyPlKrw: 8000,
		});
		expect(next.totals.dailyPlRate).toBeCloseTo(8000 / 148500);
		expect(next.holdings[0].weight).toBeCloseTo(20000 / 174500);
		expect(original.holdings[1].lastPrice).toBe(200);
	});
	it("updates KR holdings and rejects unknown, wrong-market, stale and invalid ticks", () => {
		const state = buildState(rawFixture(), { now: NOW });
		const tick = {
			symbol: "FAKEKR",
			market: "kr" as const,
			price: 9900,
			timestamp: kstIso(NOW + 1000),
		};
		const next = applyTick(state, tick);
		expect(next.holdings[0]).toMatchObject({
			evalAmount: 19800,
			profitLoss: 1800,
			dailyPl: 0,
		});
		for (const invalid of [
			{ symbol: "MISSING" },
			{ market: "us" as const },
			{ price: NaN },
			{ price: 0 },
			{ timestamp: "invalid" },
			{ timestamp: kstIso(NOW - 1) },
		]) {
			expect(applyTick(state, { ...tick, ...invalid })).toBe(state);
		}
	});
	it("handles empty holdings, nullable USD totals, and unavailable FX explicitly", () => {
		const raw = rawFixture();
		if (!raw.holdings) throw new Error();
		raw.holdings.items = [];
		raw.holdings.totalPurchaseAmount = { krw: "0", usd: null };
		expect(buildState(raw).totals.returnRate).toBe(0);
		raw.fx = null;
		const state = buildState(raw);
		expect(state.fx).toBeNull();
		expect(state.errors.fx).toContain("unavailable");
		expect(state.totals.stocksEvalKrw).toBe(20000);
	});
	it("formats ko-KR amounts, decimal ratios, signs and negative zero", () => {
		expect(formatKrw(1234.5)).toBe("1,235원");
		expect(formatKrw(-1234.5, true)).toBe("-1,235원");
		expect(formatUsd(1234.5)).toBe("$1,234.50");
		expect(formatMoney(12.34, "USD", true)).toBe("+$12.34");
		expect(formatPercent(0.1516, true)).toBe("+15.16%");
		expect(formatPercent(-0, true)).toBe("0.00%");
	});
});
