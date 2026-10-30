import { log } from "./redact";

interface ShutdownProcess {
	on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
	exit(code: number): void;
	exitCode?: string | number | null;
}

export function createShutdownCoordinator(
	stop: () => Promise<void>,
	runtime: ShutdownProcess = process,
) {
	let pending: Promise<void> | undefined;
	function shutdown(): Promise<void> {
		if (pending) return pending;
		// Keep this armed after cleanup: an unrelated handle must not strand Node.
		setTimeout(() => runtime.exit(0), 5000).unref();
		pending = Promise.resolve()
			.then(stop)
			.catch(() => log.error("Shutdown cleanup failed"))
			.then(() => {
				// Let Nitro finish closing HTTP connections and Node exit naturally.
				runtime.exitCode = 0;
			});
		return pending;
	}
	// Use on, not once: a repeated signal must still follow the same drain.
	for (const signal of ["SIGTERM", "SIGINT"] as const)
		runtime.on(signal, () => void shutdown());
	return shutdown;
}

const globals = globalThis as typeof globalThis & {
	__tossShutdown?: ReturnType<typeof createShutdownCoordinator>;
};
export function getShutdownCoordinator(stop: () => Promise<void>) {
	globals.__tossShutdown ??= createShutdownCoordinator(stop);
	return globals.__tossShutdown;
}
