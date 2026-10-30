import type { HoldingRow } from "../lib/types";
import { type Now, readConfig } from "./config";
import { getProxy, proxyFailure } from "./proxy";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_BYTES = 256 * 1024;
type Logo = { bytes: Uint8Array<ArrayBuffer>; type: string };
type LogoHolding = Pick<HoldingRow, "symbol" | "name">;

export function normalizeLogoSymbol(symbol: string): string | null {
	const normalized = (
		/^A\d{6}$/.test(symbol) ? symbol.slice(1) : symbol
	).replaceAll("-", ".");
	return normalized.length <= 12 &&
		/^[A-Z0-9]+(?:\.[A-Z0-9]+)*$/.test(normalized)
		? normalized
		: null;
}

export function logoUrl(symbol: string): string | null {
	const normalized = normalizeLogoSymbol(symbol);
	return normalized
		? `https://static.toss.im/png-icons/securities/icn-sec-fill-${normalized}.png`
		: null;
}

function mockLogo(symbol: string, name: string): Logo | null {
	// Deliberate gaps keep the same fallback visible in every mock preview.
	if (symbol === "FAKEK2" || symbol === "FAKEU2") return null;
	const initial = name.match(/[\p{L}\p{N}]/u)?.[0] ?? symbol[0];
	const suffix = symbol.match(/\d(?=\D*$)/)?.[0] ?? symbol.slice(-1);
	const initials = `${initial}${suffix}`;
	// Original dashboard accent, loss, overseas badge and profit colours.
	const colors = ["#6265e8", "#347ce4", "#299f91", "#e34e59"];
	const hash = Array.from(symbol).reduce(
		(value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
		0,
	);
	const color = colors[hash % colors.length];
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${color}"/><text x="12" y="12" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="600" fill="#ffffff">${initials}</text></svg>`;
	return { bytes: new TextEncoder().encode(svg), type: "image/svg+xml" };
}

export function createLogoService(options: {
	mock: boolean;
	getHoldings: () => Promise<readonly LogoHolding[]>;
	fetch?: typeof fetch;
	now?: Now;
}) {
	const request = options.fetch ?? fetch;
	const now = options.now ?? Date.now;
	const cache = new Map<string, { logo: Logo | null; expires: number }>();
	const pending = new Map<string, Promise<Logo | null>>();

	async function download(symbol: string): Promise<Logo | null> {
		const url = logoUrl(symbol);
		if (!url) return null;
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 5000);
		try {
			const response = await request(url, {
				method: "GET",
				redirect: "error",
				credentials: "omit",
				signal: abort.signal,
			});
			const type = response.headers
				.get("Content-Type")
				?.split(";")[0]
				.trim()
				.toLowerCase();
			if (
				!response.ok ||
				!type ||
				!["image/png", "image/jpeg", "image/webp"].includes(type) ||
				Number(response.headers.get("Content-Length")) > MAX_BYTES ||
				!response.body
			)
				return null;
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > MAX_BYTES) return null;
					chunks.push(value);
				}
			} finally {
				await reader.cancel().catch(() => {});
			}
			if (!size) return null;
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return { bytes, type };
		} catch {
			return null;
		} finally {
			abort.abort();
			clearTimeout(timer);
		}
	}

	async function getLogo(symbol: string, name: string): Promise<Logo | null> {
		if (options.mock) return mockLogo(symbol, name);
		const cached = cache.get(symbol);
		if (cached && cached.expires > now()) {
			cache.delete(symbol);
			cache.set(symbol, cached);
			return cached.logo;
		}
		let fetching = pending.get(symbol);
		if (!fetching) {
			fetching = download(symbol)
				.then((logo) => {
					cache.delete(symbol);
					cache.set(symbol, { logo, expires: now() + (logo ? DAY : HOUR) });
					if (cache.size > 200) {
						const oldest = cache.keys().next().value;
						if (oldest !== undefined) cache.delete(oldest);
					}
					return logo;
				})
				.finally(() => pending.delete(symbol));
			pending.set(symbol, fetching);
		}
		return fetching;
	}

	return {
		async respond(symbol: string) {
			const normalized = normalizeLogoSymbol(symbol);
			const missing = () =>
				new Response(null, {
					status: 404,
					headers: {
						"Cache-Control": "private, max-age=3600",
						"X-Content-Type-Options": "nosniff",
					},
				});
			if (!normalized) return missing();
			let holding: LogoHolding | undefined;
			try {
				holding = (await options.getHoldings()).find(
					(row) => normalizeLogoSymbol(row.symbol) === normalized,
				);
			} catch {
				return proxyFailure();
			}
			// Authorization is checked even for cached images and negative entries.
			if (!holding) return missing();
			const logo = await getLogo(normalized, holding.name);
			return logo
				? new Response(logo.bytes.slice(), {
						headers: {
							"Content-Type": logo.type,
							"Cache-Control": "private, max-age=86400",
							"X-Content-Type-Options": "nosniff",
						},
					})
				: missing();
		},
	};
}

export type LogoService = ReturnType<typeof createLogoService>;
const globals = globalThis as typeof globalThis & { __tossLogos?: LogoService };
export function getLogoService(): LogoService {
	if (!globals.__tossLogos) {
		const config = readConfig();
		const proxy = getProxy(config);
		globals.__tossLogos = createLogoService({
			mock: config.mock,
			getHoldings: proxy
				? () => proxy.getHoldings()
				: async () => {
						const { getPortfolioService } = await import("./portfolioService");
						return (await getPortfolioService().getPortfolio()).holdings;
					},
		});
	}
	return globals.__tossLogos;
}
