export function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function finiteNumber(value: unknown): number | null {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (typeof value === "string" && !value.trim()) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function exchangeDate(time: number, timeZone: string): string | null {
	if (!Number.isFinite(new Date(time).getTime())) return null;
	try {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(time);
	} catch {
		return new Date(time).toISOString().slice(0, 10);
	}
}
