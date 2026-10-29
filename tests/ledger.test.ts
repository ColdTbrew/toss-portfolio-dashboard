import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLedger, createSnapshot, parseTrend } from "../src/server/ledger";
import { fixtureConfig, ledgerFixture, NOW, rawFixture } from "./fixtures";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "toss-fake-ledger-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("ledger", () => {
	it("parses the full fake schema, skips corrupt rows, chooses the latest timestamp and warns only with a count", () => {
		const later = {
			...ledgerFixture,
			ts: "2026-10-28T18:00:00+09:00",
			totals: { ...ledgerFixture.totals, profitLossKRW: "27000" },
		};
		const warning = vi.fn();
		const points = parseTrend(
			[
				JSON.stringify(later),
				"FAKE_BROKEN_CONTENT",
				JSON.stringify(ledgerFixture),
				"{}",
			].join("\n"),
			warning,
		);
		expect(points).toEqual([
			{
				date: "2026-10-28",
				ts: later.ts,
				totalAssetsKrw: 168000,
				stocksEvalKrw: 150000,
				purchaseKrw: 135000,
				profitLossKrw: 27000,
				returnRate: 0.2,
			},
		]);
		expect(warning).toHaveBeenCalledExactlyOnceWith(
			"Ledger: skipped 2 invalid lines",
		);
	});
	it("falls back to purchase plus profit/loss only when stock evaluation is absent", () => {
		const { stocksEvalKRW: _stocks, ...totals } = ledgerFixture.totals;
		const warning = vi.fn();
		const points = parseTrend(
			JSON.stringify({ ...ledgerFixture, totals }),
			warning,
		);
		expect(points).toHaveLength(1);
		expect(points[0].stocksEvalKrw).toBe(
			Number(totals.purchaseKRW) + Number(totals.profitLossKRW),
		);
		expect(warning).not.toHaveBeenCalled();
	});
	it.each([
		null,
		"",
		"not-a-number",
		"NaN",
		"Infinity",
		{},
		true,
	])("skips a row with present but invalid stock evaluation (%j)", (stocksEvalKRW) => {
		const warning = vi.fn();
		expect(
			parseTrend(
				JSON.stringify({
					...ledgerFixture,
					totals: { ...ledgerFixture.totals, stocksEvalKRW },
				}),
				warning,
			),
		).toEqual([]);
		expect(warning).toHaveBeenCalledExactlyOnceWith(
			"Ledger: skipped 1 invalid lines",
		);
	});
	it("preserves an explicit zero evaluation", () => {
		expect(
			parseTrend(
				JSON.stringify({
					...ledgerFixture,
					totals: { ...ledgerFixture.totals, stocksEvalKRW: "0" },
				}),
			)[0].stocksEvalKrw,
		).toBe(0);
	});
	it("matches the complete schema and preserves raw decimal strings", () => {
		const snapshot = createSnapshot(rawFixture(), NOW);
		expect(snapshot).toEqual({
			...ledgerFixture,
			date: "2026-10-29",
			ts: "2026-10-29T16:11:00.000+09:00",
			source: "toss-dashboard",
			fx: { ...ledgerFixture.fx, validFrom: "2026-10-29T16:10:00+09:00" },
		});
	});
	it("uses exact ROUND_HALF_UP for both signs and weights", () => {
		const raw = rawFixture();
		if (!raw.holdings || !raw.fx || !raw.krw || !raw.usd) throw new Error();
		raw.fx.midRate = "1";
		raw.holdings.marketValue.amount = { krw: "1.005", usd: "0" };
		raw.holdings.profitLoss.amount = { krw: "-0.5", usd: "0" };
		raw.holdings.totalPurchaseAmount = { krw: "1.5", usd: "0" };
		raw.krw.cashBuyingPower = "0.995";
		raw.usd.cashBuyingPower = "0";
		raw.holdings.items[0].marketValue.amount = "1.01";
		const snapshot = createSnapshot(raw, NOW);
		expect(snapshot.totals).toMatchObject({
			stocksEvalKRW: "1",
			profitLossKRW: "-1",
			purchaseKRW: "2",
			totalAssetsKRW: "2",
		});
		expect(snapshot.holdings[0].weight).toBe("0.51");
	});
	it("appends once under concurrent contention and preserves every existing byte", async () => {
		const config = fixtureConfig(directory);
		const prefix = Buffer.from(
			`  ${JSON.stringify(ledgerFixture)} \r\nFAKE broken row\n`,
		);
		await writeFile(config.ledgerPath, prefix);
		const ledger = createLedger({ config, now: () => NOW });
		const results = await Promise.all([
			ledger.appendSnapshot(rawFixture()),
			ledger.appendSnapshot(rawFixture()),
		]);
		expect(results.sort()).toEqual([false, true]);
		const result = await readFile(config.ledgerPath);
		expect(result.subarray(0, prefix.length).equals(prefix)).toBe(true);
		expect(result.subarray(prefix.length).toString()).toBe(
			`${JSON.stringify(createSnapshot(rawFixture(), NOW))}\n`,
		);
	});
	it("skips a date already written by another source", async () => {
		const config = fixtureConfig(directory);
		const original = JSON.stringify({ ...ledgerFixture, date: "2026-10-29" });
		await writeFile(config.ledgerPath, original);
		expect(
			await createLedger({ config, now: () => NOW }).appendSnapshot(
				rawFixture(),
			),
		).toBe(false);
		expect(await readFile(config.ledgerPath, "utf8")).toBe(original);
	});
	it("creates missing ledgers as 600, respects KST cutoff, and never accesses files in mock mode", async () => {
		const config = fixtureConfig(directory);
		expect(
			await createLedger({ config, now: () => NOW - 120_000 }).appendSnapshot(
				rawFixture(),
			),
		).toBe(false);
		const ledger = createLedger({ config, now: () => NOW });
		expect(await ledger.readTrend()).toEqual([]);
		expect(await ledger.appendSnapshot(rawFixture())).toBe(true);
		expect((await stat(config.ledgerPath)).mode & 0o777).toBe(0o600);
		const mock = createLedger({
			config: {
				...config,
				mock: true,
				ledgerPath: `${directory}/missing/never.jsonl`,
			},
		});
		expect(await mock.readTrend()).toEqual([]);
		expect(await mock.appendSnapshot(rawFixture())).toBe(false);
	});
	it("separates an unterminated old row without rewriting its bytes", async () => {
		const config = fixtureConfig(directory);
		const old = JSON.stringify(ledgerFixture);
		await writeFile(config.ledgerPath, old);
		await createLedger({ config, now: () => NOW }).appendSnapshot(rawFixture());
		expect(
			(await readFile(config.ledgerPath, "utf8")).startsWith(`${old}\n{`),
		).toBe(true);
	});
});
