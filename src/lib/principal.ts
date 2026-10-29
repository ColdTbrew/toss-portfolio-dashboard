import { ratio } from "./compute";
import type { TrendPoint } from "./types";

type HistoricalPoint = Omit<TrendPoint, "stocksEvalKrw"> &
	Partial<Pick<TrendPoint, "stocksEvalKrw">>;

export interface PrincipalPoint {
	date: string;
	value: number;
	principal: number;
	gap: number;
	gapRate: number;
}

// Dates are ledger calendar days in Korea; UTC arithmetic avoids host timezone/DST shifts.
const dayTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function principalSeries(
	points: readonly HistoricalPoint[],
	periodDays: number,
): PrincipalPoint[] {
	if (!Number.isInteger(periodDays) || periodDays < 1) return [];
	const series = points
		.map((point) => {
			const principal = point.purchaseKrw;
			const value =
				point.stocksEvalKrw === undefined
					? principal + point.profitLossKrw
					: point.stocksEvalKrw;
			const gap = value - principal;
			return {
				date: point.date,
				value,
				principal,
				gap,
				gapRate: ratio(gap, principal),
			};
		})
		.filter((point) =>
			[
				dayTime(point.date),
				point.value,
				point.principal,
				point.gap,
				point.gapRate,
			].every(Number.isFinite),
		)
		.sort((a, b) => a.date.localeCompare(b.date));
	const latest = series.at(-1);
	if (!latest) return [];
	const start = dayTime(latest.date) - (periodDays - 1) * 86_400_000;
	return series.filter((point) => dayTime(point.date) >= start);
}
