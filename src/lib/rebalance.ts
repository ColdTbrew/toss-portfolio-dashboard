import type { TargetWeights } from "./targets";
import type { HoldingRow, PortfolioState } from "./types";

export interface RebalanceRow {
	symbol: string;
	name: string;
	currentPercent: number | null;
	targetPercent: number | null;
	driftPp: number | null;
	neededKrw: number | null;
	shares: number | null;
}

export function approximateShares(
	neededKrw: number,
	holding: HoldingRow,
	midRate: number | null,
) {
	const price =
		holding.lastPrice * (holding.currency === "USD" ? (midRate ?? 0) : 1);
	if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(neededKrw))
		return null;
	const scale = holding.market === "US" ? 100 : 1;
	const scaled = (Math.abs(neededKrw) / price) * scale;
	// Correct only binary rounding noise at exact share boundaries.
	return Math.floor(scaled + Number.EPSILON * Math.max(1, scaled) * 2) / scale;
}

export function rebalance(state: PortfolioState, targets: TargetWeights) {
	const total = state.totals.totalAssetsKrw;
	const validTotal = Number.isFinite(total) && total > 0;
	const row = (
		symbol: string,
		name: string,
		evaluation: number | null,
		holding?: HoldingRow,
	): RebalanceRow => {
		const currentPercent =
			validTotal && evaluation !== null && Number.isFinite(evaluation)
				? (evaluation / total) * 100
				: null;
		const targetPercent = Object.hasOwn(targets, symbol)
			? targets[symbol]
			: null;
		const difference =
			currentPercent !== null && targetPercent !== null
				? currentPercent - targetPercent
				: null;
		const driftPp =
			difference !== null && Math.abs(difference) < 1e-10 ? 0 : difference;
		const neededKrw = driftPp === null ? null : (-driftPp / 100) * total;
		return {
			symbol,
			name,
			currentPercent,
			targetPercent,
			driftPp,
			neededKrw,
			shares:
				holding && neededKrw !== null
					? approximateShares(neededKrw, holding, state.fx?.midRate ?? null)
					: null,
		};
	};
	const rows = state.holdings
		.filter((holding) => holding.symbol !== "CASH")
		.map((holding) =>
			row(holding.symbol, holding.name, holding.evalKrw, holding),
		);
	rows.push(row("CASH", "현금", state.cash?.totalKrw ?? null));
	const known = new Set(rows.map((value) => value.symbol));
	for (const symbol of Object.keys(targets)) {
		if (!known.has(symbol)) rows.push(row(symbol, "현재 보유 정보 없음", null));
	}
	const targetTotal = Object.values(targets).reduce(
		(sum, value) => sum + value,
		0,
	);
	const suggested = rows.filter(
		(value) => value.symbol !== "CASH" && value.neededKrw !== null,
	);
	return {
		rows,
		targetTotal,
		untargetedPercent: Math.max(0, 100 - targetTotal),
		// Cash is a desired balance, not another security purchase.
		netCashNeededKrw: suggested.length
			? suggested.reduce((sum, value) => sum + (value.neededKrw ?? 0), 0)
			: null,
	};
}
