import { describe, expect, it } from "vitest";
import {
	annualisedVolatility,
	benchmarkComparison,
	contributions,
	drawdown,
	fxSplit,
	holdingFx,
	holdingRisk,
	pairwiseCorrelation,
	pearson,
	periodEndpoints,
	portfolioRisk,
	snapshotReturns,
	totalFx,
} from "../src/lib/analytics";
import { buildState } from "../src/lib/compute";
import type { AnalyticsData, DatedClose, TrendPoint } from "../src/lib/types";
import { rawFixture } from "./fixtures";

const point = (date: string, purchase: number, profit: number): TrendPoint => ({
	date,
	ts: `${date}T10:00:00Z`,
	purchaseKrw: purchase,
	profitLossKrw: profit,
	stocksEvalKrw: purchase + profit,
	totalAssetsKrw: purchase + profit + 500,
	returnRate: profit / purchase,
});
const points = [
	point("2026-01-01", 100, 0),
	point("2026-01-02", 200, 10),
	point("2026-01-03", 150, 31),
];
const closes = (values: number[], offset = 0): DatedClose[] =>
	values.map((close, i) => ({
		date: new Date(Date.UTC(2026, 0, i + 1 + offset))
			.toISOString()
			.slice(0, 10),
		close,
	}));
const data: AnalyticsData = {
	fetchedAt: "2026-10-29T10:00:00Z",
	candles: {
		FAKEKR: [
			{ date: "2026-09-29", close: 8000 },
			{ date: "2026-10-29", close: 10000 },
		],
		FAKEUS: [
			{ date: "2026-09-29", close: 180 },
			{ date: "2026-10-29", close: 200 },
		],
	},
	benchmarks: {},
	usdkrw: [
		{ date: "2026-09-28", close: 1200 },
		{ date: "2026-10-28", close: 1300 },
	],
};

describe("snapshot returns and benchmarks", () => {
	it("chain links changes in profit, ignoring deposits and withdrawals", () => {
		const result = snapshotReturns(points);
		expect(result.map((p) => p.index)).toEqual([1, 1.1, 1.2100000000000002]);
		expect(result.map((p) => p.dailyReturn)).toEqual([null, 0.1, 0.1]);
		expect(
			snapshotReturns([points[0], point("2026-01-02", 500, 0)])[1].index,
		).toBe(1);
	});
	it("sorts days, uses the latest snapshot of each day and does not mutate inputs", () => {
		const input = [
			points[2],
			{ ...points[1], ts: "2026-01-02T08:00:00Z", profitLossKrw: 500 },
			points[0],
			points[1],
		];
		const copy = structuredClone(input);
		expect(snapshotReturns(input)).toEqual(snapshotReturns(points));
		expect(input).toEqual(copy);
	});
	it("rebases all series on the same day, carries closes forward without looking ahead", () => {
		const result = benchmarkComparison(
			points,
			{
				"^KS11": [
					{ date: "2025-12-31", close: 100 },
					{ date: "2026-01-02", close: 120 },
					{ date: "2026-01-04", close: 200 },
				],
				"^GSPC": [{ date: "2026-01-02", close: 100 }],
			},
			0,
		);
		expect(result[0]).toEqual({ date: "2026-01-01", portfolio: 0, "^KS11": 0 });
		expect(result[2].portfolio).toBeCloseTo(0.21);
		expect(result[1]["^KS11"]).toBeCloseTo(0.2);
		expect(result[2]["^KS11"]).toBeCloseTo(0.2);
		expect(result.every((p) => p["^GSPC"] === undefined)).toBe(true);
		const bounded = benchmarkComparison(
			points,
			{ "^KS11": closes([100, 120, 90]) },
			1,
		);
		expect(bounded).toHaveLength(2);
		expect(bounded[0].portfolio).toBe(0);
		expect(bounded[1].portfolio).toBeCloseTo(0.1);
		expect(bounded[1]["^KS11"]).toBeCloseTo(-0.25);
	});
	it.each([
		0, 1,
	])("returns empty comparisons and risk for %i distinct days", (count) => {
		expect(benchmarkComparison(points.slice(0, count), {}, 90)).toEqual([]);
		expect(portfolioRisk(points.slice(0, count), 90)).toBeNull();
	});
	it("does not fabricate returns from a zero stock base or duplicate days", () => {
		expect(snapshotReturns([point("2026-01-01", 0, 0), points[1]])).toEqual([
			{ date: "2026-01-02", index: 1, dailyReturn: null },
		]);
		expect(portfolioRisk([points[0], points[0]], 90)).toBeNull();
	});
});

