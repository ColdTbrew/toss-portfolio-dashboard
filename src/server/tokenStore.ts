import { readFile } from "node:fs/promises";
import { writeJsonAtomic } from "./atomicWrite";
import {
	type Config,
	type Credentials,
	type Now,
	readConfig,
	readCredentials,
} from "./config";
import { ALLOWED_ENDPOINTS, TOSS_REST_BASE } from "./endpoints";
import { type LockOptions, withFileLock } from "./fileLock";
import { redact, summarizeHttpError } from "./redact";

export interface TokenCache {
	access_token: string;
	token_type: string;
	issued_at: number;
	expires_at: number;
}
export interface TokenOptions {
	force?: boolean;
	rejectedToken?: string;
}
export interface TokenStore {
	getToken(options?: TokenOptions): Promise<string>;
}

export function createTokenStore(options: {
	config: Config;
	fetch?: typeof fetch;
	now?: Now;
	credentials?: () => Promise<Credentials>;
	lock?: LockOptions;
	timeoutMs?: number;
}): TokenStore {
	const { config } = options;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const now = options.now ?? Date.now;
	let inFlight: Promise<string> | undefined;
	let lastIssuedAt = -Infinity;
	async function readCache(): Promise<TokenCache | null> {
		try {
			const cache = JSON.parse(await readFile(config.tokenPath, "utf8"));
			if (
				cache &&
				typeof cache.access_token === "string" &&
				cache.access_token &&
				typeof cache.token_type === "string" &&
				cache.token_type.toLowerCase() === "bearer" &&
				Number.isFinite(cache.issued_at) &&
				Number.isFinite(cache.expires_at)
			)
				return cache;
			return null;
		} catch (error) {
			if (
				error instanceof SyntaxError ||
				(error as NodeJS.ErrnoException).code === "ENOENT"
			)
				return null;
			throw new Error("Cannot read TOSS_TOKEN_PATH cache");
		}
	}
	const usable = (cache: TokenCache | null, request: TokenOptions) =>
		cache &&
		cache.expires_at - 120 > now() / 1000 &&
		cache.access_token !== request.rejectedToken;

	async function issue(): Promise<string> {
		const credentials = await (
			options.credentials ?? (() => readCredentials(config))
		)();
		let response: Response | undefined;
		let body: Record<string, unknown> = {};
		for (const basic of [false, true]) {
			const form = new URLSearchParams({ grant_type: "client_credentials" });
			const headers: Record<string, string> = {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			};
			if (basic)
				headers.Authorization = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`;
			else {
				form.set("client_id", credentials.clientId);
				form.set("client_secret", credentials.clientSecret);
			}
			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(),
				options.timeoutMs ?? 15_000,
			);
			try {
				response = await fetchImpl(
					`${TOSS_REST_BASE}${ALLOWED_ENDPOINTS.token}`,
					{
						method: "POST",
						headers,
						body: form,
						signal: controller.signal,
						redirect: "error",
					},
				);
				body = await response.json().catch(() => ({}));
			} catch {
				throw new Error("Token request failed or timed out");
			} finally {
				clearTimeout(timer);
			}
			if (response.status !== 401 || basic) break;
		}
		if (!response?.ok) {
			const summary = summarizeHttpError(response?.status ?? 0, body, [
				credentials.clientId,
				credentials.clientSecret,
			]);
			throw new Error(redact(`POST ${ALLOWED_ENDPOINTS.token}: ${summary}`));
		}
		const expiresIn =
			typeof body?.expires_in === "number" ||
			typeof body?.expires_in === "string"
				? Number(body.expires_in)
				: NaN;
		if (
			!body ||
			typeof body.access_token !== "string" ||
			!body.access_token ||
			typeof body.token_type !== "string" ||
			body.token_type.toLowerCase() !== "bearer" ||
			!Number.isFinite(expiresIn) ||
			expiresIn <= 120
		) {
			throw new Error("Invalid token response");
		}
		const issued = now() / 1000;
		lastIssuedAt = issued;
		const cache: TokenCache = {
			access_token: body.access_token,
			token_type: "Bearer",
			issued_at: issued,
			expires_at: issued + expiresIn,
		};
		await writeJsonAtomic(config.tokenPath, cache);
		return cache.access_token;
	}

	async function resolve(request: TokenOptions): Promise<string> {
		const cached = await readCache();
		if (usable(cached, request) && !request.force)
			return (cached as TokenCache).access_token;
		return withFileLock(
			`${config.tokenPath}.lock`,
			async () => {
				const current = await readCache();
				if (
					usable(current, request) &&
					(!request.force || current?.access_token !== cached?.access_token)
				)
					return (current as TokenCache).access_token;
				if (
					now() / 1000 - lastIssuedAt < 60 ||
					((request.rejectedToken || request.force) &&
						now() / 1000 - (current?.issued_at ?? -Infinity) < 60)
				) {
					throw new Error(
						"Token rejected shortly after issuance; refresh suppressed for 60 seconds",
					);
				}
				return issue();
			},
			{ ...options.lock, now },
		);
	}
	return {
		async getToken(request = {}) {
			if (config.mock) throw new Error("Token access disabled in mock mode");
			while (inFlight) {
				const active = inFlight;
				const token = await active;
				if (token !== request.rejectedToken) return token;
				if (inFlight === active) inFlight = undefined;
			}
			const pending = resolve(request);
			inFlight = pending;
			try {
				return await pending;
			} finally {
				if (inFlight === pending) inFlight = undefined;
			}
		},
	};
}

const globals = globalThis as typeof globalThis & {
	__tossTokenStore?: TokenStore;
};
export function getTokenStore(): TokenStore {
	globals.__tossTokenStore ??= createTokenStore({ config: readConfig() });
	return globals.__tossTokenStore;
}
export const getToken = (options?: TokenOptions) =>
	getTokenStore().getToken(options);
