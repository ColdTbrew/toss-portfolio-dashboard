import { buildState, kstIso, timeZoneOffsetMinutes } from "../lib/compute";
import type { TargetsDocument } from "../lib/targets";
import type {
	ByCcy,
	DatedClose,
	HoldingsItem,
	IntradayPoint,
	PortfolioState,
	RawPortfolio,
	RealizedData,
	RealizedPeriod,
	RealizedSymbol,
	RealizedTotal,
	Tick,
	TimedClose,
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
	// Stress rows for mobile layout: fractional US quantities and a large KR position.
	const stress: Record<
		number,
		{ quantity: number; average: number; lastRatio?: number }
	> = {
		5: { quantity: 1234, average: 812345, lastRatio: 2.1234 },
		6: { quantity: 51.141929, average: 323.86 },
		7: { quantity: 37.028539, average: 111.15 },
		8: { quantity: 2.339311, average: 1071.21 },
	};
	const items: HoldingsItem[] = Array.from({ length: 12 }, (_, i) => {
		const domestic = i < 6;
		const quantity = stress[i]?.quantity ?? 8 + i * 3;
		const average =
			stress[i]?.average ?? (domestic ? 24000 + i * 12000 : 55 + (i - 6) * 42);
		const last = average * (stress[i]?.lastRatio ?? 1 + ((i % 4) - 1) * 0.08);
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

export function createMockIntraday(
	symbol: string,
	last: number,
	change: number | null,
	now = Date.now(),
): IntradayPoint[] {
	const seed = Array.from(symbol).reduce(
		(hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
		0,
	);
	// 5-minute bars: 6.5h equity session (78), ~22h WTI session (264).
	const points = symbol === "CL=F" ? 264 : 78;
	const stepMs = 5 * 60_000;
	const start = now - (points - 1) * stepMs;
	const previous = change !== null ? last - change : last;
	const wave = (i: number) =>
		Math.sin(i / (3 + (seed % 5)) + (seed % 9)) * 0.0045 +
		Math.cos(i * 1.7 + (seed % 13)) * 0.002;
	return Array.from({ length: points }, (_, i) => {
		const progress = i / (points - 1);
		const drift = previous + (change ?? 0) * progress;
		// Anchor both ends so the series runs previous -> last.
		const oscillation =
			previous * (wave(i) - wave(0) - progress * (wave(points - 1) - wave(0)));
		return {
			t: start + i * stepMs,
			v: Number((drift + oscillation).toFixed(4)),
		};
	});
}

// One-minute bars for the most recent session, starting near the previous
// close and ending exactly at the mock last price (same seeding as mockHistory).
const sessions = {
	KR: { open: 9 * 60, close: 15 * 60 + 30, timeZone: "Asia/Seoul" },
	US: { open: 9 * 60 + 30, close: 16 * 60, timeZone: "America/New_York" },
} as const;

export function mockIntraday(
	symbol: string,
	market: "KR" | "US",
	previousClose: number,
	last: number,
	now = Date.now(),
): TimedClose[] {
	const seed = Array.from(symbol).reduce(
		(hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
		0,
	);
	const session = sessions[market];
	const offset = timeZoneOffsetMinutes(session.timeZone, now);
	// Wall-clock date of `now` in the exchange time zone, as if it were UTC.
	const local = new Date(now + offset * 60_000);
	const openUtc =
		Date.UTC(
			local.getUTCFullYear(),
			local.getUTCMonth(),
			local.getUTCDate(),
			Math.floor(session.open / 60),
			session.open % 60,
		) -
		offset * 60_000;
	const closeUtc =
		Date.UTC(
			local.getUTCFullYear(),
			local.getUTCMonth(),
			local.getUTCDate(),
			Math.floor(session.close / 60),
			session.close % 60,
		) -
		offset * 60_000;
	// Before the open (or on later days) show the full session; otherwise the
	// elapsed part of the live session.
	const end = now > openUtc ? Math.min(now, closeUtc) : closeUtc;
	const count = Math.max(1, Math.round((end - openUtc) / 60_000) + 1);
	const points: TimedClose[] = [];
	for (let i = 0; i < count; i++) {
		const fraction = count === 1 ? 1 : i / (count - 1);
		const drift = previousClose + (last - previousClose) * fraction;
		const wobble =
			Math.sin(i / (3 + (seed % 5)) + (seed % 9)) * 0.002 +
			Math.cos(i * 1.7 + (seed % 13)) * 0.0008;
		const close =
			i === count - 1 ? last : Number((drift * (1 + wobble)).toFixed(4));
		points.push({
			t: new Date(openUtc + i * 60_000).toISOString(),
			close,
		});
	}
	return points;
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

// All fixtures are fictional. UTC arithmetic below represents KST calendar dates.
export function createMockRealized(now = Date.now()): RealizedData {
	const dayMs = 86_400_000;
	const today = Date.parse(`${kstIso(now).slice(0, 10)}T00:00:00Z`);
	const dateKey = (time: number) => new Date(time).toISOString().slice(0, 10);
	const startOf = (time: number, period: RealizedPeriod): number => {
		const date = new Date(time);
		if (period === "week")
			date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		if (period === "month" || period === "year") date.setUTCDate(1);
		if (period === "year") date.setUTCMonth(0);
		return date.getTime();
	};
	const raw = createMockRaw(now);
	const items = raw.holdings?.items ?? [];
	const mid = Number(raw.fx?.midRate ?? 1350);
	// Twelve recent sells, with repeat symbols and deliberately empty days.
	const fixtures = [0, 0, 2, 4, 6, 8, 11, 14, 18, 21, 25, 28].map(
		(offset, i) => ({
			settlement: today - offset * dayMs,
			itemIndex: [0, 6, 1, 7, 0, 8, 2, 9, 3, 10, 4, 11][i],
		}),
	);
	// A few sells each earlier month, spanning over three years. Avoid adding
	// more sells to the recent 30-day window, even at month/year boundaries.
	for (let month = 1; month <= 36; month++) {
		for (const [i, day] of [1, 5, 9].entries()) {
			const date = new Date(startOf(today, "month"));
			date.setUTCMonth(date.getUTCMonth() - month);
			date.setUTCDate(day);
			if (date.getTime() <= today - 30 * dayMs)
				fixtures.push({
					settlement: date.getTime(),
					itemIndex: (month * 3 + i) % items.length,
				});
		}
	}
	const sells = fixtures.map(({ settlement, itemIndex }, i) => {
		const item = items[itemIndex];
		const usd = item.currency === "USD";
		const pending = i === 1;
		const fxRate = usd && !pending ? 1320 + (i % 15) * 3 : null;
		const conversion = usd ? (fxRate ?? mid) : 1;
		// Amounts are native to the selected holding, never to its fixture index.
		const realized = usd
			? [82.5, 125, -32, -68.5, 215, -47.5][i % 6]
			: [48600, 125000, -21000, -74500, 96500, -31500][i % 6];
		const quantity = usd ? 3.125 + (i % 8) : 8 + (i % 12);
		const costKrw = Math.round(
			Number(item.averagePurchasePrice) * quantity * conversion,
		);
		const realizedKrw = Math.round(realized * conversion);
		return {
			symbol: item.symbol,
			name: item.name,
			market: item.marketCountry,
			currency: item.currency,
			quantity,
			realized,
			realizedKrw,
			rate: realizedKrw / costKrw,
			fxRate,
			fxEstimated: pending,
			estimated: pending,
			pending,
			sellDate: dateKey(settlement - (pending ? 0 : 2) * dayMs),
			settlement,
			costKrw,
		};
	});
	const summarize = (rows: typeof sells): RealizedTotal => {
		const realizedKrw = rows.reduce((sum, row) => sum + row.realizedKrw, 0);
		const costKrw = rows.reduce((sum, row) => sum + row.costKrw, 0);
		return {
			realizedKrw,
			pending: rows.some((row) => row.pending),
			rate: costKrw ? realizedKrw / costKrw : 0,
			sellCount: rows.length,
			pendingKrw: rows.reduce(
				(sum, row) => sum + (row.pending ? row.realizedKrw : 0),
				0,
			),
			byCcy: {
				KRW: rows
					.filter((row) => row.currency === "KRW")
					.reduce((sum, row) => sum + row.realized, 0),
				USD: rows
					.filter((row) => row.currency === "USD")
					.reduce((sum, row) => sum + row.realized, 0),
			},
			estimated: rows.some((row) => row.fxEstimated),
		};
	};
	const data: RealizedData = {
		asOf: new Date(now).toISOString(),
		basis: "settlement",
		totals: {} as RealizedData["totals"],
		buckets: {} as RealizedData["buckets"],
		bySymbol: {} as RealizedData["bySymbol"],
	};
	for (const period of ["day", "week", "month", "year"] as const) {
		const current = startOf(today, period);
		const rows = sells.filter(
			(row) => startOf(row.settlement, period) === current,
		);
		data.totals[period] = summarize(rows);
		const grouped = new Map<string, RealizedSymbol & { costKrw: number }>();
		for (const row of rows) {
			const existing = grouped.get(row.symbol);
			if (!existing) {
				const { settlement: _settlement, sellDate, ...values } = row;
				grouped.set(row.symbol, {
					...values,
					lastSellDate: sellDate,
					sellCount: 1,
					pendingKrw: row.pending ? row.realizedKrw : 0,
				});
				continue;
			}
			existing.quantity += row.quantity;
			existing.realized += row.realized;
			existing.realizedKrw += row.realizedKrw;
			existing.costKrw += row.costKrw;
			existing.rate = existing.realizedKrw / existing.costKrw;
			existing.sellCount++;
			if (row.sellDate > existing.lastSellDate)
				existing.lastSellDate = row.sellDate;
			existing.pending ||= row.pending;
			existing.pendingKrw += row.pending ? row.realizedKrw : 0;
			existing.fxEstimated ||= row.fxEstimated;
			existing.estimated ||= row.estimated;
			if (existing.fxEstimated || existing.fxRate !== row.fxRate)
				existing.fxRate = null;
		}
		data.bySymbol[period] = [...grouped.values()].map(
			({ costKrw: _cost, ...row }) => row,
		);
		const count =
			period === "day"
				? 30
				: period === "year"
					? new Date(today).getUTCFullYear() -
						new Date(sells.at(-1)?.settlement ?? today).getUTCFullYear() +
						1
					: 12;
		data.buckets[period] = Array.from({ length: count }, (_, i) => {
			const date = new Date(current);
			const offset = count - 1 - i;
			if (period === "day" || period === "week")
				date.setUTCDate(
					date.getUTCDate() - offset * (period === "week" ? 7 : 1),
				);
			if (period === "month") date.setUTCMonth(date.getUTCMonth() - offset);
			if (period === "year")
				date.setUTCFullYear(date.getUTCFullYear() - offset);
			const key = dateKey(date.getTime());
			const total = summarize(
				sells.filter(
					(row) => startOf(row.settlement, period) === date.getTime(),
				),
			);
			const label =
				period === "year"
					? key.slice(0, 4)
					: period === "month"
						? key.slice(0, 7)
						: `${date.getUTCMonth() + 1}/${date.getUTCDate()}${period === "week" ? " 주" : ""}`;
			return {
				key,
				label,
				realizedKrw: total.realizedKrw,
				rate: total.rate,
				estimated: total.estimated,
			};
		});
	}
	return data;
}
