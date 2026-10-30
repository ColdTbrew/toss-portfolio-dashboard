import type {
	AnalyticsData,
	DatedClose,
	HoldingRow,
	PortfolioState,
	TrendPoint,
} from "./types";

const day = 86_400_000;
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
export function sortedCloses(points: readonly DatedClose[]): DatedClose[] {
	return [
		...new Map(
			points
				.filter(
					(p) =>
						Number.isFinite(time(p.date)) &&
						Number.isFinite(p.close) &&
						p.close > 0,
				)
				.map((p) => [p.date, p]),
		).values(),
	].sort((a, b) => a.date.localeCompare(b.date));
}
export function windowSeries<T extends { date: string }>(
	points: readonly T[],
	days: number,
): T[] {
	const end = points.at(-1);
	return end
		? points.filter(
				(p) => days === 0 || time(p.date) >= time(end.date) - days * day,
			)
		: [];
}
export function onOrBefore(
	points: readonly DatedClose[],
	date: string,
): DatedClose | undefined {
	for (let i = points.length - 1; i >= 0; i--)
		if (points[i].date <= date) return points[i];
	return undefined;
}
export function periodEndpoints(points: readonly DatedClose[], days: number) {
	const series = sortedCloses(points);
	const end = series.at(-1);
	if (!end) return null;
	const startDate = new Date(time(end.date) - days * day)
		.toISOString()
		.slice(0, 10);
	const start = onOrBefore(series, startDate);
	return start && start.date < end.date ? { start, end } : null;
}

export interface ReturnPoint {
	date: string;
	index: number;
	dailyReturn: number | null;
}
export function snapshotReturns(points: readonly TrendPoint[]): ReturnPoint[] {
	const unique = new Map<string, TrendPoint>();
	for (const p of points) {
		if (
			![time(p.date), p.profitLossKrw, p.stocksEvalKrw].every(Number.isFinite)
		)
			continue;
		const previous = unique.get(p.date);
		if (!previous || p.ts > previous.ts) unique.set(p.date, p);
	}
	const ordered = [...unique.values()].sort((a, b) =>
		a.date.localeCompare(b.date),
	);
	let index = 1;
	const result: ReturnPoint[] = [];
	for (const [i, point] of ordered.entries()) {
		const prev = ordered[i - 1];
		const dailyReturn = prev
			? (point.profitLossKrw - prev.profitLossKrw) / prev.stocksEvalKrw
			: null;
		// An uninvested or invalid base cannot define a linked return. Start a new segment.
		if (
			prev &&
			(prev.stocksEvalKrw <= 0 ||
				dailyReturn === null ||
				!Number.isFinite(dailyReturn) ||
				dailyReturn < -1)
		) {
			result.length = 0;
			index = 1;
			result.push({ date: point.date, index, dailyReturn: null });
			continue;
		}
		if (dailyReturn !== null) index *= 1 + dailyReturn;
		result.push({ date: point.date, index, dailyReturn });
	}
	return result;
}

export function benchmarkComparison(
	points: readonly TrendPoint[],
	benchmarks: AnalyticsData["benchmarks"],
	days: number,
) {
	const portfolio = windowSeries(snapshotReturns(points), days);
	const first = portfolio[0];
	if (!first || first.index <= 0 || portfolio.length < 2) return [];
	const histories = Object.entries(benchmarks)
		.map(([symbol, values]) => {
			const series = sortedCloses(values);
			return { symbol, series, base: onOrBefore(series, first.date)?.close };
		})
		.filter((item) => item.base !== undefined);
	return portfolio.map((point) => ({
		date: point.date,
		portfolio: point.index / first.index - 1,
		...Object.fromEntries(
			histories.map(({ symbol, series, base }) => [
				symbol,
				(onOrBefore(series, point.date)?.close ?? base ?? 1) / (base ?? 1) - 1,
			]),
		),
	})) as Array<
		{ date: string; portfolio: number } & Partial<
			Record<"^KS11" | "^GSPC" | "^IXIC", number>
		>
	>;
}

