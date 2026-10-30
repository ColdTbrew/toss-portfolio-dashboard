import type { ByCcy, PortfolioState, RawPortfolio, Tick } from "./types";

export function kstIso(now = Date.now()): string {
	return `${new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, -1)}+09:00`;
}

export function ratio(amount: number, basis: number): number {
	return basis === 0 ? 0 : amount / basis;
}

export function buildState(
	raw: RawPortfolio,
	{
		now = Date.now(),
		mock = false,
		errors = {},
	}: { now?: number; mock?: boolean; errors?: Record<string, string> } = {},
): PortfolioState {
	const mid = raw.fx ? Number(raw.fx.midRate) : 0;
	const convert = (value?: ByCcy) =>
		Number(value?.krw ?? 0) + Number(value?.usd ?? 0) * mid;
	const holdings =
		raw.holdings?.items.map((item) => ({
			symbol: item.symbol,
			name: item.name,
			market: item.marketCountry,
			currency: item.currency,
			quantity: Number(item.quantity),
			avgPrice: Number(item.averagePurchasePrice),
			lastPrice: Number(item.lastPrice),
			basePrice: Number(item.lastPrice),
			purchaseAmount: Number(item.marketValue.purchaseAmount),
			evalAmount: Number(item.marketValue.amount),
			profitLoss: Number(item.profitLoss.amount),
			returnRate: Number(item.profitLoss.rate),
			dailyPl: Number(item.dailyProfitLoss.amount),
			evalKrw:
				Number(item.marketValue.amount) * (item.currency === "USD" ? mid : 1),
			weight: 0,
		})) ?? [];
	const krw = Number(raw.krw?.cashBuyingPower ?? 0);
	const usd = Number(raw.usd?.cashBuyingPower ?? 0);
	const cash =
		raw.krw && raw.usd ? { krw, usd, totalKrw: krw + usd * mid } : null;
	const stocksEvalKrw = convert(raw.holdings?.marketValue.amount);
	const purchaseKrw = convert(raw.holdings?.totalPurchaseAmount);
	const profitLossKrw = convert(raw.holdings?.profitLoss.amount);
	const totalAssetsKrw = stocksEvalKrw + (cash?.totalKrw ?? 0);
	const stateErrors = { ...errors };
	if (
		!raw.fx &&
		(usd !== 0 || holdings.some((row) => row.currency === "USD"))
	) {
		stateErrors.fx ??=
			"USD/KRW mid rate unavailable; KRW totals exclude USD amounts";
	}
	return {
		fetchedAt: kstIso(now),
		mock,
		fx: raw.fx
			? {
					midRate: mid,
					buyRate: Number(raw.fx.rate),
					validFrom: raw.fx.validFrom,
				}
			: null,
		cash,
		holdings: holdings.map((row) => ({
			...row,
			weight: ratio(row.evalKrw, totalAssetsKrw),
		})),
		totals: {
			stocksEvalKrw,
			purchaseKrw,
			profitLossKrw,
			totalAssetsKrw,
			returnRate: ratio(profitLossKrw, purchaseKrw),
			dailyPlKrw: convert(raw.holdings?.dailyProfitLoss.amount),
			dailyPlRate: Number(raw.holdings?.dailyProfitLoss.rate ?? 0),
		},
		errors: stateErrors,
	};
}

export function applyTick(state: PortfolioState, tick: Tick): PortfolioState {
	if (
		!Number.isFinite(tick.price) ||
		tick.price <= 0 ||
		!Number.isFinite(Date.parse(tick.timestamp))
	)
		return state;
	const index = state.holdings.findIndex(
		(row) =>
			row.symbol === tick.symbol && row.market.toLowerCase() === tick.market,
	);
	if (index < 0) return state;
	const row = state.holdings[index];
	if (
		Date.parse(tick.timestamp) < Date.parse(row.lastTickAt ?? state.fetchedAt)
	)
		return state;
	const delta = (tick.price - row.lastPrice) * row.quantity;
	const deltaKrw =
		delta * (row.currency === "USD" ? (state.fx?.midRate ?? 0) : 1);
	const evalAmount = row.evalAmount + delta;
	const profitLoss = row.profitLoss + delta;
	const totals = {
		...state.totals,
		stocksEvalKrw: state.totals.stocksEvalKrw + deltaKrw,
		profitLossKrw: state.totals.profitLossKrw + deltaKrw,
		dailyPlKrw: state.totals.dailyPlKrw + deltaKrw,
		totalAssetsKrw: state.totals.totalAssetsKrw + deltaKrw,
	};
	totals.returnRate = ratio(totals.profitLossKrw, totals.purchaseKrw);
	const dailyBasis = state.totals.stocksEvalKrw - state.totals.dailyPlKrw;
	totals.dailyPlRate = ratio(totals.dailyPlKrw, dailyBasis);
	return {
		...state,
		totals,
		holdings: state.holdings.map((holding, i) => {
			const updated =
				i === index
					? {
							...row,
							lastPrice: tick.price,
							evalAmount,
							profitLoss,
							returnRate: ratio(profitLoss, row.purchaseAmount),
							dailyPl: row.dailyPl + delta,
							evalKrw: row.evalKrw + deltaKrw,
							lastTickAt: tick.timestamp,
						}
					: holding;
			return {
				...updated,
				weight: ratio(updated.evalKrw, totals.totalAssetsKrw),
			};
		}),
	};
}
