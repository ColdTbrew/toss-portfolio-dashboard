import { isIP } from "node:net";

function hostname(raw: string | null | undefined): string | undefined {
	if (!raw || /\s/.test(raw)) return;
	// Parse the header itself: URL parsing would normalize malformed authorities.
	const match =
		/^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)(?::[0-9]+)?$/i.exec(raw);
	if (!match) return;
	const name = match[1].toLowerCase();
	if (!name.startsWith("[")) return name;
	const address = name.slice(1, -1);
	return isIP(address) === 6 ? address : undefined;
}

export function buildHostAllowlist(env: {
	HOST?: string;
	ALLOWED_HOSTS?: string;
}): ReadonlySet<string> {
	const allowed = new Set(["localhost", "127.0.0.1", "::1"]);
	for (const entry of [
		env.HOST ?? "",
		...(env.ALLOWED_HOSTS ?? "").split(","),
	]) {
		const value = entry.trim().toLowerCase();
		// Bind addresses can be bare IPv6; HTTP Host headers must use brackets.
		const name = isIP(value) === 6 ? value : hostname(value);
		if (name) allowed.add(name);
	}
	return allowed;
}

export function isHostAllowed(
	raw: string | null | undefined,
	allowed: ReadonlySet<string>,
): boolean {
	const name = hostname(raw);
	return name !== undefined && allowed.has(name);
}
