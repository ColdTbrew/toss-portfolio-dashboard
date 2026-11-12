import { readFile } from "node:fs/promises";
import { kstIso } from "../lib/compute";
import type {
	HoldingRow,
	MaskedRealizedData,
	RealizedData,
	RealizedPeriod,
	RealizedSymbol,
	RealizedTotal,
} from "../lib/types";
import { writeTextAtomic } from "./atomicWrite";
import { type Now, type Sleep, sleep } from "./config";
import { withFileLock } from "./fileLock";
import { redact } from "./redact";
import {
	parseTransaction,
	type RawTransaction,
	type TransactionPage,
	type TransactionQuery,
} from "./transactions";

const DAY = 86_400_000;
const periods = ["day", "week", "month", "year"] as const;
const key = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
export function periodStart(date: string, period: RealizedPeriod): string {
	const time = new Date(dayTime(date));
	if (period === "week")
		time.setUTCDate(time.getUTCDate() - ((time.getUTCDay() + 6) % 7));
	if (period === "month" || period === "year") time.setUTCDate(1);
	if (period === "year") time.setUTCMonth(0);
	return key(time.getTime());
}
const relevant = (
	row: RawTransaction,
): row is RawTransaction & { symbol: string } =>
	typeof row.symbol === "string" &&
	row.assetClass === "STOCK" &&
	["BUY", "SELL", "SECURITIES_TRANSFER_IN", "SECURITIES_TRANSFER_OUT"].includes(
		row.transactionType,
	) &&
	["KR", "US"].includes(row.marketCountry) &&
	["KRW", "USD"].includes(row.currency);

