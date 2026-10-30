import type { PortfolioState, Tick } from "../lib/types";
import type { WsState } from "./realtime";

export interface StreamStatus {
	ws: WsState;
	lastRefreshAt: string;
}

export function createSseHub(
	options: { heartbeatMs?: number; batchMs?: number } = {},
) {
	const clients = new Set<{
		controller: ReadableStreamDefaultController<Uint8Array>;
		close: () => void;
	}>();
	const counts = new Set<(count: number) => void>();
	const pending = new Map<string, Tick>();
	const encoder = new TextEncoder();
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let batch: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	const notifyCount = () => {
		for (const listener of counts) listener(clients.size);
	};
	function write(text: string) {
		const bytes = encoder.encode(text);
		for (const client of clients) {
			try {
				if ((client.controller.desiredSize ?? 0) <= 0) client.close();
				else client.controller.enqueue(bytes);
			} catch {
				client.close();
			}
		}
	}
	function broadcast(
		event: "snapshot" | "ticks" | "status",
		data: PortfolioState | Tick[] | StreamStatus,
	) {
		write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	}
	return {
		getClientCount: () => clients.size,
		onClientCount(listener: (count: number) => void) {
			counts.add(listener);
			listener(clients.size);
			return () => {
				counts.delete(listener);
			};
		},
		broadcast,
		queueTick(tick: Tick) {
			if (clients.size) pending.set(`${tick.market}:${tick.symbol}`, tick);
		},
		connect(
			snapshot: PortfolioState,
			status: StreamStatus,
			signal?: AbortSignal,
		): Response {
			if (stopped) return new Response(null, { status: 503 });
			let cleanup = () => {};
			const stream = new ReadableStream<Uint8Array>(
				{
					start(controller) {
						const client = { controller, close: () => cleanup() };
						let closed = false;
						cleanup = () => {
							if (closed) return;
							closed = true;
							signal?.removeEventListener("abort", cleanup);
							clients.delete(client);
							try {
								controller.close();
							} catch {
								/* Reader already cancelled. */
							}
							if (!clients.size) {
								clearInterval(heartbeat);
								clearInterval(batch);
								heartbeat = undefined;
								batch = undefined;
								pending.clear();
							}
							notifyCount();
						};
						if (signal?.aborted) {
							cleanup();
							return;
						}
						clients.add(client);
						controller.enqueue(
							encoder.encode(
								`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\nevent: status\ndata: ${JSON.stringify(status)}\n\n`,
							),
						);
						signal?.addEventListener("abort", cleanup, { once: true });
						heartbeat ??= setInterval(
							() => write(": ping\n\n"),
							options.heartbeatMs ?? 15_000,
						);
						batch ??= setInterval(() => {
							if (pending.size) {
								const ticks = [...pending.values()];
								pending.clear();
								broadcast("ticks", ticks);
							}
						}, options.batchMs ?? 250);
						heartbeat.unref();
						batch.unref();
						notifyCount();
					},
					cancel() {
						cleanup();
					},
				},
				{ highWaterMark: 64 },
			);
			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"X-Accel-Buffering": "no",
				},
			});
		},
		stop() {
			if (stopped) return;
			stopped = true;
			for (const client of clients) client.close();
			clearInterval(heartbeat);
			clearInterval(batch);
			pending.clear();
			counts.clear();
		},
	};
}
export type SseHub = ReturnType<typeof createSseHub>;
const globals = globalThis as typeof globalThis & { __tossSseHub?: SseHub };
export function getSseHub(): SseHub {
	globals.__tossSseHub ??= createSseHub();
	return globals.__tossSseHub;
}
