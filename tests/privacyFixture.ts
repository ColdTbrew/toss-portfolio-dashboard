import type { PortfolioState, TrendPoint } from "../src/lib/types";

// Deliberately unusual fictional numbers avoid matching dates, SVG coordinates or percentages.
export function privacyFixture(): PortfolioState {
	return {
		fetchedAt: "2026-10-29T16:11:00+09:00",
		mock: true,
		errors: {},
		fx: {
			midRate: 1300,
			buyRate: 1305,
			validFrom: "2026-10-29T16:10:00+09:00",
		},
		cash: { krw: 7654321, usd: 8765.43, totalKrw: 19049380 },
		totals: {
			totalAssetsKrw: 98765432,
			stocksEvalKrw: 79716052,
			purchaseKrw: 67890123,
			profitLossKrw: 11825929,
			returnRate: 0.174192,
			dailyPlKrw: 234567,
			dailyPlRate: 0.00316,
		},
		holdings: [
			{
				symbol: "FAKEKR",
				name: "가상 한국기업",
				market: "KR",
				currency: "KRW",
				quantity: 837.53125,
				avgPrice: 45678,
				lastPrice: 52000,
				basePrice: 52000,
				purchaseAmount: 6282152,
				evalAmount: 7151625,
				profitLoss: 869473,
				returnRate: 0.1384,
				dailyPl: 123456,
				evalKrw: 7151625,
				weight: 0.0724,
			},
			{
				symbol: "FAKEUS",
				name: "FAKE 미국기업",
				market: "US",
				currency: "USD",
				quantity: 643.71875,
				avgPrice: 187.63,
				lastPrice: 212.5,
				basePrice: 212.5,
				purchaseAmount: 45729.11,
				evalAmount: 51790.23,
				profitLoss: 6061.12,
				returnRate: 0.1325,
				dailyPl: -157.83,
				evalKrw: 67327299,
				weight: 0.6817,
			},
		],
	};
}
export const privacyTrend: TrendPoint[] = [
	{
		date: "2026-10-28",
		ts: "2026-10-28T16:11:00+09:00",
		totalAssetsKrw: 98530865,
		stocksEvalKrw: 79481485,
		purchaseKrw: 67890123,
		profitLossKrw: 11591362,
		returnRate: 0.170736,
	},
	{
		date: "2026-10-29",
		ts: "2026-10-29T16:11:00+09:00",
		totalAssetsKrw: 98765432,
		stocksEvalKrw: 79716052,
		purchaseKrw: 67890123,
		profitLossKrw: 11825929,
		returnRate: 0.174192,
	},
];
export function privateValues(state = privacyFixture()) {
	return [
		state.totals.totalAssetsKrw,
		state.totals.stocksEvalKrw,
		state.totals.purchaseKrw,
		state.totals.profitLossKrw,
		state.totals.dailyPlKrw,
		...Object.values(state.cash ?? {}),
		...state.holdings.flatMap((row) => [
			row.quantity,
			row.avgPrice,
			row.purchaseAmount,
			row.evalAmount,
			row.evalKrw,
			row.profitLoss,
			row.dailyPl,
		]),
		...privacyTrend.flatMap((point) => [
			point.totalAssetsKrw,
			point.stocksEvalKrw,
			point.stocksEvalKrw - point.purchaseKrw,
			point.purchaseKrw,
			point.profitLossKrw,
		]),
	];
}
