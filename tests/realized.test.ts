import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { buildState } from "../src/lib/compute";
import { readConfig } from "../src/server/config";
import { ALLOWED_ENDPOINTS } from "../src/server/endpoints";
import { createProxy } from "../src/server/proxy";
import {
	computeRealized,
	createTransactionsCache,
	fetchTransactions,
	maskRealized,
	periodStart,
} from "../src/server/realized";
import { createTossClient } from "../src/server/tossClient";
import {
	parseTransaction,
	parseTransactionPage,
	type RawTransaction,
	type TransactionQuery,
} from "../src/server/transactions";
import { rawFixture } from "./fixtures";

const now = Date.parse("2026-11-02T00:10:00+09:00");
const holdings = buildState(rawFixture()).holdings;
function transaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
	return {
		transactionType: "BUY",
		marketCountry: "KR",
		currency: "KRW",
		symbol: "FAKEKR",
		assetClass: "STOCK",
		quantity: "10",
		filledPrice: "10",
		amount: "100",
		commission: "0",
		tax: "0",
		netAmount: "100",
		exchangeRate: null,
		settlementDate: "2026-11-02",
		settled: true,
		transactionTime: "2026-11-02T00:01:00+09:00",
		isCancellation: false,
		...overrides,
	};
}
const sell = (values: Partial<RawTransaction> = {}) =>
	transaction({
		transactionType: "SELL",
		quantity: "4",
		netAmount: "100",
		transactionTime: "2026-11-02T00:05:00+09:00",
		...values,
	});
