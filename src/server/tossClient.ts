import type {
	BuyingPower,
	Currency,
	DatedClose,
	ExchangeRate,
	HoldingsOverview,
} from "../lib/types";
import { type Now, readConfig, type Sleep, sleep } from "./config";
import { ALLOWED_ENDPOINTS, TOSS_REST_BASE } from "./endpoints";
import { exchangeDate, finiteNumber, record } from "./parse";
import { redact, summarizeHttpError } from "./redact";
import { getTokenStore, type TokenStore } from "./tokenStore";

export interface AccountRecord {
	accountSeq: number;
	accountType: string;
	accountNoMasked: string;
}
export interface TossClient {
	listAccounts(): Promise<AccountRecord[]>;
	getHoldings(seq: number): Promise<HoldingsOverview>;
	getBuyingPower(seq: number, currency: Currency): Promise<BuyingPower>;
	getExchangeRate(): Promise<ExchangeRate>;
	getCandles(
		symbol: string,
		options: { interval: "1d"; count: number; market?: "KR" | "US" },
	): Promise<DatedClose[]>;
}

export function parseDatedCandles(
	result: unknown,
	market: "KR" | "US",
): DatedClose[] {
	const candles = record(result).candles;
	if (!Array.isArray(candles)) return [];
	const points = new Map<string, number>();
	for (const candle of candles) {
		const row = record(candle);
		const close = finiteNumber(row.closePrice) ?? finiteNumber(row.close);
		const stamp = typeof row.timestamp === "string" ? row.timestamp : "";
		// An explicit offset (Toss sends e.g. +09:00) already labels the bar's own
		// calendar day; only UTC stamps are converted to the exchange-local date.
		const date = /^\d{4}-\d{2}-\d{2}T[^Z]*[+-]\d{2}:?\d{2}$/.test(stamp)
			? stamp.slice(0, 10)
			: exchangeDate(
					Date.parse(stamp),
					market === "KR" ? "Asia/Seoul" : "America/New_York",
				);
		if (date && close !== null && close > 0 && !points.has(date))
			points.set(date, close);
	}
	return [...points]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, close]) => ({ date, close }));
}

export function parseCandleCloses(result: unknown): number[] {
	const candles = record(result).candles;
	if (!Array.isArray(candles)) return [];
	return candles
		.flatMap((candle: unknown) => {
			const row = record(candle);
			const close = finiteNumber(row.closePrice) ?? finiteNumber(row.close);
			return close !== null && close > 0 ? [close] : [];
		})
		.reverse();
}

export function createTossClient(options: {
	tokens: TokenStore;
	fetch?: typeof fetch;
	sleep?: Sleep;
	now?: Now;
	mock?: boolean;
	timeoutMs?: number;
}): TossClient {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const wait = options.sleep ?? sleep;
	const now = options.now ?? Date.now;
	const allowed = new Set<string>(
		Object.values(ALLOWED_ENDPOINTS).filter(
			(path) => path !== ALLOWED_ENDPOINTS.token,
		),
	);
	async function get<T>(
		path: string,
		query?: Record<string, string>,
		seq?: number,
	): Promise<T> {
		if (options.mock) throw new Error("REST disabled in mock mode");
		if (!allowed.has(path)) throw new Error("Endpoint is not allowed");
		const url = new URL(path, TOSS_REST_BASE);
		for (const [key, value] of Object.entries(query ?? {}))
			url.searchParams.set(key, value);
		let token = await options.tokens.getToken();
		let authRetried = false;
		let rateRetried = false;
		for (;;) {
			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(),
				options.timeoutMs ?? 15_000,
			).unref();
			let response: Response;
			let body: { result?: T; error?: { code?: string } };
			try {
				const headers: Record<string, string> = {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				};
				if (seq !== undefined) headers["X-Tossinvest-Account"] = String(seq);
				response = await fetchImpl(url, {
					method: "GET",
					headers,
					signal: controller.signal,
					redirect: "error",
				});
				body = await response.json().catch(() => ({}));
			} catch {
				throw new Error(`GET ${path}: request failed or timed out`);
			} finally {
				clearTimeout(timer);
			}
			if (response.ok) {
				if (!body || typeof body !== "object" || !("result" in body))
					throw new Error(`GET ${path}: invalid response envelope`);
				return body.result as T;
			}
			if (
				response.status === 401 &&
				!authRetried &&
				["invalid-token", "expired-token", "token-revoked"].includes(
					body?.error?.code ?? "",
				)
			) {
				authRetried = true;
				token = await options.tokens.getToken({ rejectedToken: token });
				continue;
			}
			if (response.status === 429 && !rateRetried) {
				rateRetried = true;
				const header = response.headers.get("Retry-After");
				const seconds = header === null ? NaN : Number(header);
				const milliseconds = Number.isFinite(seconds)
					? seconds * 1000
					: header
						? Date.parse(header) - now()
						: NaN;
				await wait(
					Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 1500,
				);
				continue;
			}
			const summary = summarizeHttpError(response.status, body, [
				token,
				...(seq === undefined ? [] : [String(seq)]),
			]);
			throw new Error(redact(`GET ${path}: ${summary}`));
		}
	}
	return {
		async listAccounts() {
			const accounts = await get<
				{ accountSeq: number; accountType: string; accountNo?: string }[]
			>(ALLOWED_ENDPOINTS.accounts);
			return accounts.map((account) => {
				const number = account.accountNo ?? "";
				const accountNoMasked =
					number.length > 4
						? `${"*".repeat(number.length - 4)}${number.slice(-4)}`
						: "****";
				delete account.accountNo;
				return {
					accountSeq: account.accountSeq,
					accountType: account.accountType,
					accountNoMasked,
				};
			});
		},
		getHoldings: (seq) => get(ALLOWED_ENDPOINTS.holdings, undefined, seq),
		getBuyingPower: (seq, currency) =>
			get(ALLOWED_ENDPOINTS.buyingPower, { currency }, seq),
		getExchangeRate: () =>
			get(ALLOWED_ENDPOINTS.exchangeRate, {
				baseCurrency: "USD",
				quoteCurrency: "KRW",
			}),
		async getCandles(symbol, { interval, count, market }) {
			return parseDatedCandles(
				await get(ALLOWED_ENDPOINTS.candles, {
					symbol,
					interval,
					count: String(count),
				}),
				market ?? (/^\d{6}$/.test(symbol) ? "KR" : "US"),
			);
		},
	};
}

const globals = globalThis as typeof globalThis & { __tossClient?: TossClient };
export function getTossClient(): TossClient {
	globals.__tossClient ??= createTossClient({
		tokens: getTokenStore(),
		mock: readConfig().mock,
	});
	return globals.__tossClient;
}
