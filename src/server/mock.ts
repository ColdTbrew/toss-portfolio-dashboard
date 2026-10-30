import { buildState, kstIso } from "../lib/compute";
import type { TargetsDocument } from "../lib/targets";
import type {
	ByCcy,
	DatedClose,
	HoldingsItem,
	PortfolioState,
	RawPortfolio,
	Tick,
	TrendPoint,
} from "../lib/types";

export function createMockTargets(): TargetsDocument {
	const updatedAt = "2000-01-01T00:00:00.000Z";
	const holdings = createMockRaw(Date.parse(updatedAt)).holdings?.items ?? [];
	return {
		version: 1,
		updatedAt,
		targets: {
			...Object.fromEntries(
				holdings.map((row, i) => [row.symbol, i === 11 ? 7 : 8]),
			),
			CASH: 5,
		},
	};
}

export function createMockRaw(now = Date.now()): RawPortfolio {
	const items: HoldingsItem[] = Array.from({ length: 12 }, (_, i) => {
		const domestic = i < 6;
		const quantity = 8 + i * 3;
		const average = domestic ? 24000 + i * 12000 : 55 + (i - 6) * 42;
		const last = average * (1 + ((i % 4) - 1) * 0.08);
		const amount = quantity * last;
		const purchase = quantity * average;
		const pnl = amount - purchase;
		const daily = amount * (i % 2 ? 0.008 : -0.006);
		return {
			symbol: domestic ? `FAKEK${i + 1}` : `FAKEU${i - 5}`,
			name: domestic
				? `가상기업 ${i + 1} (모의)`
				: `Demo Company ${i - 5} (FAKE)`,
			marketCountry: domestic ? "KR" : "US",
			currency: domestic ? "KRW" : "USD",
			quantity: String(quantity),
			averagePurchasePrice: String(average),
			lastPrice: last.toFixed(2),
			marketValue: {
				purchaseAmount: purchase.toFixed(2),
				amount: amount.toFixed(2),
				amountAfterCost: (amount * 0.998).toFixed(2),
			},
			profitLoss: {
				amount: pnl.toFixed(2),
				amountAfterCost: (pnl - amount * 0.002).toFixed(2),
				rate: String(pnl / purchase),
				rateAfterCost: String((pnl - amount * 0.002) / purchase),
			},
			dailyProfitLoss: {
				amount: daily.toFixed(2),
				rate: String(daily / (amount - daily)),
			},
			cost: { commission: (amount * 0.002).toFixed(2), tax: "0" },
		};
	});
	const sum = (get: (item: HoldingsItem) => string): ByCcy => ({
		krw: items
			.filter((item) => item.currency === "KRW")
			.reduce((sum, item) => sum + Number(get(item)), 0)
			.toFixed(2),
		usd: items
			.filter((item) => item.currency === "USD")
			.reduce((sum, item) => sum + Number(get(item)), 0)
			.toFixed(2),
	});
	const evaluated = sum((item) => item.marketValue.amount);
	const purchased = sum((item) => item.marketValue.purchaseAmount);
	const pl = sum((item) => item.profitLoss.amount);
	const daily = sum((item) => item.dailyProfitLoss.amount);
	const convert = (value: ByCcy) =>
		Number(value.krw) + Number(value.usd) * 1350;
	return {
		holdings: {
			items,
			totalPurchaseAmount: purchased,
			marketValue: {
				amount: evaluated,
				amountAfterCost: sum((item) => item.marketValue.amountAfterCost),
			},
			profitLoss: {
				amount: pl,
				amountAfterCost: sum((item) => item.profitLoss.amountAfterCost),
				rate: String(convert(pl) / convert(purchased)),
				rateAfterCost: "0",
			},
			dailyProfitLoss: {
				amount: daily,
				rate: String(convert(daily) / (convert(evaluated) - convert(daily))),
			},
		},
		krw: { currency: "KRW", cashBuyingPower: "3500000" },
		usd: { currency: "USD", cashBuyingPower: "1200.50" },
		fx: {
			baseCurrency: "USD",
			quoteCurrency: "KRW",
			midRate: "1350",
			rate: "1355.4",
			basisPoint: "40",
			rateChangeType: "UP",
			validFrom: kstIso(now),
			validUntil: kstIso(now + 60_000),
		},
	};
}

export function mockHistory(
	symbol: string,
	last: number,
	now = Date.now(),
): DatedClose[] {
	const seed = Array.from(symbol).reduce(
		(hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
		0,
	);
	const dates: string[] = [];
	let time = Date.parse(`${kstIso(now).slice(0, 10)}T00:00:00Z`);
	while (dates.length < 200) {
		const day = new Date(time);
		if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6)
			dates.unshift(day.toISOString().slice(0, 10));
		time -= 86_400_000;
	}
	const level = (i: number) =>
		(i * ((seed % 17) - 6)) / 8000 +
		Math.sin(i / (3 + (seed % 5)) + (seed % 9)) * 0.035 +
		Math.cos(i * 1.7 + (seed % 13)) * 0.008;
	return dates.map((date, i) => ({
		date,
		close: Number((last * Math.exp(level(i) - level(199))).toFixed(4)),
	}));
}

export function createMockTrend(now = Date.now()): TrendPoint[] {
	const { totals, cash } = buildState(createMockRaw(now));
	const purchases = [
		{ day: 12, amount: 3000000 },
		{ day: 30, amount: 5000000 },
		{ day: 46, amount: 4000000 },
	];
	return Array.from({ length: 90 }, (_, index) => {
		const ts = kstIso(now - (89 - index) * 86_400_000);
		const purchaseKrw = purchases.reduce(
			(principal, purchase) =>
				principal - (index < purchase.day ? purchase.amount : 0),
			totals.purchaseKrw,
		);
		const profitLossKrw =
			index === 89
				? totals.stocksEvalKrw - totals.purchaseKrw
				: totals.profitLossKrw * (0.5 + index / 178) +
					Math.sin(index / 5) * 180000;
		const stocksEvalKrw = purchaseKrw + profitLossKrw;
		return {
			date: ts.slice(0, 10),
			ts,
			totalAssetsKrw: stocksEvalKrw + (cash?.totalKrw ?? 0),
			stocksEvalKrw,
			profitLossKrw,
			purchaseKrw,
			returnRate: profitLossKrw / purchaseKrw,
		};
	});
}

export function mockTicks(
	state: PortfolioState,
	now = Date.now(),
	random?: () => number,
): Tick[] {
	return state.holdings.map((row, index) => ({
		symbol: row.symbol,
		market: row.market === "KR" ? "kr" : "us",
		price: Math.max(
			row.currency === "KRW" ? 1 : 0.01,
			Number(
				(
					row.lastPrice *
					(1 +
						((random?.() ??
							(Math.sin(Math.floor(now / 1000) + index * 1.7) + 1) / 2) -
							0.5) *
							0.002)
				).toFixed(row.currency === "KRW" ? 0 : 2),
			),
		),
		timestamp: kstIso(now),
	}));
}
