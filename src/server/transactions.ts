import { record } from "./parse";
import { redact } from "./redact";

export interface RawTransaction {
	transactionType: string;
	marketCountry: string;
	currency: string;
	symbol: string | null;
	assetClass: string | null;
	quantity: string | null;
	filledPrice: string | null;
	amount: string | null;
	commission: string;
	tax: string;
	netAmount: string | null;
	exchangeRate: string | null;
	settlementDate: string;
	settled: boolean;
	transactionTime: string | null;
	isCancellation: boolean;
}
export interface TransactionQuery {
	from?: string;
	to?: string;
	cursor?: string;
	limit?: number;
}
export interface TransactionPage {
	transactions: RawTransaction[];
	nextCursor: string | null;
	hasNext: boolean;
}

const date = (value: unknown): value is string =>
	typeof value === "string" &&
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const decimal = (value: unknown): value is string =>
	typeof value === "string" &&
	/^\d+(?:\.\d+)?$/.test(value) &&
	Number.isFinite(Number(value));
export function parseTransaction(value: unknown): RawTransaction {
	const row = record(value);
	const fail = () => {
		throw new Error("Invalid transaction data");
	};
	for (const key of ["transactionType", "marketCountry", "currency"])
		if (typeof row[key] !== "string" || !row[key]) fail();
	for (const key of ["symbol", "assetClass"])
		if (row[key] !== null && (typeof row[key] !== "string" || !row[key]))
			fail();
	for (const key of ["commission", "tax"]) if (!decimal(row[key])) fail();
	for (const key of [
		"quantity",
		"filledPrice",
		"amount",
		"netAmount",
		"exchangeRate",
	])
		if (row[key] !== null && !decimal(row[key])) fail();
	if (
		typeof row.settled !== "boolean" ||
		typeof row.isCancellation !== "boolean"
	)
		fail();
	if (!date(row.settlementDate)) fail();
	if (
		row.transactionTime !== null &&
		(typeof row.transactionTime !== "string" ||
			!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
				row.transactionTime,
			) ||
			!Number.isFinite(Date.parse(row.transactionTime)))
	)
		fail();
	// Whitelist fields: never retain unrecognized metadata from the response.
	return Object.fromEntries(
		[
			"transactionType",
			"marketCountry",
			"currency",
			"symbol",
			"assetClass",
			"quantity",
			"filledPrice",
			"amount",
			"commission",
			"tax",
			"netAmount",
			"exchangeRate",
			"settlementDate",
			"settled",
			"transactionTime",
			"isCancellation",
		].map((key) => [key, row[key]]),
	) as unknown as RawTransaction;
}
export function parseTransactionPage(
	value: unknown,
	warn: (message: string) => void = console.warn,
): TransactionPage {
	const row = record(value);
	if (
		!Array.isArray(row.transactions) ||
		typeof row.hasNext !== "boolean" ||
		!(
			row.nextCursor === null ||
			(typeof row.nextCursor === "string" && row.nextCursor.length > 0)
		) ||
		(row.hasNext && !row.nextCursor)
	)
		throw new Error("Invalid transactions page");
	const transactions: RawTransaction[] = [];
	let dropped = 0;
	for (const value of row.transactions) {
		try {
			transactions.push(parseTransaction(value));
		} catch {
			dropped++;
		}
	}
	if (dropped)
		warn(redact(`Transactions page: ${dropped} malformed rows skipped`));
	return {
		transactions,
		nextCursor: row.nextCursor as string | null,
		hasNext: row.hasNext,
	};
}
export function transactionQuery(
	options: TransactionQuery,
): Record<string, string> {
	if (
		(options.from !== undefined && !date(options.from)) ||
		(options.to !== undefined && !date(options.to))
	)
		throw new Error("Invalid transaction dates");
	if (
		options.limit !== undefined &&
		(!Number.isInteger(options.limit) ||
			options.limit < 1 ||
			options.limit > 100)
	)
		throw new Error("Invalid transaction limit");
	return Object.fromEntries(
		Object.entries(options)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => [key, String(value)]),
	);
}
