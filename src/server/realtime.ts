import WebSocket from "ws";
import type { HoldingRow, Tick } from "../lib/types";
import type { Now } from "./config";
import { TOSS_WS_URL } from "./endpoints";
import { safeError, summarizeHttpError } from "./redact";
import { getTokenStore, type TokenStore } from "./tokenStore";

export type WsState =
	| "idle"
	| "connecting"
	| "open"
	| "closed"
	| "backoff"
	| "stopped";
export interface Realtime {
	connect(): Promise<void>;
	setClientCount(count: number): void;
	setHoldings(holdings: Pick<HoldingRow, "symbol" | "market">[]): void;
	onTick(listener: (tick: Tick) => void): () => void;
	onStatus(listener: (state: WsState) => void): () => void;
	getState(): WsState;
	getError(): string | null;
	stop(): Promise<void>;
}

export function createRealtime(options: {
	tokens: TokenStore;
	WebSocket?: typeof WebSocket;
	url?: string;
	now?: Now;
	random?: () => number;
	timing?: {
		pingMs?: number;
		idleMs?: number;
		declarationMs?: number;
		backoffMs?: number;
		stableMs?: number;
		forbiddenMs?: number;
	};
}): Realtime {
	const Socket = options.WebSocket ?? WebSocket;
	const now = options.now ?? Date.now;
	const random = options.random ?? Math.random;
	const timing = {
		pingMs: 60_000,
		idleMs: 120_000,
		declarationMs: 1000,
		backoffMs: 1000,
		stableMs: 60_000,
		forbiddenMs: 300_000,
		...options.timing,
	};
	let socket: WebSocket | null = null;
	let state: WsState = "idle";
	let error: string | null = null;
	let clients = 0;
	let holdings: Pick<HoldingRow, "symbol" | "market">[] = [];
	let connecting = false;
	let generation = 0;
	let attempt = 0;
	let declarationId = 0;
	let lastDeclared = -Infinity;
	let rejectedToken: string | undefined;
	let forcedDelay: number | undefined;
	const rejected = new Set<string>();
	const ticks = new Set<(tick: Tick) => void>();
	const statuses = new Set<(state: WsState) => void>();
	let retry: ReturnType<typeof setTimeout> | undefined;
	let idle: ReturnType<typeof setTimeout> | undefined;
	let declaration: ReturnType<typeof setTimeout> | undefined;
	let stable: ReturnType<typeof setTimeout> | undefined;
	let ping: ReturnType<typeof setInterval> | undefined;
	let closing: ReturnType<typeof setTimeout> | undefined;
	const wanted = () =>
		clients > 0 && holdings.length > 0 && state !== "stopped";
	const setState = (next: WsState) => {
		state = next;
		for (const listener of statuses) listener(next);
	};
	const clearConnectionTimers = () => {
		clearInterval(ping);
		clearTimeout(stable);
		clearTimeout(declaration);
		clearTimeout(closing);
		ping = undefined;
		stable = undefined;
		declaration = undefined;
		closing = undefined;
	};
	function declare(delay = 0) {
		if (socket?.readyState !== WebSocket.OPEN || declaration) return;
		declaration = setTimeout(
			() => {
				declaration = undefined;
				if (socket?.readyState !== WebSocket.OPEN) return;
				const groups = (["KR", "US"] as const)
					.map((market) => ({
						type: market === "KR" ? "trade:kr" : "trade:us",
						codes: holdings
							.filter(
								(row) =>
									row.market === market &&
									!rejected.has(`trade:${market.toLowerCase()}:${row.symbol}`),
							)
							.map((row) => row.symbol),
					}))
					.filter((group) => group.codes.length > 0);
				socket.send(
					JSON.stringify(
						groups.length ? [{ id: `dash-${++declarationId}` }, ...groups] : [],
					),
				);
				lastDeclared = now();
			},
			Math.max(delay, timing.declarationMs - (now() - lastDeclared), 0),
		);
	}
	function release() {
		generation++;
		clearTimeout(retry);
		retry = undefined;
		clearTimeout(declaration);
		declaration = undefined;
		if (!socket) {
			if (state !== "stopped") setState("idle");
			return;
		}
		const current = socket;
		if (current.readyState === WebSocket.OPEN) {
			const finish = () => {
				declaration = undefined;
				if (wanted()) {
					declare();
					return;
				}
				if (current.readyState === WebSocket.OPEN) {
					current.send("[]");
					lastDeclared = now();
					current.close();
				}
				closing = setTimeout(() => current.terminate(), 1000);
			};
			const delay = Math.max(0, timing.declarationMs - (now() - lastDeclared));
			if (delay) declaration = setTimeout(finish, delay);
			else finish();
		} else current.terminate();
	}
	function schedule() {
		if (!wanted() || retry) return;
		const delay =
			forcedDelay ??
			Math.min(
				60_000,
				timing.backoffMs *
					2 ** Math.min(attempt++, 16) *
					(0.8 + random() * 0.4),
			);
		forcedDelay = undefined;
		setState("backoff");
		retry = setTimeout(() => {
			retry = undefined;
			void connect();
		}, delay);
	}
	function message(data: WebSocket.RawData) {
		try {
			const frame = JSON.parse(data.toString());
			if (frame.type === "subscriptions" && Array.isArray(frame.rejected)) {
				for (const item of frame.rejected)
					if (
						typeof item?.target === "string" &&
						/^trade:(kr|us):/.test(item.target)
					)
						rejected.add(item.target);
			} else if (frame.type === "error") {
				error = summarizeHttpError(0, frame);
				setState(state);
				if (frame.error?.code === "rate-limit-exceeded") {
					clearTimeout(declaration);
					declaration = undefined;
					declare(1000);
				}
				if (frame.error?.code === "server-shutdown") socket?.terminate();
			} else if (frame.type === "message" && typeof frame.topic === "string") {
				const topic = frame.topic.match(/^trade:(kr|us):([A-Za-z0-9.-]+)$/);
				const price = Number(frame.data?.price);
				const timestamp = frame.data?.timestamp;
				if (
					!topic ||
					!Number.isFinite(price) ||
					price <= 0 ||
					typeof timestamp !== "string" ||
					!Number.isFinite(Date.parse(timestamp))
				)
					return;
				const market = topic[1] as Tick["market"];
				if (
					!holdings.some(
						(row) =>
							row.symbol === topic[2] && row.market.toLowerCase() === market,
					)
				)
					return;
				for (const listener of ticks)
					listener({ symbol: topic[2], market, price, timestamp });
			}
		} catch {
			/* Malformed frames must not disrupt the shared connection. */
		}
	}
	async function connect(): Promise<void> {
		if (
			!wanted() ||
			connecting ||
			retry ||
			(socket && socket.readyState !== WebSocket.CLOSED)
		)
			return;
		connecting = true;
		const version = generation;
		setState("connecting");
		try {
			const token = await options.tokens.getToken(
				rejectedToken ? { rejectedToken } : undefined,
			);
			if (version !== generation || !wanted()) {
				if (state !== "stopped") setState("idle");
				return;
			}
			rejectedToken = undefined;
			const current = new Socket(options.url ?? TOSS_WS_URL, {
				headers: { Authorization: `Bearer ${token}` },
				handshakeTimeout: 15_000,
			});
			socket = current;
			current.on("open", () => {
				if (!wanted()) {
					release();
					return;
				}
				error = null;
				setState("open");
				declare();
				ping = setInterval(() => {
					if (current.readyState === WebSocket.OPEN) current.send("PING");
				}, timing.pingMs);
				stable = setTimeout(() => {
					attempt = 0;
				}, timing.stableMs);
			});
			current.on("message", message);
			current.on("unexpected-response", (_request, response) => {
				const status = response.statusCode ?? 0;
				error = summarizeHttpError(status, {});
				if (status === 401) rejectedToken = token;
				if (status === 403) forcedDelay = timing.forbiddenMs;
				response.resume();
				current.terminate();
			});
			current.on("error", () => {
				error ??= "WebSocket connection failed";
				current.terminate();
			});
			current.on("close", () => {
				if (socket !== current) return;
				clearConnectionTimers();
				socket = null;
				if (state === "stopped") return;
				setState("closed");
				if (wanted()) schedule();
				else setState("idle");
			});
		} catch (cause) {
			error = safeError(cause);
			if (state !== "stopped") schedule();
		} finally {
			connecting = false;
			if (version !== generation && wanted() && !socket) schedule();
		}
	}
	return {
		connect,
		setClientCount(count) {
			if (state === "stopped") return;
			clients = Math.max(0, count);
			clearTimeout(idle);
			idle = undefined;
			if (clients > 0) {
				void connect();
			} else idle = setTimeout(release, timing.idleMs);
		},
		setHoldings(rows) {
			if (state === "stopped") return;
			const next = [
				...new Map(
					rows.map((row) => [
						`${row.market}:${row.symbol}`,
						{ symbol: row.symbol, market: row.market },
					]),
				).values(),
			].sort((a, b) =>
				`${a.market}:${a.symbol}`.localeCompare(`${b.market}:${b.symbol}`),
			);
			if (JSON.stringify(next) === JSON.stringify(holdings)) return;
			holdings = next;
			if (!holdings.length) release();
			else {
				declare();
				void connect();
			}
		},
		onTick(listener) {
			ticks.add(listener);
			return () => {
				ticks.delete(listener);
			};
		},
		onStatus(listener) {
			statuses.add(listener);
			return () => {
				statuses.delete(listener);
			};
		},
		getState: () => state,
		getError: () => error,
		async stop() {
			generation++;
			setState("stopped");
			clearTimeout(retry);
			clearTimeout(idle);
			clearConnectionTimers();
			retry = undefined;
			idle = undefined;
			if (socket && socket.readyState !== WebSocket.CLOSED) {
				const current = socket;
				await new Promise<void>((resolve) => {
					current.once("close", resolve);
					current.terminate();
				});
			}
			socket = null;
		},
	};
}

const globals = globalThis as typeof globalThis & { __tossRealtime?: Realtime };
export function getRealtime(): Realtime {
	globals.__tossRealtime ??= createRealtime({ tokens: getTokenStore() });
	return globals.__tossRealtime;
}
