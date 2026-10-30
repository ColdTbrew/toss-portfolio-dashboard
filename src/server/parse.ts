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