export function drawdown(values: readonly number[]) {
	let peak = values[0] ?? 0;
	let mdd = 0;
	let current = 0;
	for (const value of values) {
		peak = Math.max(peak, value);
		current = peak > 0 ? value / peak - 1 : 0;
		mdd = Math.min(mdd, current);
	}
	return { mdd, current };
}
export function annualisedVolatility(
	returns: readonly number[],
	minimum = 20,
): number | null {
	if (returns.length < Math.max(2, minimum) || !returns.every(Number.isFinite))
		return null;
	const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
	const variance =
		returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
		(returns.length - 1);
	return Math.sqrt(variance * 252);
}
export function candleReturns(
	points: readonly DatedClose[],
	logarithmic = false,
) {
	const series = sortedCloses(points);
	return series.slice(1).map((point, i) => ({
		date: point.date,
		value: logarithmic
			? Math.log(point.close / series[i].close)
			: point.close / series[i].close - 1,
	}));
}
export function holdingRisk(points: readonly DatedClose[], days: number) {
	const series = windowSeries(sortedCloses(points), days);
	if (series.length < 2) return null;
	return {
		volatility: annualisedVolatility(
			candleReturns(series, true).map((p) => p.value),
		),
		...drawdown(series.map((p) => p.close)),
		returnRate: series[series.length - 1].close / series[0].close - 1,
		sessions: series.length,
	};
}
export function portfolioRisk(points: readonly TrendPoint[], days: number) {
	const series = windowSeries(snapshotReturns(points), days);
	if (series.length < 2) return null;
	return {
		...drawdown(series.map((p) => p.index)),
		volatility: annualisedVolatility(
			series
				.slice(1)
				.flatMap((p) => (p.dailyReturn === null ? [] : [p.dailyReturn])),
		),
		count: series.length - 1,
	};
}
export function pearson(
	a: readonly number[],
	b: readonly number[],
	minimum = 20,
): number | null {
	if (a.length !== b.length || a.length < minimum || a.length < 2) return null;
	const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
	const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
	let covariance = 0,
		varianceA = 0,
		varianceB = 0;
	for (let i = 0; i < a.length; i++) {
		covariance += (a[i] - meanA) * (b[i] - meanB);
		varianceA += (a[i] - meanA) ** 2;
		varianceB += (b[i] - meanB) ** 2;
	}
	const value = covariance / Math.sqrt(varianceA * varianceB);
	return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
}
export function pairwiseCorrelation(
	a: readonly DatedClose[],
	b: readonly DatedClose[],
	sessions: number,
) {
	const left = candleReturns(a).slice(-sessions);
	const right = new Map(
		candleReturns(b)
			.slice(-sessions)
			.map((p) => [p.date, p.value]),
	);
	const pairs = left.flatMap((p) => {
		const value = right.get(p.date);
		return value === undefined ? [] : [[p.value, value]];
	});
	return pearson(
		pairs.map((p) => p[0]),
		pairs.map((p) => p[1]),
	);
}

export function fxSplit(
	quantity: number,
	p0: number,
	p1: number,
	fx0: number,
	fx1: number,
) {
	const base = quantity * p0 * fx0;
	if (
		![quantity, p0, p1, fx0, fx1, base].every(Number.isFinite) ||
		base <= 0 ||
		p1 <= 0 ||
		fx1 <= 0
	)
		return null;
	const price = quantity * (p1 - p0) * fx0;
	const fx = quantity * p1 * (fx1 - fx0);
	const total = quantity * (p1 * fx1 - p0 * fx0);
	return {
		base,
		price,
		fx,
		total,
		priceRate: price / base,
		fxRate: fx / base,
		totalRate: total / base,
	};
}
export function holdingFx(row: HoldingRow, data: AnalyticsData, days: number) {
	const range = periodEndpoints(data.candles[row.symbol] ?? [], days);
	if (row.currency !== "USD" || !range) return null;
	const history = sortedCloses(data.usdkrw);
	const fx0 = onOrBefore(history, range.start.date)?.close;
	const fx1 = onOrBefore(history, range.end.date)?.close;
	return fx0 && fx1
		? fxSplit(row.quantity, range.start.close, range.end.close, fx0, fx1)
		: null;
}
export function totalFx(effects: readonly ReturnType<typeof fxSplit>[]) {
	if (!effects.length || effects.some((effect) => !effect)) return null;
	const totals = effects.reduce(
		(sum, effect) => ({
			base: sum.base + (effect?.base ?? 0),
			price: sum.price + (effect?.price ?? 0),
			fx: sum.fx + (effect?.fx ?? 0),
			total: sum.total + (effect?.total ?? 0),
		}),
		{ base: 0, price: 0, fx: 0, total: 0 },
	);
	return {
		...totals,
		priceRate: totals.price / totals.base,
		fxRate: totals.fx / totals.base,
		totalRate: totals.total / totals.base,
	};
}
export type ContributionPeriod = "today" | "all" | 7 | 30 | 90;
export function contributions(
	state: PortfolioState,
	data: AnalyticsData,
	period: ContributionPeriod,
) {
	const fxHistory = sortedCloses(data.usdkrw);
	const rows = state.holdings.map((row) => {
		const fx = row.currency === "USD" ? state.fx?.midRate : 1;
		let amount: number | null = null,
			base: number | null = null;
		if (period === "today" || period === "all") {
			if (fx !== undefined) {
				amount = (period === "today" ? row.dailyPl : row.profitLoss) * fx;
				base =
					period === "today" ? row.evalKrw - amount : row.purchaseAmount * fx;
			}
		} else {
			const range = periodEndpoints(data.candles[row.symbol] ?? [], period);
			if (range) {
				const fx0 =
					row.currency === "USD"
						? (onOrBefore(fxHistory, range.start.date)?.close ?? fx)
						: 1;
				const fx1 =
					row.currency === "USD"
						? (onOrBefore(fxHistory, range.end.date)?.close ?? fx)
						: 1;
				if (fx0 !== undefined && fx1 !== undefined) {
					base = row.quantity * range.start.close * fx0;
					amount =
						row.quantity * (range.end.close * fx1 - range.start.close * fx0);
				}
			}
		}
		return { symbol: row.symbol, name: row.name, amount, base };
	});
	const basis = rows.every((row) => row.base !== null)
		? rows.reduce((sum, row) => sum + (row.base ?? 0), 0)
		: 0;
	return rows
		.map((row) => ({
			...row,
			contribution:
				row.amount !== null && basis > 0 ? row.amount / basis : null,
		}))
		.sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity));
}
