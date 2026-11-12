import { useEffect, useState } from "react";

export function usePollingJson<T>(
	path: string,
	interval: number,
	initial?: T,
	options: { clearOnError?: boolean } = {},
) {
	const clearOnError = options.clearOnError ?? false;
	const [data, setData] = useState(initial);
	const hasInitial = initial !== undefined;
	useEffect(() => {
		const abort = new AbortController();
		let pending = false;
		async function refresh() {
			if (pending) return;
			pending = true;
			try {
				const response = await fetch(path, {
					method: "GET",
					signal: abort.signal,
				});
				if (!response.ok) {
					if (clearOnError && !abort.signal.aborted) setData(initial);
					return;
				}
				const next = (await response.json()) as T;
				if (!abort.signal.aborted) setData(next);
			} catch {
				// Most panels retain their last result during a temporary failure.
				if (clearOnError && !abort.signal.aborted) setData(initial);
			} finally {
				pending = false;
			}
		}
		if (!hasInitial) void refresh();
		const timer = setInterval(() => void refresh(), interval);
		return () => {
			abort.abort();
			clearInterval(timer);
		};
	}, [path, interval, hasInitial, clearOnError, initial]);
	return data;
}
