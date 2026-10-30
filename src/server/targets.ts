import { readFile } from "node:fs/promises";
import {
	isRecord,
	TARGET_BODY_LIMIT,
	type TargetsData,
	type TargetsDocument,
	targetMessages,
	validateTargetPayload,
	validateTargets,
	validTargetTimestamp,
} from "../lib/targets";
import { writeJsonAtomic } from "./atomicWrite";
import { type Config, type Now, readConfig } from "./config";
import { withFileLock } from "./fileLock";
import { createMockTargets } from "./mock";
import { getProxy } from "./proxy";
import { log } from "./redact";

export function createTargetsStore(options: {
	config: Config;
	now?: Now;
	warn?: (message: string) => void;
}) {
	const { config } = options;
	if (config.proxy) throw new Error("Local targets unavailable in proxy mode");
	let memory = config.mock ? createMockTargets() : undefined;
	async function read(): Promise<Omit<TargetsData, "editable">> {
		if (memory)
			return { targets: { ...memory.targets }, updatedAt: memory.updatedAt };
		let source: string;
		try {
			source = await readFile(config.targetsPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return { targets: {}, updatedAt: null };
			throw new Error(targetMessages.load);
		}
		try {
			const value: unknown = JSON.parse(source);
			if (
				!isRecord(value) ||
				value.version !== 1 ||
				!validTargetTimestamp(value.updatedAt)
			)
				throw new Error();
			return {
				targets: validateTargets(value.targets),
				updatedAt: value.updatedAt,
			};
		} catch {
			(options.warn ?? log.warn)("Targets: invalid file; left unchanged");
			throw new Error(targetMessages.load);
		}
	}
	return {
		read,
		async save(value: unknown): Promise<TargetsDocument> {
			const targets = validateTargets(value);
			const document = (): TargetsDocument => ({
				version: 1,
				updatedAt: new Date((options.now ?? Date.now)()).toISOString(),
				targets,
			});
			if (config.mock) {
				memory = document();
				return structuredClone(memory);
			}
			return withFileLock(`${config.targetsPath}.lock`, async () => {
				// Recheck under the lock: a corrupt file must never be replaced.
				await read();
				const saved = document();
				await writeJsonAtomic(config.targetsPath, saved);
				return saved;
			});
		},
	};
}

const globals = globalThis as typeof globalThis & {
	__mockTargets?: ReturnType<typeof createTargetsStore>;
};
function store(config: Config) {
	if (!config.mock) return createTargetsStore({ config });
	globals.__mockTargets ??= createTargetsStore({ config });
	return globals.__mockTargets;
}
const noStore = { "Cache-Control": "no-store" };
const failure = (status: number, error: string) =>
	Response.json({ error }, { status, headers: noStore });

export async function targetsGet() {
	try {
		const config = readConfig();
		const proxy = getProxy(config);
		if (proxy)
			return Response.json(await proxy.getTargets(), { headers: noStore });
		return Response.json(
			{ ...(await store(config).read()), editable: true },
			{ headers: noStore },
		);
	} catch {
		return failure(500, targetMessages.load);
	}
}

function sameOrigin(request: Request): boolean {
	const site = request.headers.get("Sec-Fetch-Site");
	if (site !== null && site !== "same-origin") return false;
	const origin = request.headers.get("Origin");
	if (origin !== null) {
		try {
			const parsed = new URL(origin);
			const host = request.headers.get("Host") ?? new URL(request.url).host;
			if (
				!/^https?:$/.test(parsed.protocol) ||
				parsed.host.toLowerCase() !== host.toLowerCase()
			)
				return false;
		} catch {
			return false;
		}
	}
	return true;
}

async function limitedJson(request: Request): Promise<unknown> {
	if (Number(request.headers.get("Content-Length")) > TARGET_BODY_LIMIT)
		throw new Error(targetMessages.size);
	const reader = request.body?.getReader();
	if (!reader) throw new Error(targetMessages.payload);
	let length = 0;
	let text = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > TARGET_BODY_LIMIT) {
				void reader.cancel().catch(() => {});
				throw new Error(targetMessages.size);
			}
			text += decoder.decode(value, { stream: true });
		}
		return JSON.parse(text + decoder.decode());
	} finally {
		reader.releaseLock();
	}
}

export async function targetsPut(request: Request) {
	try {
		const config = readConfig();
		if (config.proxy) return failure(405, targetMessages.readonly);
		if (!sameOrigin(request)) return failure(403, targetMessages.origin);
		if (
			request.headers
				.get("Content-Type")
				?.split(";")[0]
				.trim()
				.toLowerCase() !== "application/json"
		)
			return failure(415, targetMessages.contentType);
		let targets: ReturnType<typeof validateTargetPayload>;
		try {
			targets = validateTargetPayload(await limitedJson(request));
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : "";
			return failure(
				400,
				Object.values(targetMessages).some((text) => text === message)
					? message
					: targetMessages.payload,
			);
		}
		return Response.json(await store(config).save(targets), {
			headers: noStore,
		});
	} catch {
		return failure(500, targetMessages.save);
	}
}
