import { kstIso, ratio } from "./compute";
import type { PortfolioState } from "./types";

export const ALLOCATION_COLORS = [
	"#6366f1",
	"#3b82f6",
	"#22b8a8",
	"#e4ad48",
	"#a78bfa",
	"#f28d82",
	"#94a3b8",
];

export function allocationSlices(state: PortfolioState) {
	const slices = state.holdings
		.map((row) => ({ name: row.name, weight: row.weight }))
		.filter((row) => row.weight > 0);
	if (state.cash && state.cash.totalKrw > 0)
		slices.push({
			name: "현금",
			weight: ratio(state.cash.totalKrw, state.totals.totalAssetsKrw),
		});
	slices.sort((a, b) => b.weight - a.weight);
	if (slices.length <= 6) return slices;
	return [
		...slices.slice(0, 6),
		{
			name: "기타",
			weight: slices.slice(6).reduce((total, slice) => total + slice.weight, 0),
		},
	];
}

interface ShareCardBase {
	title: "내 포트폴리오";
	date: string;
	returnRate: number;
	dailyReturnRate: number;
	allocation: { name: string; weight: number }[];
	topHoldings: { name: string; returnRate: number }[];
}
export type PrivateShareCard = ShareCardBase & {
	includeAmounts: false;
	amounts?: never;
};
export type AmountShareCard = ShareCardBase & {
	includeAmounts: true;
	amounts: { totalAssetsKrw: number; profitLossKrw: number };
};
export type ShareCardModel = PrivateShareCard | AmountShareCard;
type Options = { includeAmounts?: boolean; now?: number };

export function buildShareCardModel(
	state: PortfolioState,
	options?: Options & { includeAmounts?: false },
): PrivateShareCard;
export function buildShareCardModel(
	state: PortfolioState,
	options: Options & { includeAmounts: true },
): AmountShareCard;
export function buildShareCardModel(
	state: PortfolioState,
	options: Options,
): ShareCardModel;
export function buildShareCardModel(
	state: PortfolioState,
	{ includeAmounts = false, now = Date.now() }: Options = {},
): ShareCardModel {
	const base: ShareCardBase = {
		title: "내 포트폴리오",
		date: kstIso(now).slice(0, 10),
		returnRate: state.totals.returnRate,
		dailyReturnRate: state.totals.dailyPlRate,
		allocation: allocationSlices(state),
		topHoldings: [...state.holdings]
			.sort((a, b) => b.returnRate - a.returnRate)
			.slice(0, 5)
			.map((row) => ({ name: row.name, returnRate: row.returnRate })),
	};
	return includeAmounts
		? {
				...base,
				includeAmounts: true,
				amounts: {
					totalAssetsKrw: state.totals.totalAssetsKrw,
					profitLossKrw: state.totals.profitLossKrw,
				},
			}
		: { ...base, includeAmounts: false };
}