it("calculates maximum and current peak drawdown", () => {
	expect(drawdown([100, 120, 90, 108])).toEqual({
		mdd: -0.25,
		current: -0.09999999999999998,
	});
	expect(drawdown([100, 120, 90, 130])).toEqual({ mdd: -0.25, current: 0 });
	expect(drawdown([100, 100])).toEqual({ mdd: 0, current: 0 });
	expect(portfolioRisk(points, 90)?.volatility).toBeNull();
});
it("uses sample standard deviation, √252 and the 20 return threshold", () => {
	expect(annualisedVolatility(Array(19).fill(0.1))).toBeNull();
	const returns = Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.01 : -0.01));
	expect(annualisedVolatility(returns)).toBeCloseTo(
		Math.sqrt(((20 * 0.0001) / 19) * 252),
	);
	expect(annualisedVolatility(Array(20).fill(0))).toBe(0);
	const series = closes(
		Array.from({ length: 21 }, (_, i) => (i % 2 ? 110 : 100)),
	);
	expect(holdingRisk(series, 0)?.volatility).toBeCloseTo(
		Math.sqrt(((20 * Math.log(1.1) ** 2) / 19) * 252),
	);
	expect(holdingRisk(series, 0)?.mdd).toBeCloseTo(100 / 110 - 1);
});
it("computes Pearson with pairwise date overlap and requires 20 returns", () => {
	const returns = Array.from({ length: 25 }, (_, i) => Math.sin(i) / 100);
	const fromReturns = (r: number[], offset = 0) => {
		let price = 100;
		return closes(
			[
				price,
				...r.map((value) => {
					price *= 1 + value;
					return price;
				}),
			],
			offset,
		);
	};
	const a = fromReturns(returns);
	expect(pairwiseCorrelation(a, a, 120)).toBeCloseTo(1);
	expect(
		pairwiseCorrelation(a, fromReturns(returns.map((r) => -r)), 120),
	).toBeCloseTo(-1);
	expect(pairwiseCorrelation(a, a, 19)).toBeNull();
	const shifted = fromReturns(returns.slice(5), 5);
	expect(pairwiseCorrelation(a, shifted, 120)).toBeCloseTo(1);
	expect(
		pairwiseCorrelation(a, fromReturns(returns.slice(6), 6), 120),
	).toBeNull();
	expect(pairwiseCorrelation(a, fromReturns(returns, 90), 120)).toBeNull();
	expect(pearson(Array(20).fill(0), Array(20).fill(1))).toBeNull();
});

it("requires a start candle at or before the requested period and handles weekends", () => {
	expect(periodEndpoints(data.candles.FAKEUS, 30)?.start.close).toBe(180);
	expect(periodEndpoints(data.candles.FAKEUS, 90)).toBeNull();
	expect(
		periodEndpoints(
			[
				{ date: "2026-10-16", close: 100 },
				{ date: "2026-10-26", close: 110 },
			],
			7,
		)?.start.date,
	).toBe("2026-10-16");
});
it.each([
	[2, 100, 110, 1200, 1300],
	[0.5, 150, 90, 1400, 1100],
	[3, 100, 110, 1400, 1300],
])("FX effects add to total for %j", (qty, p0, p1, fx0, fx1) => {
	const split = fxSplit(qty, p0, p1, fx0, fx1);
	expect(split).not.toBeNull();
	expect((split?.price ?? 0) + (split?.fx ?? 0)).toBeCloseTo(split?.total ?? 0);
	expect((split?.priceRate ?? 0) + (split?.fxRate ?? 0)).toBeCloseTo(
		split?.totalRate ?? 0,
	);
});
it("aligns historical FX without current-rate fallback and refuses incomplete totals", () => {
	const row = buildState(rawFixture()).holdings[1];
	expect(holdingFx(row, data, 30)).toEqual(fxSplit(0.5, 180, 200, 1200, 1300));
	expect(holdingFx(row, { ...data, usdkrw: [] }, 30)).toBeNull();
	expect(holdingFx(row, data, 90)).toBeNull();
	expect(totalFx([holdingFx(row, data, 30), null])).toBeNull();
	const effect = holdingFx(row, data, 30);
	expect(totalFx([effect, effect])?.total).toBeCloseTo(
		(effect?.total ?? 0) * 2,
	);
	expect(totalFx([effect, effect])?.totalRate).toBeCloseTo(
		effect?.totalRate ?? 0,
	);
});
it("computes contribution with current FX today/all and historical FX for periods", () => {
	const state = buildState(rawFixture());
	expect(contributions(state, data, "today").map((r) => r.amount)).toEqual([
		1300, 200,
	]);
	expect(contributions(state, data, "all").map((r) => r.amount)).toEqual([
		13000, 2000,
	]);
	const result = contributions(state, data, 30);
	expect(result.map((r) => r.amount)).toEqual([22000, 4000]);
	expect(result[0].contribution).toBeCloseTo(22000 / (16000 + 108000));
	expect(contributions(state, { ...data, usdkrw: [] }, 30)[0].amount).toBe(
		13000,
	);
	const incomplete = contributions(
		state,
		{ ...data, candles: { FAKEUS: data.candles.FAKEUS } },
		30,
	);
	expect(incomplete[1].amount).toBeNull();
	expect(incomplete.every((row) => row.contribution === null)).toBe(true);
});

it("anchors period effects to the exchange-local last candle, independent of the fetch UTC date", () => {
	const state = buildState(rawFixture());
	const earlyUtc = { ...data, fetchedAt: "2026-10-28T23:30:00Z" };
	expect(holdingFx(state.holdings[1], earlyUtc, 30)).toEqual(
		holdingFx(state.holdings[1], data, 30),
	);
	expect(contributions(state, earlyUtc, 30)).toEqual(
		contributions(state, data, 30),
	);
});
it("preserves a complete loss in the linked index and MDD", () => {
	const loss = [point("2026-01-01", 100, 0), point("2026-01-02", 100, -100)];
	expect(snapshotReturns(loss)[1].index).toBe(0);
	expect(portfolioRisk(loss, 90)?.mdd).toBe(-1);
	expect(benchmarkComparison(loss, {}, 90)[1].portfolio).toBe(-1);
});
