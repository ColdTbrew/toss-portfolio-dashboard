import { applyTick, buildState, kstIso } from "../lib/compute";
import type { PortfolioState, RawPortfolio, Tick } from "../lib/types";
import { getAccountSeq } from "./account";
import { type Config, type Now, readConfig, type Sleep, sleep } from "./config";
import { createLedger } from "./ledger";
import { createMockRaw, createMockTrend, mockTicks } from "./mock";
import { getRealtime, type Realtime } from "./realtime";
import { safeError } from "./redact";
import { getSseHub, type SseHub } from "./sseHub";
import { getTossClient, type TossClient } from "./tossClient";

export function createPortfolioService(options: {
	config: Config;
	now?: Now;
	sleep?: Sleep;
	random?: () => number;
	client?: TossClient;
	account?: () => Promise<number>;
	realtime?: Realtime;
	hub?: SseHub;
	ledger?: ReturnType<typeof createLedger>;
}) {
	const { config } = options;
	if (config.proxy)
		throw new Error("Local portfolio unavailable in proxy mode");
	const now = options.now ?? Date.now;
	const wait = options.sleep ?? sleep;
	const hub = options.hub ?? getSseHub();
	const client = config.mock ? null : (options.client ?? getTossClient());
	const realtime = config.mock ? null : (options.realtime ?? getRealtime());
	const ledger = config.mock
		? null
		: (options.ledger ?? createLedger({ config, now }));
	let raw: RawPortfolio = { holdings: null, krw: null, usd: null, fx: null };
	let state = buildState(raw, { now: now(), mock: config.mock });
	const errors: Record<string, string> = {};
	const latestTicks = new Map<string, Tick>();
	const listeners = new Set<(state: PortfolioState) => void>();
	let holdingsAt = now();
	let lastSuccess = now();
	let lastCall = -Infinity;
	let nextHoldings = 0;
	let nextCash = 0;
	let holdingsFailures = 0;
	let cashFailures = 0;
	let started: Promise<void> | undefined;
	let inFlight: Promise<void> | undefined;
	let stopping: Promise<void> | undefined;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let mockTimer: ReturnType<typeof setInterval> | undefined;
	let unsubscribeCount: (() => void) | undefined;
	let unsubscribeTick: (() => void) | undefined;
	let unsubscribeStatus: (() => void) | undefined;
	const status = () => ({
		ws:
			realtime?.getState() ??
			(stopped ? ("stopped" as const) : ("idle" as const)),
		lastRefreshAt: state.fetchedAt,
	});
	function syncRealtimeError() {
		const message = realtime?.getError();
		state = { ...state, errors: { ...state.errors } };
		if (message) state.errors.realtime = message;
		else delete state.errors.realtime;
	}
	function publish() {
		if (stopped) return;
		hub.broadcast("snapshot", state);
		hub.broadcast("status", status());
		for (const listener of listeners) listener(state);
	}
	function tick(tick: Tick) {
		if (stopped) return;
		const updated = applyTick(state, tick);
		if (updated === state) return;
		state = updated;
		latestTicks.set(`${tick.market}:${tick.symbol}`, tick);
		hub.queueTick(tick);
	}
	async function pace() {
		const delay = Math.max(0, lastCall + 400 - now());
		if (delay) await wait(delay);
		lastCall = now();
	}
	async function refreshRaw(force: boolean) {
		if (!client || stopped) return;
		const holdingsDue = force || now() >= nextHoldings;
		const cashDue = force || now() >= nextCash;
		if (!holdingsDue && !cashDue) return;
		let seq: number;
		try {
			await pace();
			if (stopped) return;
			seq = await (options.account ?? getAccountSeq)();
			delete errors.account;
		} catch (cause) {
			errors.account = safeError(cause);
			nextHoldings = nextCash =
				now() +
				Math.min(
					300_000,
					config.refreshHoldingsMs * 2 ** Math.min(++holdingsFailures, 16),
				);
			state = { ...state, errors: { ...errors } };
			publish();
			return;
		}
		let successful = false;
		async function fetchPart<K extends keyof RawPortfolio>(
			key: K,
			fetcher: () => Promise<NonNullable<RawPortfolio[K]>>,
		) {
			if (stopped) return false;
			await pace();
			if (stopped) return false;
			const began = now();
			try {
				const value = await fetcher();
				if (stopped) return false;
				raw[key] = value;
				delete errors[key];
				successful = true;
				lastSuccess = now();
				if (key === "holdings") {
					holdingsAt = began;
					for (const [key, tick] of latestTicks)
						if (Date.parse(tick.timestamp) < began) latestTicks.delete(key);
				}
				return true;
			} catch (cause) {
				errors[key] = safeError(cause);
				return false;
			}
		}
		if (holdingsDue) {
			const ok = await fetchPart("holdings", () => client.getHoldings(seq));
			holdingsFailures = ok ? 0 : holdingsFailures + 1;
			nextHoldings =
				now() +
				Math.min(
					300_000,
					config.refreshHoldingsMs * 2 ** Math.min(holdingsFailures, 16),
				);
		}
		if (cashDue) {
			const krw = await fetchPart("krw", () =>
				client.getBuyingPower(seq, "KRW"),
			);
			const usd = await fetchPart("usd", () =>
				client.getBuyingPower(seq, "USD"),
			);
			const fx = await fetchPart("fx", () => client.getExchangeRate());
			cashFailures = krw && usd && fx ? 0 : cashFailures + 1;
			nextCash =
				now() +
				Math.min(
					300_000,
					config.refreshCashFxMs * 2 ** Math.min(cashFailures, 16),
				);
		}
		if (stopped) return;
		state = buildState(raw, { now: holdingsAt, errors });
		for (const tick of latestTicks.values()) state = applyTick(state, tick);
		state = { ...state, fetchedAt: kstIso(lastSuccess) };
		syncRealtimeError();
		realtime?.setHoldings(state.holdings);
		if (
			successful &&
			Object.keys(errors).every((key) => key === "ledger") &&
			raw.holdings &&
			raw.krw &&
			raw.usd &&
			raw.fx
		) {
			try {
				await ledger?.appendSnapshot(raw);
				delete errors.ledger;
			} catch (cause) {
				errors.ledger = safeError(cause);
			}
			state = { ...state, errors: { ...state.errors, ...errors } };
			if (!errors.ledger) delete state.errors.ledger;
		}
		publish();
	}
	async function refresh(force = false) {
		if (config.mock || stopped) return;
		if (inFlight) return inFlight;
		inFlight = refreshRaw(force);
		try {
			await inFlight;
		} finally {
			inFlight = undefined;
		}
	}
	function schedule() {
		if (stopped) return;
		timer = setTimeout(
			async () => {
				await refresh();
				schedule();
			},
			Math.max(1, Math.min(nextHoldings, nextCash) - now()),
		);
		timer.unref();
	}
	function start(): Promise<void> {
		if (stopped) return Promise.resolve();
		started ??= (async () => {
			if (config.mock) {
				raw = createMockRaw(now());
				state = buildState(raw, { now: now(), mock: true });
				publish();
				mockTimer = setInterval(() => {
					for (const value of mockTicks(state, now(), options.random))
						tick(value);
				}, 1000).unref();
				return;
			}
			unsubscribeTick = realtime?.onTick(tick);
			unsubscribeStatus = realtime?.onStatus(() => {
				syncRealtimeError();
				publish();
			});
			unsubscribeCount = hub.onClientCount((count) =>
				realtime?.setClientCount(count),
			);
			await refresh(true);
			schedule();
		})();
		return started;
	}
	return {
		start,
		refresh,
		peek: () => state,
		async getPortfolio() {
			await start();
			return state;
		},
		async getTrend() {
			await start();
			return config.mock ? createMockTrend(now()) : (ledger?.readTrend() ?? []);
		},
		async openStream(signal?: AbortSignal) {
			await start();
			return hub.connect(state, status(), signal);
		},
		getHealth: () => ({
			ok: Object.keys(state.errors).length === 0,
			mock: config.mock,
			wsState: status().ws,
			lastRefreshAt: state.fetchedAt,
		}),
		subscribe(listener: (state: PortfolioState) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		stop() {
			if (stopping) return stopping;
			stopped = true;
			clearTimeout(timer);
			clearInterval(mockTimer);
			unsubscribeCount?.();
			unsubscribeTick?.();
			unsubscribeStatus?.();
			hub.stop();
			listeners.clear();
			// refresh includes any ledger append/account write; never unlink its locks here.
			stopping = Promise.all([realtime?.stop(), inFlight, started]).then(
				() => {},
			);
			return stopping;
		},
	};
}

export type PortfolioService = ReturnType<typeof createPortfolioService>;
const globals = globalThis as typeof globalThis & {
	__tossPortfolioService?: PortfolioService;
};
export function getPortfolioService(): PortfolioService {
	globals.__tossPortfolioService ??= createPortfolioService({
		config: readConfig(),
	});
	return globals.__tossPortfolioService;
}

export async function stopPortfolioService() {
	await globals.__tossPortfolioService?.stop();
}
