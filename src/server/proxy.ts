import type { HoldingRow, PortfolioState, Sparklines } from "../lib/types";
import { type Config, type Now, readConfig } from "./config";
import { finiteNumber, record } from "./parse";

type JsonPath =
	| "/api/portfolio"
	| "/api/trend"
	| "/api/health"
	| "/api/sparklines";
type LogoHolding = Pick<HoldingRow, "symbol" | "name">;
const noStore = { "Cache-Control": "no-store" };

export function proxyFailure() {
	return Response.json(
		{ error: "미리보기 데이터를 불러오지 못했어요." },
		{ status: 502, headers: noStore },
	);
}

export function createProxy(options: {
	upstream: URL;
	fetch?: typeof fetch;
	now?: Now;
}) {
	const request = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	let held: { rows: LogoHolding[]; expires: number } | undefined;
	let pendingHoldings: Promise<LogoHolding[]> | undefined;

	async function readJson(path: JsonPath) {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 10_000);
		try {
			const response = await request(new URL(path, options.upstream), {
				method: "GET",
				redirect: "error",
				credentials: "omit",
				signal: abort.signal,
			});
			const type = response.headers.get("Content-Type")?.split(";")[0].trim();
			if (
				!response.ok ||
				!type ||
				!/^application\/(?:[\w.+-]+\+)?json$/i.test(type)
			)
				throw new Error();
			const body = await response.text();
			return { body, data: JSON.parse(body) as unknown };
		} finally {
			abort.abort();
			clearTimeout(timer);
		}
	}

	return {
		async getSparklines(): Promise<Sparklines> {
			try {
				const { data } = await readJson("/api/sparklines");
				return Object.fromEntries(
					Object.entries(record(data)).flatMap(([symbol, values]) => {
						if (!Array.isArray(values)) return [];
						const closes = values
							.filter(
								(value): value is number =>
									typeof value === "number" &&
									Number.isFinite(value) &&
									value > 0,
							)
							.slice(-30);
						return closes.length ? [[symbol, closes]] : [];
					}),
				);
			} catch {
				return {};
			}
		},
		async getFx(): Promise<PortfolioState["fx"]> {
			const { data } = await readJson("/api/portfolio");
			const fx = record(record(data).fx);
			const midRate = finiteNumber(fx.midRate);
			if (midRate === null || midRate <= 0 || typeof fx.validFrom !== "string")
				return null;
			return {
				midRate,
				buyRate: finiteNumber(fx.buyRate) ?? midRate,
				validFrom: fx.validFrom,
			};
		},
		async json(path: "/api/portfolio" | "/api/trend") {
			try {
				const { body } = await readJson(path);
				return new Response(body, {
					headers: { ...noStore, "Content-Type": "application/json" },
				});
			} catch {
				return proxyFailure();
			}
		},
		async health() {
			let reachable = false;
			const health = { ok: false, wsState: "idle", lastRefreshAt: "" };
			try {
				const { data } = await readJson("/api/health");
				reachable = true;
				if (data && typeof data === "object") {
					health.ok = "ok" in data && data.ok === true;
					if (
						"wsState" in data &&
						typeof data.wsState === "string" &&
						[
							"idle",
							"connecting",
							"open",
							"closed",
							"backoff",
							"stopped",
						].includes(data.wsState)
					)
						health.wsState = data.wsState;
					if (
						"lastRefreshAt" in data &&
						typeof data.lastRefreshAt === "string" &&
						/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
							data.lastRefreshAt,
						)
					)
						health.lastRefreshAt = data.lastRefreshAt;
				}
			} catch {
				// Do not expose fetch errors: they can contain the upstream host.
			}
			return Response.json(
				{
					...health,
					proxy: true,
					mock: false,
					upstreamReachable: reachable,
				},
				{ headers: noStore },
			);
		},
		async getHoldings(): Promise<LogoHolding[]> {
			if (held && held.expires > now()) return held.rows;
			pendingHoldings ??= (async () => {
				const { data } = await readJson("/api/portfolio");
				if (
					!data ||
					typeof data !== "object" ||
					!("holdings" in data) ||
					!Array.isArray(data.holdings)
				)
					throw new Error("Portfolio unavailable");
				const rows = data.holdings.map((row: unknown) => {
					if (
						!row ||
						typeof row !== "object" ||
						!("symbol" in row) ||
						typeof row.symbol !== "string" ||
						!("name" in row) ||
						typeof row.name !== "string"
					)
						throw new Error("Portfolio unavailable");
					return { symbol: row.symbol, name: row.name };
				});
				held = { rows, expires: now() + 30_000 };
				return rows;
			})();
			try {
				return await pendingHoldings;
			} finally {
				pendingHoldings = undefined;
			}
		},
		async stream(signal: AbortSignal) {
			const abort = new AbortController();
			// Bound connection setup, but allow an established SSE stream to live.
			const timer = setTimeout(() => abort.abort(), 10_000);
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			let output: ReadableStreamDefaultController<Uint8Array> | undefined;
			let closed = false;
			function cleanup() {
				clearTimeout(timer);
				signal.removeEventListener("abort", disconnect);
			}
			function close() {
				if (closed) return;
				closed = true;
				cleanup();
				output?.close();
			}
			function disconnect() {
				abort.abort();
				void reader?.cancel().catch(() => {});
				close();
			}
			signal.addEventListener("abort", disconnect, { once: true });
			try {
				if (signal.aborted) throw new Error();
				const response = await request(
					new URL("/api/stream", options.upstream),
					{
						method: "GET",
						redirect: "error",
						credentials: "omit",
						signal: abort.signal,
					},
				);
				if (
					!response.ok ||
					response.headers
						.get("Content-Type")
						?.split(";")[0]
						.trim()
						.toLowerCase() !== "text/event-stream" ||
					!response.body ||
					abort.signal.aborted
				)
					throw new Error();
				clearTimeout(timer);
				reader = response.body.getReader();
				const upstreamReader = reader;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							output = controller;
						},
						async pull(controller) {
							try {
								const chunk = await upstreamReader.read();
								if (chunk.done) close();
								else if (!closed) controller.enqueue(chunk.value);
							} catch {
								// End cleanly on upstream failure; EventSource reconnects.
								close();
							}
						},
						cancel() {
							closed = true;
							cleanup();
							abort.abort();
							return upstreamReader.cancel().catch(() => {});
						},
					}),
					{
						headers: {
							...noStore,
							"Content-Type": "text/event-stream",
							"X-Accel-Buffering": "no",
						},
					},
				);
			} catch {
				abort.abort();
				cleanup();
				return proxyFailure();
			}
		},
	};
}

export type ProxyService = ReturnType<typeof createProxy>;
const globals = globalThis as typeof globalThis & {
	__tossProxy?: ProxyService;
};
export function getProxy(config: Config = readConfig()): ProxyService | null {
	if (!config.proxy) return null;
	globals.__tossProxy ??= createProxy(config.proxy);
	return globals.__tossProxy;
}
