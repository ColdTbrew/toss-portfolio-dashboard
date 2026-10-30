import { useEffect, useState } from "react";

export function usePollingJson<T>(path: string, interval: number, initial?: T) {
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
				if (!response.ok) return;
				const next = (await response.json()) as T;
				if (!abort.signal.aborted) setData(next);
			} catch {
				// Keep the last result during a temporary connection failure.
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
	}, [path, interval, hasInitial]);
	return data;
}