it("replays multiple buys and partial sells using fee-inclusive moving average", () => {
	const rows = [
		transaction(),
		transaction({
			quantity: "10",
			netAmount: "200",
			transactionTime: "2026-11-02T00:02:00+09:00",
		}),
		sell(),
	];
	const result = computeRealized(rows, [], 1300, now);
	expect(result.totals.day).toMatchObject({
		realizedKrw: 40,
		rate: 40 / 60,
		sellCount: 1,
		estimated: false,
	});
	expect(result.bySymbol.day[0]).toMatchObject({ quantity: 4, realized: 40 });
	expect(JSON.stringify(result)).not.toContain("costKrw");
	expect(
		computeRealized(
			[
				...rows,
				sell({
					quantity: "2",
					netAmount: "50",
					transactionTime: "2026-11-02T00:06:00+09:00",
				}),
			],
			[],
			1300,
			now,
		).totals.day.realizedKrw,
	).toBe(60);
});
it("reverses BUY amounts and SELL realized basis for domestic cancellation records", () => {
	const rows = [
		transaction(),
		transaction({
			quantity: "5",
			netAmount: "100",
			transactionTime: "2026-11-02T00:02:00+09:00",
		}),
		transaction({
			quantity: "5",
			netAmount: "100",
			isCancellation: true,
			transactionTime: "2026-11-02T00:03:00+09:00",
		}),
		sell(),
	];
	expect(computeRealized(rows, [], 1300, now).totals.day.realizedKrw).toBe(60);
	const reversed = computeRealized(
		[
			...rows,
			sell({
				isCancellation: true,
				transactionTime: "2026-11-02T00:06:00+09:00",
			}),
		],
		[],
		1300,
		now,
	);
	expect(reversed.totals.day).toMatchObject({
		realizedKrw: 0,
		sellCount: 0,
		estimated: true,
	});
});
it("uses holdings average for transfers and history gaps, flags estimates, and skips unknown basis", () => {
	const incoming = transaction({
		transactionType: "SECURITIES_TRANSFER_IN",
		quantity: "2",
	});
	const result = computeRealized(
		[incoming, sell({ quantity: "1", netAmount: "10000" })],
		holdings,
		1300,
		now,
	);
	expect(result.totals.day).toMatchObject({
		realizedKrw: 1000,
		estimated: true,
	});
	expect(result.bySymbol.day[0].estimated).toBe(true);
	expect(
		computeRealized(
			[sell({ quantity: "1", netAmount: "10000" })],
			holdings,
			1300,
			now,
		).totals.day.realizedKrw,
	).toBe(1000);
	expect(
		computeRealized([incoming, sell()], [], 1300, now).totals.day,
	).toMatchObject({ realizedKrw: 0, estimated: true, sellCount: 0 });
	const outgoing = transaction({
		transactionType: "SECURITIES_TRANSFER_OUT",
		quantity: "5",
		transactionTime: "2026-11-02T00:03:00+09:00",
	});
	expect(
		computeRealized([transaction(), outgoing, sell()], [], 1300, now).totals.day
			.realizedKrw,
	).toBe(60);
});
it("buckets settlement in KST across Monday and month boundaries and displays KST sell dates", () => {
	expect(periodStart("2026-11-01", "week")).toBe("2026-10-26");
	expect(periodStart("2026-11-02", "week")).toBe("2026-11-02");
	const rows = [
		transaction({
			settlementDate: "2026-10-30",
			transactionTime: "2026-10-30T01:00:00+09:00",
		}),
		sell({
			settlementDate: "2026-11-01",
			transactionTime: "2026-10-31T15:01:00Z",
		}),
	];
	const result = computeRealized(rows, [], 1300, now);
	expect(result.totals.day.sellCount).toBe(0);
	expect(result.totals.week.sellCount).toBe(0);
	expect(result.totals.month.sellCount).toBe(1);
	expect(result.bySymbol.month[0].lastSellDate).toBe("2026-11-01");
	expect(
		result.buckets.day.find((row) => row.key === "2026-11-01")?.realizedKrw,
	).toBe(60);
	expect(result.buckets.month.at(-2)?.realizedKrw).toBe(0);
	expect(result.buckets.week.at(-2)?.realizedKrw).toBe(60);
	expect(result.buckets.year).toHaveLength(1);
});
it("converts USD at sell FX, uses mid FX for pending rows, and buckets pending today", () => {
	const usd = { symbol: "FAKEUS", marketCountry: "US", currency: "USD" };
	const buy = transaction({ ...usd, settlementDate: "2026-10-30" });
	const settled = sell({ ...usd, exchangeRate: "1400" });
	expect(
		computeRealized([buy, settled], [], 1300, now).totals.day,
	).toMatchObject({ realizedKrw: 84000, rate: 1.5, estimated: false });
	const pending = sell({
		...usd,
		settled: false,
		filledPrice: null,
		settlementDate: "2026-11-03",
		transactionTime: null,
		exchangeRate: null,
	});
	const result = computeRealized([pending, buy], [], 1300, now);
	expect(result.totals.day).toMatchObject({
		realizedKrw: 78000,
		pendingKrw: 78000,
		rate: 1.5,
		estimated: true,
		pending: true,
	});
	expect(result.bySymbol.day[0]).toMatchObject({
		fxEstimated: true,
		fxRate: null,
		lastSellDate: "2026-11-02",
		pending: true,
	});
	expect(result.buckets.day.at(-1)?.realizedKrw).toBe(78000);
	expect(
		computeRealized([buy, pending], [], null, now).totals.day,
	).toMatchObject({ estimated: true, sellCount: 0 });
});
it("masks all amounts across totals, buckets and symbols while retaining rates, counts and flags", () => {
	const full = computeRealized([transaction(), sell()], [], 1300, now);
	const masked = maskRealized(full);
	for (const period of ["day", "week", "month", "year"] as const) {
		expect(masked.totals[period]).toMatchObject({
			realizedKrw: null,
			pendingKrw: null,
			byCcy: null,
			rate: full.totals[period].rate,
		});
		for (const row of masked.bySymbol[period])
			expect(row).toMatchObject({
				quantity: null,
				realized: null,
				realizedKrw: null,
				pendingKrw: null,
			});
		for (const row of masked.buckets[period])
			expect(row.realizedKrw).toBeNull();
	}
});
it("fetches pages with limit 100, opaque cursors and at least 250ms spacing through the client", async () => {
	let time = now;
	const starts: number[] = [];
	const request = vi.fn<typeof fetch>(async () => {
		starts.push(time);
		time += 30;
		return Response.json({
			result: {
				transactions: [transaction()],
				nextCursor: starts.length === 1 ? "FAKE +/cursor" : null,
				hasNext: starts.length === 1,
			},
		});
	});
	const client = createTossClient({
		tokens: { getToken: async () => "FAKE_TEST_ONLY" },
		fetch: request,
	});
	const wait = vi.fn(async (ms: number) => {
		time += ms;
	});
	expect(
		await fetchTransactions((query) => client.getTransactions(42, query), {
			now: () => time,
			sleep: wait,
		}),
	).toHaveLength(2);
	expect(starts[1] - starts[0]).toBe(250);
	expect(wait).toHaveBeenCalledWith(220);
	for (const [input, init] of request.mock.calls) {
		const url = new URL(String(input));
		expect(url.pathname).toBe(ALLOWED_ENDPOINTS.transactions);
		expect(url.searchParams.get("limit")).toBe("100");
		expect(url.searchParams.get("transactionTypes")).toBe(
			"BUY,SELL,SECURITIES_TRANSFER_IN,SECURITIES_TRANSFER_OUT",
		);
		expect(url.searchParams.has("from")).toBe(false);
		expect(init?.method).toBe("GET");
		expect(new Headers(init?.headers).has("X-Tossinvest-Account")).toBe(true);
	}
	expect(
		new URL(String(request.mock.calls[1][0])).searchParams.get("cursor"),
	).toBe("FAKE +/cursor");
	await expect(
		fetchTransactions(
			async () => ({ transactions: [], nextCursor: "FAKE", hasNext: true }),
			{ sleep: async () => {}, maxPages: 2 },
		),
	).rejects.toThrow();
});
it("strictly parses decimal strings, flags and dates, whitelists fields and tolerates unknown enums", () => {
	expect(
		parseTransaction({
			...transaction(),
			transactionType: "FUTURE_TYPE",
			assetClass: "FUTURE_ASSET",
			extra: "FAKE",
		}),
	).not.toHaveProperty("extra");
	for (const patch of [
		{ quantity: 1 },
		{ amount: "NaN" },
		{ settled: 1 },
		{ filledPrice: undefined },
		{ exchangeRate: "-1" },
		{ settlementDate: "2026-02-30" },
		{ settlementDate: null },
		{ transactionTime: "bad" },
		{ commission: null },
		{ tax: "" },
		{ isCancellation: "true" },
	])
		expect(() => parseTransaction({ ...transaction(), ...patch })).toThrow();
	expect(() =>
		parseTransactionPage({ transactions: [], hasNext: true, nextCursor: null }),
	).toThrow();
	expect(
		computeRealized(
			[
				transaction({ transactionType: "FUTURE_TYPE" }),
				sell({ assetClass: "BOND" }),
			],
			[],
			1300,
			now,
		).totals.day.sellCount,
	).toBe(0);
});
it("atomically caches settled rows with mode 0600, replaces the window idempotently, coalesces and retains last good on failure", async () => {
	const directory = await mkdtemp(join(tmpdir(), "fake-transactions-"));
	const path = join(directory, "transactions.jsonl");
	let time = now;
	const older = transaction({ settlementDate: "2026-10-01" });
	const recent = transaction();
	const pending = sell({
		settled: false,
		settlementDate: "2026-11-03",
		transactionTime: null,
		filledPrice: null,
	});
	const queries: TransactionQuery[] = [];
	const fetchPage = vi.fn(async (query: TransactionQuery) => {
		queries.push(query);
		return {
			transactions:
				queries.length === 1 ? [older, recent, sell(), pending] : [recent],
			hasNext: false,
			nextCursor: null,
		};
	});
	const warn = vi.fn();
	const cache = createTransactionsCache({
		path,
		fetchPage,
		now: () => time,
		warn,
	});
	try {
		const results = await Promise.all([
			cache.read(),
			cache.read(),
			cache.read(),
		]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(results[0]).toHaveLength(4);
		expect(queries[0]).toEqual({ limit: 100 });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(3);
		expect(await cache.read()).toHaveLength(4);
		time += 300_000;
		expect(await cache.read()).toEqual([older, recent]);
		expect(queries[1]).toEqual({ from: "2026-10-23", limit: 100 });
		const bytes = await readFile(path, "utf8");
		time += 300_000;
		await cache.read();
		expect(await readFile(path, "utf8")).toBe(bytes);
		fetchPage.mockRejectedValue(new Error("FAKE_FAILURE"));
		time += 300_000;
		expect(await cache.read()).toEqual([older, recent]);
		const calls = fetchPage.mock.calls.length;
		await cache.read();
		expect(fetchPage).toHaveBeenCalledTimes(calls);
		await writeFile(path, `${bytes}malformed\n`);
		const restored = createTransactionsCache({
			path,
			fetchPage,
			now: () => time,
			warn,
		});
		expect(await restored.read()).toEqual([older, recent]);
		expect(warn).toHaveBeenCalledWith(
			"Transactions cache: malformed row skipped",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("resolves transaction cache beside the ledger with an optional override", () => {
	expect(
		readConfig({ PORTFOLIO_LEDGER_PATH: "/tmp/fake/history.jsonl" })
			.transactionsPath,
	).toBe("/tmp/fake/transactions.jsonl");
	expect(
		readConfig({ TRANSACTIONS_CACHE_PATH: "~/fake/tx.jsonl" }, "/tmp/FAKE_HOME")
			.transactionsPath,
	).toBe("/tmp/FAKE_HOME/fake/tx.jsonl");
});
it("forwards the masked query to proxy upstream, strips ignored amounts, and hides unsupported results", async () => {
	const full = computeRealized([transaction(), sell()], [], 1300, now);
	const request = vi.fn<typeof fetch>(async () => Response.json(full));
	const proxy = createProxy({
		upstream: new URL("https://fake-upstream.invalid"),
		fetch: request,
	});
	expect(await proxy.getRealized(true)).toEqual(maskRealized(full));
	expect(String(request.mock.calls[0][0])).toBe(
		"https://fake-upstream.invalid/api/realized?masked=1",
	);
	const withInternal = {
		...full,
		totals: { ...full.totals, day: { ...full.totals.day, costKrw: 40 } },
	};
	request.mockResolvedValue(Response.json(withInternal));
	expect(JSON.stringify(await proxy.getRealized(false))).not.toContain(
		"costKrw",
	);
	request.mockResolvedValue(
		Response.json({
			basis: "settlement",
			totals: {},
			buckets: {},
			bySymbol: {},
		}),
	);
	expect(await proxy.getRealized(false)).toBeNull();
	request.mockResolvedValue(new Response(null, { status: 404 }));
	expect(await proxy.getRealized(false)).toBeNull();
});

it("rounds fractional moving-average amounts only after aggregation", () => {
	const rows = [
		transaction({ quantity: "3", netAmount: "1" }),
		sell({ quantity: "1", netAmount: "1" }),
		sell({
			quantity: "1",
			netAmount: "1",
			transactionTime: "2026-11-02T00:06:00+09:00",
		}),
	];
	const result = computeRealized(rows, [], 1300, now);
	expect(result.totals.day.realizedKrw).toBe(1.33333333);
	expect(result.bySymbol.day[0].realized).toBe(1.33333333);
	expect(result.totals.day.rate).toBeCloseTo(2);
});
it("clears unknown transfer basis after a full transfer out before new buys", () => {
	const rows = [
		transaction({
			transactionType: "SECURITIES_TRANSFER_IN",
			settlementDate: "2026-10-30",
		}),
		transaction({
			transactionType: "SECURITIES_TRANSFER_OUT",
			settlementDate: "2026-10-31",
			transactionTime: "2026-11-02T00:02:00+09:00",
		}),
		transaction({ transactionTime: "2026-11-02T00:03:00+09:00" }),
		sell(),
	];
	expect(computeRealized(rows, [], 1300, now).totals.day).toMatchObject({
		realizedKrw: 60,
		estimated: false,
		sellCount: 1,
	});
});

it("preserves nullable transfers, bonds, cash and unknown enums while dropping only malformed page rows", () => {
	const incoming = transaction({
		transactionType: "SECURITIES_TRANSFER_IN",
		quantity: "2",
		filledPrice: null,
		amount: null,
		netAmount: null,
	});
	const outgoing = transaction({
		...incoming,
		transactionType: "SECURITIES_TRANSFER_OUT",
		quantity: "1",
	});
	const bond = transaction({ symbol: null, assetClass: "BOND" });
	const cash = transaction({
		symbol: null,
		assetClass: null,
		quantity: null,
		filledPrice: null,
		amount: null,
		netAmount: null,
		exchangeRate: null,
		transactionTime: null,
		settled: false,
	});
	const unknown = transaction({
		transactionType: "FUTURE_TYPE",
		assetClass: "FUTURE_ASSET",
	});
	const valid = [
		transaction(),
		sell(),
		incoming,
		outgoing,
		bond,
		cash,
		unknown,
	];
	const warn = vi.fn();
	const page = parseTransactionPage(
		{
			transactions: [
				...valid,
				{ ...transaction(), quantity: "bad", extra: "PRIVATE_ROW_CONTENT" },
				null,
			],
			hasNext: true,
			nextCursor: "FAKE_CURSOR",
		},
		warn,
	);
	expect(page).toEqual({
		transactions: valid,
		hasNext: true,
		nextCursor: "FAKE_CURSOR",
	});
	expect(warn.mock.calls).toEqual([
		["Transactions page: 2 malformed rows skipped"],
	]);
	expect(
		computeRealized(page.transactions, holdings, 1300, now).totals.day,
	).toMatchObject({
		realizedKrw: -5933.33333333,
		sellCount: 1,
		estimated: true,
	});
});
it("skips BUY/SELL with null quantity or net amount and marks only affected periods estimated", () => {
	for (const transactionType of ["BUY", "SELL"]) {
		for (const patch of [{ quantity: null }, { netAmount: null }]) {
			const result = computeRealized(
				[
					transaction(),
					sell(),
					transaction({
						transactionType,
						...patch,
						symbol: "FAKE_OTHER",
						settlementDate: "2026-10-30",
					}),
				],
				[],
				1300,
				now,
			);
			expect(result.totals.day).toMatchObject({
				realizedKrw: 60,
				sellCount: 1,
				estimated: false,
			});
			expect(result.totals.year.estimated).toBe(true);
			expect(
				result.buckets.day.find((row) => row.key === "2026-10-30")?.estimated,
			).toBe(true);
		}
	}
});
it("applies same-day buys and transfer-ins before sells and transfer-outs regardless of processing time", () => {
	const buy = transaction({ transactionTime: "2026-11-02T00:09:00+09:00" });
	const sale = sell({ transactionTime: "2026-11-02T00:01:00+09:00" });
	for (const rows of [
		[sale, buy],
		[buy, sale],
	]) {
		expect(computeRealized(rows, [], 1300, now).totals.day).toMatchObject({
			realizedKrw: 60,
			estimated: false,
		});
	}
	const outgoing = transaction({
		transactionType: "SECURITIES_TRANSFER_OUT",
		quantity: "5",
		amount: null,
		netAmount: null,
		transactionTime: "2026-11-02T00:00:00+09:00",
	});
	expect(
		computeRealized([sale, outgoing, buy], [], 1300, now).totals.day,
	).toMatchObject({
		realizedKrw: 60,
		estimated: false,
	});
	const transfer = transaction({
		transactionType: "SECURITIES_TRANSFER_IN",
		amount: null,
		netAmount: null,
		transactionTime: "2026-11-02T00:09:00+09:00",
	});
	expect(
		computeRealized([sale, transfer], holdings, 1300, now).totals.day,
	).toMatchObject({
		realizedKrw: -35900,
		sellCount: 1,
		estimated: true,
	});
});
it("clears fractional US positions and ignores sub-epsilon shortages on full sells", () => {
	const usd = {
		symbol: "FAKEUS",
		marketCountry: "US",
		currency: "USD",
		exchangeRate: "1300",
	};
	for (const [buys, sales] of [
		[["0.1", "0.2"], ["0.3"]],
		[["0.3"], ["0.1", "0.2"]],
	]) {
		const rows = [
			...buys.map((quantity) =>
				transaction({
					...usd,
					quantity,
					netAmount: String(Number(quantity) * 10),
				}),
			),
			...sales.map((quantity) =>
				sell({ ...usd, quantity, netAmount: String(Number(quantity) * 20) }),
			),
			transaction({
				...usd,
				quantity: "1",
				netAmount: "100",
				settlementDate: "2026-11-03",
			}),
			sell({
				...usd,
				quantity: "1",
				netAmount: "120",
				settlementDate: "2026-11-03",
			}),
		];
		const result = computeRealized(
			rows,
			[],
			1300,
			Date.parse("2026-11-03T12:00:00+09:00"),
		);
		expect(result.totals.day).toMatchObject({
			realizedKrw: 26000,
			estimated: false,
		});
		expect(result.totals.month).toMatchObject({
			realizedKrw: 29900,
			estimated: false,
		});
	}
});
