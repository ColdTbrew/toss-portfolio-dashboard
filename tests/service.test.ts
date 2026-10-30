import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kstIso } from "../src/lib/compute";
import type { RawPortfolio, Tick } from "../src/lib/types";
import { withFileLock } from "../src/server/fileLock";
import { createPortfolioService } from "../src/server/portfolioService";
import type { Realtime } from "../src/server/realtime";
import { createSseHub } from "../src/server/sseHub";
import { deferred, fixtureConfig, NOW, rawFixture } from "./fixtures";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function realtimeStub() {
	let receive = (_tick: Tick) => {};
	const realtime: Realtime = {
		connect: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
		setClientCount: vi.fn(),
		setHoldings: vi.fn(),
		getState: () => "idle",
		getError: () => null,
		onTick: (listener) => {
			receive = listener;
			return () => {
				receive = () => {};
			};
		},
		onStatus: () => () => {},
	};
	return { realtime, receive: (tick: Tick) => receive(tick) };
}

describe("portfolio service", () => {
	it("drains an append under its lock, stops polling and refuses an SSE request waiting for startup", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const directory = await mkdtemp(join(tmpdir(), "toss-fake-drain-"));
		const lock = join(directory, "fake-append.lock");
		const writing = deferred<void>();
		const finish = deferred<void>();
		const { holdings, krw, usd, fx } = rawFixture();
		if (!holdings || !krw || !usd || !fx) throw new Error();
		const client = {
			getCandles: vi.fn(async () => []),
			listAccounts: vi.fn(async () => []),
			getHoldings: vi.fn(async () => holdings),
			getBuyingPower: vi.fn(async (_seq: number, currency: "KRW" | "USD") =>
				currency === "KRW" ? krw : usd,
			),
			getExchangeRate: vi.fn(async () => fx),
		};
		const ledger = {
			readTrend: async () => [],
			appendSnapshot: vi.fn(() =>
				withFileLock(lock, async () => {
					writing.resolve();
					await finish.promise;
					return true;
				}),
			),
		};
		const { realtime } = realtimeStub();
		const hub = createSseHub();
		const service = createPortfolioService({
			config: fixtureConfig(directory),
			client,
			ledger,
			realtime,
			hub,
			account: async () => 42,
			sleep: async () => {},
		});
		try {
			const response = service.openStream();
			await writing.promise;
			const stopped = service.stop();
			expect(service.stop()).toBe(stopped);
			const completed = vi.fn();
			void stopped.then(completed);
			await Promise.resolve();
			expect(completed).not.toHaveBeenCalled();
			expect((await stat(lock)).isFile()).toBe(true);
			finish.resolve();
			await stopped;
			expect(await readdir(directory)).toEqual([]);
			expect((await response).status).toBe(503);
			expect(hub.getClientCount()).toBe(0);
			expect(realtime.stop).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(600_000);
			await service.start();
			await service.refresh(true);
			expect(client.getHoldings).toHaveBeenCalledTimes(1);
			expect(ledger.appendSnapshot).toHaveBeenCalledTimes(1);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			finish.resolve();
			await service.stop();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("starts lazily, spaces REST calls, retains partial failures, preserves live prices across cash refresh and snapshots only raw REST", async () => {
		let time = NOW;
		const raw = rawFixture();
		if (!raw.holdings || !raw.fx || !raw.krw || !raw.usd) throw new Error();
		const calls: number[] = [];
		const record = <T>(value: T) => {
			calls.push(time);
			return Promise.resolve(value);
		};
		const client = {
			getCandles: vi.fn(async () => []),
			listAccounts: vi.fn(async () => []),
			getHoldings: vi.fn(() =>
				record(raw.holdings as NonNullable<typeof raw.holdings>),
			),
			getBuyingPower: vi.fn((_seq: number, currency: "KRW" | "USD") =>
				record(
					(currency === "KRW" ? raw.krw : raw.usd) as NonNullable<
						typeof raw.krw
					>,
				),
			),
			getExchangeRate: vi.fn(() =>
				record(raw.fx as NonNullable<typeof raw.fx>),
			),
		};
		const account = vi.fn(() => record(42));
		const ledger = {
			readTrend: vi.fn(async () => []),
			appendSnapshot: vi.fn(async (_raw: RawPortfolio) => true),
		};
		const { realtime, receive } = realtimeStub();
		const service = createPortfolioService({
			config: {
				...fixtureConfig("/tmp/FAKE_UNUSED"),
				refreshHoldingsMs: 120_000,
			},
			now: () => time,
			sleep: async (ms) => {
				time += ms;
			},
			client,
			account,
			ledger,
			realtime,
			hub: createSseHub(),
		});
		try {
			expect(client.getHoldings).not.toHaveBeenCalled();
			const state = await service.getPortfolio();
			expect(state.totals.totalAssetsKrw).toBe(168000);
			for (let index = 1; index < calls.length; index++)
				expect(calls[index] - calls[index - 1]).toBeGreaterThanOrEqual(400);
			time += 1000;
			receive({
				symbol: "FAKEUS",
				market: "us",
				price: 220,
				timestamp: kstIso(time),
			});
			expect(service.peek().holdings[1].lastPrice).toBe(220);
			time += 60_000;
			await service.refresh();
			expect(client.getHoldings).toHaveBeenCalledTimes(1);
			expect(service.peek().holdings[1].lastPrice).toBe(220);
			expect(ledger.appendSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({
				holdings: { items: [{ lastPrice: "10000" }, { lastPrice: "200" }] },
			});
			client.getHoldings.mockRejectedValueOnce(
				new Error("Bearer FAKE_FAILURE_TOKEN"),
			);
			await service.refresh(true);
			expect(service.peek().holdings[1].lastPrice).toBe(220);
			expect(service.peek().errors.holdings).toBe("Bearer [REDACTED]");
			expect(service.getHealth().ok).toBe(false);
			expect(JSON.stringify(service.peek())).not.toContain("accountSeq");
			await service.refresh(true);
			expect(service.peek().errors).toEqual({});
		} finally {
			await service.stop();
		}
	});

	it("runs separate polling periods and backs failed holdings off without overlapping refreshes", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const raw = rawFixture();
		const client = {
			getCandles: vi.fn(async () => []),
			listAccounts: vi.fn(async () => []),
			getHoldings: vi.fn(async () => {
				if (!raw.holdings) throw new Error();
				return raw.holdings;
			}),
			getBuyingPower: vi.fn(async (_seq: number, currency: "KRW" | "USD") => {
				const value = currency === "KRW" ? raw.krw : raw.usd;
				if (!value) throw new Error();
				return value;
			}),
			getExchangeRate: vi.fn(async () => {
				if (!raw.fx) throw new Error();
				return raw.fx;
			}),
		};
		const service = createPortfolioService({
			config: { ...fixtureConfig("/tmp/FAKE_UNUSED"), snapshotEnabled: false },
			client,
			account: async () => 42,
			realtime: realtimeStub().realtime,
			hub: createSseHub(),
			sleep: async () => {},
			ledger: { readTrend: async () => [], appendSnapshot: async () => false },
		});
		try {
			await service.start();
			client.getHoldings.mockRejectedValueOnce(
				new Error("FAKE transient failure"),
			);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(client.getHoldings).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(client.getHoldings).toHaveBeenCalledTimes(2);
			expect(client.getBuyingPower).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(client.getHoldings).toHaveBeenCalledTimes(3);
		} finally {
			await service.stop();
		}
	});

	it("provides twelve obvious fake holdings, 60 trend days and one-second ticks with no network or file effects", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		const directory = await mkdtemp(join(tmpdir(), "toss-fake-mock-"));
		const network = vi.fn(() => {
			throw new Error("Network forbidden");
		});
		vi.stubGlobal("fetch", network);
		const account = vi.fn();
		const ledger = { readTrend: vi.fn(), appendSnapshot: vi.fn() };
		const { realtime } = realtimeStub();
		const service = createPortfolioService({
			config: fixtureConfig(directory, { TOSS_MOCK: "1" }),
			account,
			ledger,
			realtime,
			hub: createSseHub(),
			random: () => 0.8,
		});
		try {
			const initial = await service.getPortfolio();
			expect(initial.mock).toBe(true);
			expect(
				initial.holdings.filter((row) => row.market === "KR"),
			).toHaveLength(6);
			expect(
				initial.holdings.filter((row) => row.market === "US"),
			).toHaveLength(6);
			expect(await service.getTrend()).toHaveLength(60);
			await vi.advanceTimersByTimeAsync(1000);
			expect(service.peek().holdings[0].lastPrice).toBeGreaterThan(
				initial.holdings[0].lastPrice,
			);
			expect(network).not.toHaveBeenCalled();
			expect(account).not.toHaveBeenCalled();
			expect(ledger.readTrend).not.toHaveBeenCalled();
			expect(ledger.appendSnapshot).not.toHaveBeenCalled();
			expect(realtime.setClientCount).not.toHaveBeenCalled();
			expect(await readdir(directory)).toEqual([]);
		} finally {
			await service.stop();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
