import { open, readFile } from "node:fs/promises";
import { kstIso, ratio } from "../lib/compute";
import type { ByCcy, RawPortfolio, TrendPoint } from "../lib/types";
import type { Config, Now } from "./config";
import { withFileLock } from "./fileLock";
import { log } from "./redact";

// Decimal fractions keep ledger rounding independent of binary floating point.
type Decimal = { n: bigint; d: bigint };
function decimal(value: string | null): Decimal {
	const text = value ?? "0";
	if (!/^-?\d+(?:\.\d+)?$/.test(text))
		throw new Error("Invalid ledger decimal");
	const places = text.split(".")[1]?.length ?? 0;
	return { n: BigInt(text.replace(".", "")), d: 10n ** BigInt(places) };
}
const add = (a: Decimal, b: Decimal): Decimal => ({
	n: a.n * b.d + b.n * a.d,
	d: a.d * b.d,
});
const multiply = (a: Decimal, b: Decimal): Decimal => ({
	n: a.n * b.n,
	d: a.d * b.d,
});
function rounded(value: Decimal, places = 0): string {
	const sign = value.n < 0n ? "-" : "";
	const scaled = (value.n < 0n ? -value.n : value.n) * 10n ** BigInt(places);
	const units =
		scaled / value.d + ((scaled % value.d) * 2n >= value.d ? 1n : 0n);
	const digits = units.toString().padStart(places + 1, "0");
	return `${units === 0n ? "" : sign}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
}

export function createSnapshot(raw: RawPortfolio, now = Date.now()) {
	const { holdings, krw, usd, fx } = raw;
	if (!holdings || !krw || !usd || !fx)
		throw new Error("Snapshot requires successful holdings, cash and FX data");
	const mid = decimal(fx.midRate);
	const convert = (value: ByCcy) =>
		add(decimal(value.krw), multiply(decimal(value.usd), mid));
	const byCcy = (value: ByCcy) => ({ KRW: value.krw, USD: value.usd ?? "0" });
	const cashTotal = add(
		decimal(krw.cashBuyingPower),
		multiply(decimal(usd.cashBuyingPower), mid),
	);
	const stocksTotal = convert(holdings.marketValue.amount);
	const total = add(stocksTotal, cashTotal);
	const ts = kstIso(now);
	return {
		date: ts.slice(0, 10),
		ts,
		source: "toss-dashboard",
		fx: {
			pair: "USD/KRW",
			midRate: fx.midRate,
			buyRate: fx.rate,
			validFrom: fx.validFrom,
			usedForKRW: "midRate",
		},
		cash: {
			KRW: krw.cashBuyingPower,
			USD: usd.cashBuyingPower,
			basis: "cashBuyingPower",
			totalKRW: rounded(cashTotal),
		},
		totals: {
			stocksEvalKRW: rounded(stocksTotal),
			stocksEvalByCcy: byCcy(holdings.marketValue.amount),
			purchaseByCcy: byCcy(holdings.totalPurchaseAmount),
			profitLossByCcy: byCcy(holdings.profitLoss.amount),
			plRateApi: holdings.profitLoss.rate,
			dailyPLByCcy: byCcy(holdings.dailyProfitLoss.amount),
			dailyPLRateApi: holdings.dailyProfitLoss.rate,
			purchaseKRW: rounded(convert(holdings.totalPurchaseAmount)),
			profitLossKRW: rounded(convert(holdings.profitLoss.amount)),
			totalAssetsKRW: rounded(total),
		},
		holdings: holdings.items.map((item) => {
			const evalKrw = multiply(
				decimal(item.marketValue.amount),
				item.currency === "USD" ? mid : decimal("1"),
			);
			const weight =
				total.n === 0n
					? decimal("0")
					: { n: evalKrw.n * total.d, d: evalKrw.d * total.n };
			return {
				symbol: item.symbol,
				name: item.name,
				market: item.marketCountry,
				currency: item.currency,
				quantity: item.quantity,
				avgPrice: item.averagePurchasePrice,
				lastPrice: item.lastPrice,
				purchaseAmount: item.marketValue.purchaseAmount,
				evalAmount: item.marketValue.amount,
				evalAfterCost: item.marketValue.amountAfterCost,
				profitLoss: item.profitLoss.amount,
				returnRate: item.profitLoss.rate,
				dailyPL: item.dailyProfitLoss.amount,
				evalKRW: rounded(evalKrw),
				weight: rounded(weight, 2),
			};
		}),
	};
}
export type LedgerSnapshot = ReturnType<typeof createSnapshot>;

export function parseTrend(
	source: string,
	warn: (message: string) => void = log.warn,
): TrendPoint[] {
	const points = new Map<string, TrendPoint>();
	let skipped = 0;
	for (const line of source.split("\n")) {
		if (!line.trim()) continue;
		try {
			const value = JSON.parse(line);
			if (
				typeof value.date !== "string" ||
				!/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
				typeof value.ts !== "string" ||
				!Number.isFinite(Date.parse(value.ts))
			)
				throw new Error();
			const totals = value.totals;
			const readNumber = (key: string) => {
				if (
					typeof totals?.[key] !== "string" ||
					!/^-?\d+(?:\.\d+)?$/.test(totals[key])
				)
					throw new Error();
				const number = Number(totals[key]);
				if (!Number.isFinite(number)) throw new Error();
				return number;
			};
			const purchaseKrw = readNumber("purchaseKRW");
			const profitLossKrw = readNumber("profitLossKRW");
			const stocksEvalKrw = Object.hasOwn(totals, "stocksEvalKRW")
				? readNumber("stocksEvalKRW")
				: purchaseKrw + profitLossKrw;
			if (!Number.isFinite(stocksEvalKrw)) throw new Error();
			const point: TrendPoint = {
				date: value.date,
				ts: value.ts,
				purchaseKrw,
				profitLossKrw,
				stocksEvalKrw,
				totalAssetsKrw: readNumber("totalAssetsKRW"),
				returnRate: ratio(profitLossKrw, purchaseKrw),
			};
			const previous = points.get(point.date);
			if (!previous || Date.parse(point.ts) > Date.parse(previous.ts))
				points.set(point.date, point);
		} catch {
			skipped++;
		}
	}
	if (skipped) warn(`Ledger: skipped ${skipped} invalid lines`);
	return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function createLedger(options: {
	config: Config;
	now?: Now;
	warn?: (message: string) => void;
}) {
	const { config } = options;
	async function read(): Promise<string> {
		try {
			return await readFile(config.ledgerPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
			throw new Error("Cannot read PORTFOLIO_LEDGER_PATH");
		}
	}
	return {
		async readTrend(): Promise<TrendPoint[]> {
			if (config.mock) return [];
			return parseTrend(await read(), options.warn);
		},
		async appendSnapshot(raw: RawPortfolio): Promise<boolean> {
			if (config.mock || !config.snapshotEnabled) return false;
			const now = (options.now ?? Date.now)();
			if (kstIso(now).slice(11, 16) < config.snapshotTimeKst) return false;
			const snapshot = createSnapshot(raw, now);
			return withFileLock(`${config.ledgerPath}.lock`, async () => {
				const existing = await read();
				for (const line of existing.split("\n")) {
					try {
						if (JSON.parse(line).date === snapshot.date) return false;
					} catch {
						/* Preserve malformed rows byte-for-byte. */
					}
				}
				const separator = existing && !existing.endsWith("\n") ? "\n" : "";
				const bytes = Buffer.from(`${separator}${JSON.stringify(snapshot)}\n`);
				try {
					const file = await open(config.ledgerPath, "a", 0o600);
					try {
						const { bytesWritten } = await file.write(bytes);
						if (bytesWritten !== bytes.length)
							throw new Error("Incomplete ledger append");
						await file.sync();
					} finally {
						await file.close();
					}
				} catch {
					throw new Error("Cannot append PORTFOLIO_LEDGER_PATH snapshot");
				}
				return true;
			});
		},
	};
}