export async function fetchTransactions(
	fetchPage: (query: TransactionQuery) => Promise<TransactionPage>,
	options: { from?: string; now?: Now; sleep?: Sleep; maxPages?: number } = {},
): Promise<RawTransaction[]> {
	const now = options.now ?? Date.now;
	const wait = options.sleep ?? sleep;
	const rows: RawTransaction[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	let previous: number | undefined;
	for (let page = 0; page < (options.maxPages ?? 1000); page++) {
		if (previous !== undefined)
			await wait(Math.max(0, 250 - (now() - previous)));
		previous = now();
		const result = await fetchPage({
			...(options.from ? { from: options.from } : {}),
			...(cursor ? { cursor } : {}),
			limit: 100,
		});
		rows.push(...result.transactions);
		if (!result.hasNext) return rows;
		if (!result.nextCursor || seen.has(result.nextCursor))
			throw new Error("Invalid transactions pagination");
		cursor = result.nextCursor;
		seen.add(cursor);
	}
	throw new Error("Transactions page limit exceeded");
}

export function createTransactionsCache(options: {
	path: string;
	fetchPage: (query: TransactionQuery) => Promise<TransactionPage>;
	now?: Now;
	sleep?: Sleep;
	warn?: (message: string) => void;
}) {
	const now = options.now ?? Date.now;
	let settled: RawTransaction[] = [];
	let unsettled: RawTransaction[] = [];
	let loaded = false;
	let exists = false;
	let attempted = -Infinity;
	let pending: Promise<void> | undefined;
	const warn = () =>
		(options.warn ?? console.warn)(
			redact("Transactions cache: malformed row skipped"),
		);
	async function load() {
		try {
			const content = await readFile(options.path, "utf8");
			exists = true;
			for (const line of content.split(/\r?\n/).filter(Boolean)) {
				try {
					const row = parseTransaction(JSON.parse(line));
					if (row.settled && relevant(row)) settled.push(row);
				} catch {
					warn();
				}
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("Cannot read transactions cache");
		}
		loaded = true;
	}
	async function refresh() {
		if (!loaded) await load();
		attempted = now();
		const from = exists
			? key(dayTime(kstIso(now()).slice(0, 10)) - 10 * DAY)
			: undefined;
		const fresh = (
			await fetchTransactions(options.fetchPage, {
				from,
				now,
				sleep: options.sleep,
			})
		).filter(relevant);
		const next = [
			...(from
				? settled.filter((row) => (row.settlementDate ?? "") < from)
				: []),
			...fresh.filter((row) => row.settled),
		];
		await withFileLock(`${options.path}.lock`, () =>
			writeTextAtomic(
				options.path,
				next.map((row) => JSON.stringify(row)).join("\n") +
					(next.length ? "\n" : ""),
			),
		);
		settled = next;
		unsettled = fresh.filter((row) => !row.settled);
		exists = true;
	}
	return {
		async read(): Promise<RawTransaction[]> {
			if (!loaded || now() - attempted >= 300_000) {
				pending ??= refresh()
					.catch((error) => {
						(options.warn ?? console.warn)(
							redact("Transactions refresh failed; retaining cached history"),
						);
						if (!exists)
							throw new Error(
								redact(
									error instanceof Error
										? error.message
										: "Transactions unavailable",
								),
							);
					})
					.finally(() => {
						pending = undefined;
					});
			}
			await pending;
			if (!exists) throw new Error(redact("Transactions unavailable"));
			return [...settled, ...unsettled];
		},
	};
}

type Sell = RealizedSymbol & {
	cost: number;
	bucketDate: string;
	estimated: boolean;
};
type Position = {
	quantity: number;
	cost: number;
	estimated: boolean;
	unknown: boolean;
	lastSellCost: number | null;
};
const QUANTITY_EPSILON = 1e-9;
const direction = (row: RawTransaction) =>
	["BUY", "SECURITIES_TRANSFER_IN"].includes(row.transactionType) ? 0 : 1;
const round = (value: number) =>
	Math.round((value + Number.EPSILON) * 1e8) / 1e8;
export function computeRealized(
	rows: readonly RawTransaction[],
	holdings: readonly HoldingRow[],
	midRate: number | null,
	now = Date.now(),
): RealizedData {
	const today = kstIso(now).slice(0, 10);
	const positions = new Map<string, Position>();
	const sells: Sell[] = [];
	const incompleteDates: string[] = [];
	const sorted = rows
		.filter(relevant)
		.slice()
		.sort(
			(a, b) =>
				Number(b.settled) - Number(a.settled) ||
				a.settlementDate.localeCompare(b.settlementDate) ||
				direction(a) - direction(b) ||
				(Date.parse(a.transactionTime ?? "") || 0) -
					(Date.parse(b.transactionTime ?? "") || 0),
		);
	for (const row of sorted) {
		const id = `${row.marketCountry}:${row.symbol}`;
		const holding = holdings.find(
			(item) => item.market === row.marketCountry && item.symbol === row.symbol,
		);
		const fallback =
			holding && Number.isFinite(holding.avgPrice) && holding.avgPrice > 0
				? holding.avgPrice
				: null;
		const position = positions.get(id) ?? {
			quantity: 0,
			cost: 0,
			estimated: false,
			unknown: false,
			lastSellCost: null,
		};
		positions.set(id, position);
		if (
			row.quantity === null ||
			(["BUY", "SELL"].includes(row.transactionType) && row.netAmount === null)
		) {
			incompleteDates.push(row.settled ? row.settlementDate : today);
			position.estimated = true;
			continue;
		}
		const quantity = Number(row.quantity);
		if (quantity <= 0) continue;
		const net = Number(row.netAmount);
		const reverse = row.isCancellation ? -1 : 1;
		if (
			row.transactionType === "BUY" ||
			row.transactionType === "SECURITIES_TRANSFER_IN"
		) {
			const transfer = row.transactionType === "SECURITIES_TRANSFER_IN";
			position.quantity += quantity * reverse;
			position.cost += (transfer ? quantity * (fallback ?? 0) : net) * reverse;
			if (transfer) {
				position.estimated = true;
				position.unknown ||= fallback === null;
			}
			if (position.quantity < QUANTITY_EPSILON) {
				position.quantity = 0;
				position.cost = 0;
				position.unknown = false;
				position.estimated = false;
			}
			continue;
		}
		const average =
			position.quantity > 0 ? position.cost / position.quantity : 0;
		const shortfall = quantity - position.quantity;
		const missing = shortfall > QUANTITY_EPSILON ? shortfall : 0;
		const cancellation = row.isCancellation && row.transactionType === "SELL";
		// Reversal uses the most recent sell's unit basis; this is an approximation
		// when several indistinguishable historical fills have the same amounts.
		const cost = cancellation
			? quantity * (position.lastSellCost ?? fallback ?? average)
			: Math.min(quantity, position.quantity) * average +
				missing * (fallback ?? 0);
		const unknown = cancellation
			? position.lastSellCost === null &&
				fallback === null &&
				position.quantity === 0
			: position.unknown || (missing > 0 && fallback === null);
		const estimated = position.estimated || missing > 0 || cancellation;
		if (row.transactionType === "SECURITIES_TRANSFER_OUT") {
			position.quantity = Math.max(0, position.quantity - quantity * reverse);
			position.cost = Math.max(0, position.cost - quantity * average * reverse);
			if (position.quantity < QUANTITY_EPSILON) {
				position.quantity = 0;
				position.cost = 0;
				position.unknown = false;
				position.estimated = false;
			}
			continue;
		}
		position.quantity = Math.max(0, position.quantity - quantity * reverse);
		position.cost = Math.max(0, position.cost - cost * reverse);
		if (!cancellation) position.lastSellCost = cost / quantity;
		if (position.quantity < QUANTITY_EPSILON) {
			position.quantity = 0;
			position.cost = 0;
			position.unknown = false;
			position.estimated = false;
		}
		const usd = row.currency === "USD";
		const fxEstimated = usd && row.exchangeRate === null;
		const conversion = usd
			? row.exchangeRate === null
				? midRate
				: Number(row.exchangeRate)
			: 1;
		const skip = unknown || conversion === null || conversion <= 0;
		const realized = skip ? 0 : (net - cost) * reverse;
		const realizedKrw = skip ? 0 : realized * (conversion ?? 0);
		sells.push({
			symbol: row.symbol,
			name: holding?.name ?? row.symbol,
			market: row.marketCountry as "KR" | "US",
			currency: row.currency as "KRW" | "USD",
			quantity: skip ? 0 : quantity * reverse,
			realized,
			realizedKrw,
			rate: cost ? (net - cost) / cost : 0,
			fxRate: usd && !fxEstimated ? conversion : null,
			fxEstimated,
			pending: !row.settled,
			lastSellDate: row.settled
				? row.transactionTime
					? kstIso(Date.parse(row.transactionTime)).slice(0, 10)
					: row.settlementDate
				: today,
			sellCount: skip ? 0 : reverse,
			pendingKrw: !row.settled ? realizedKrw : 0,
			cost: skip ? 0 : cost * (conversion ?? 0) * reverse,
			bucketDate: row.settled ? (row.settlementDate ?? today) : today,
			estimated: estimated || fxEstimated || skip,
		});
	}
	const summarize = (rows: Sell[]): RealizedTotal => {
		const profit = rows.reduce((sum, row) => sum + row.realizedKrw, 0);
		const cost = rows.reduce((sum, row) => sum + row.cost, 0);
		return {
			realizedKrw: round(profit),
			rate: cost ? profit / cost : 0,
			sellCount: rows.reduce((sum, row) => sum + row.sellCount, 0),
			pending: rows.some((row) => row.pending),
			pendingKrw: round(rows.reduce((sum, row) => sum + row.pendingKrw, 0)),
			byCcy: {
				KRW: round(
					rows
						.filter((row) => row.currency === "KRW")
						.reduce((sum, row) => sum + row.realized, 0),
				),
				USD: round(
					rows
						.filter((row) => row.currency === "USD")
						.reduce((sum, row) => sum + row.realized, 0),
				),
			},
			estimated: rows.some((row) => row.estimated),
		};
	};
	const data: RealizedData = {
		asOf: new Date(now).toISOString(),
		basis: "settlement",
		totals: {} as RealizedData["totals"],
		buckets: {} as RealizedData["buckets"],
		bySymbol: {} as RealizedData["bySymbol"],
	};
	for (const period of periods) {
		const current = periodStart(today, period);
		const selected = sells.filter(
			(row) => periodStart(row.bucketDate, period) === current,
		);
		data.totals[period] = summarize(selected);
		data.totals[period].estimated ||= incompleteDates.some(
			(date) => periodStart(date, period) === current,
		);
		const groups = new Map<string, Sell[]>();
		for (const row of selected.filter((row) => row.sellCount !== 0)) {
			const id = `${row.market}:${row.symbol}`;
			groups.set(id, [...(groups.get(id) ?? []), row]);
		}
		data.bySymbol[period] = [...groups.values()]
			.map((group) => {
				const first = group[0];
				const total = summarize(group);
				const fxRate = group.every((row) => row.fxRate === first.fxRate)
					? first.fxRate
					: null;
				return {
					symbol: first.symbol,
					name: first.name,
					market: first.market,
					currency: first.currency,
					quantity: round(group.reduce((sum, row) => sum + row.quantity, 0)),
					realized: total.byCcy[first.currency],
					realizedKrw: total.realizedKrw,
					rate: total.rate,
					fxRate,
					fxEstimated: group.some((row) => row.fxEstimated),
					estimated: total.estimated,
					pending: total.pending,
					lastSellDate:
						group
							.map((row) => row.lastSellDate)
							.sort()
							.at(-1) ?? today,
					sellCount: total.sellCount,
					pendingKrw: total.pendingKrw,
				};
			})
			.sort((a, b) => Math.abs(b.realizedKrw) - Math.abs(a.realizedKrw));
		const firstYear = Math.min(
			Number(today.slice(0, 4)),
			sells.reduce(
				(first, row) => Math.min(first, Number(row.bucketDate.slice(0, 4))),
				Number(today.slice(0, 4)),
			),
		);
		const count =
			period === "day"
				? 30
				: period === "year"
					? Number(today.slice(0, 4)) - firstYear + 1
					: 12;
		data.buckets[period] = Array.from({ length: count }, (_, i) => {
			const date = new Date(dayTime(current));
			const offset = count - i - 1;
			if (period === "day" || period === "week")
				date.setUTCDate(
					date.getUTCDate() - offset * (period === "week" ? 7 : 1),
				);
			if (period === "month") date.setUTCMonth(date.getUTCMonth() - offset);
			if (period === "year")
				date.setUTCFullYear(date.getUTCFullYear() - offset);
			const bucket = key(date.getTime());
			const total = summarize(
				sells.filter((row) => periodStart(row.bucketDate, period) === bucket),
			);
			return {
				key: bucket,
				label:
					period === "year"
						? bucket.slice(0, 4)
						: period === "month"
							? bucket.slice(0, 7)
							: `${date.getUTCMonth() + 1}/${date.getUTCDate()}${period === "week" ? " 주" : ""}`,
				realizedKrw: total.realizedKrw,
				rate: total.rate,
				estimated:
					total.estimated ||
					incompleteDates.some((date) => periodStart(date, period) === bucket),
			};
		});
	}
	return data;
}

export function realizedPayload(
	data: RealizedData | MaskedRealizedData,
	masked: boolean,
): RealizedData | MaskedRealizedData {
	const mapPeriods = <T extends Record<RealizedPeriod, unknown>, R>(
		values: T,
		map: (value: T[RealizedPeriod]) => R,
	): Record<RealizedPeriod, R> =>
		Object.fromEntries(
			periods.map((period) => [period, map(values[period])]),
		) as Record<RealizedPeriod, R>;
	return {
		asOf: data.asOf,
		basis: data.basis,
		masked,
		totals: mapPeriods(data.totals, (row) => ({
			rate: row.rate,
			sellCount: row.sellCount,
			pending: row.pending,
			estimated: row.estimated,
			realizedKrw: masked ? null : row.realizedKrw,
			pendingKrw: masked ? null : row.pendingKrw,
			byCcy: masked ? null : row.byCcy,
		})),
		buckets: mapPeriods(data.buckets, (rows) =>
			rows.map(({ key, label, rate, estimated, realizedKrw }) => ({
				key,
				label,
				rate,
				estimated,
				realizedKrw: masked ? null : realizedKrw,
			})),
		),
		bySymbol: mapPeriods(data.bySymbol, (rows) =>
			rows.map((row) => ({
				symbol: row.symbol,
				name: row.name,
				market: row.market,
				currency: row.currency,
				rate: row.rate,
				fxRate: row.fxRate,
				fxEstimated: row.fxEstimated,
				estimated: row.estimated,
				pending: row.pending,
				lastSellDate: row.lastSellDate,
				sellCount: row.sellCount,
				quantity: masked ? null : row.quantity,
				realized: masked ? null : row.realized,
				realizedKrw: masked ? null : row.realizedKrw,
				pendingKrw: masked ? null : row.pendingKrw,
			})),
		),
	} as RealizedData | MaskedRealizedData;
}

export function maskRealized(data: RealizedData): MaskedRealizedData {
	return realizedPayload(data, true) as MaskedRealizedData;
}
