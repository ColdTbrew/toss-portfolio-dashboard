import {
	mkdtemp,
	open,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	parseTargetDraft,
	targetMessages,
	validateTargetPayload,
	validateTargets,
} from "../src/lib/targets";
import { withFileLock } from "../src/server/fileLock";
import { createMockRaw, createMockTargets } from "../src/server/mock";
import { createTargetsStore } from "../src/server/targets";
import { deferred, fixtureConfig, NOW } from "./fixtures";

it("validates empty, zero, decimal, CASH and dot symbols without rounding inputs", () => {
	expect(validateTargets({})).toEqual({});
	const targets = { FAKE: 0, "FAKE.A": 33.33, FAKE2: 61.67, CASH: 5 };
	expect(validateTargets(targets)).toEqual(targets);
	expect(validateTargets({ FAKE: 0.29 })).toEqual({ FAKE: 0.29 });
	expect(
		validateTargets(
			Object.fromEntries(
				Array.from({ length: 100 }, (_, i) => [`FAKE${i}`, 1]),
			),
		),
	).toBeDefined();
	expect(validateTargetPayload({ targets })).toEqual(targets);
});

it.each([
	{ FAKE: -0.01 },
	{ FAKE: 100.01 },
	{ FAKE: 1.001 },
	{ FAKE: 0.000001 },
	{ FAKE: Number.NaN },
	{ FAKE: Number.POSITIVE_INFINITY },
	{ FAKE: "50" },
	{ FAKE: null },
	{ FAKE: true },
	{ FAKE: 60, CASH: 40.01 },
	{ fake: 1 },
	{ "FAKE-X": 1 },
	{ "FAKE/X": 1 },
	{ "": 1 },
	{ FAKE1234567890: 1 },
	{ 가상: 1 },
	[],
	null,
	"fake",
	Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`FAKE${i}`, 0])),
	JSON.parse('{"__proto__":5}'),
])("rejects invalid targets case %#", (value) => {
	expect(() => validateTargets(value)).toThrow();
});

it.each([
	{},
	{ targets: {}, extra: true },
	{ targets: [] },
	null,
	[],
])("rejects invalid payload case %#", (value) => {
	expect(() => validateTargetPayload(value)).toThrow(targetMessages.payload);
});

it("mirrors validation for drafts and treats blank as unassigned rather than zero", () => {
	expect(parseTargetDraft(JSON.parse('{"__proto__":"5"}')).error).toBe(
		targetMessages.symbol,
	);
	expect(parseTargetDraft({ FAKE: "", CASH: "0" })).toEqual({
		targets: { CASH: 0 },
		fields: {},
		error: "",
	});
	for (const value of ["-1", "101", "1.234", "NaN", "1e1", "0.000001"]) {
		expect(parseTargetDraft({ FAKE: value }).fields.FAKE).toBe(
			targetMessages.percent,
		);
	}
	expect(parseTargetDraft({ FAKE: "99.99", CASH: "0.02" }).error).toBe(
		targetMessages.sum,
	);
	expect(parseTargetDraft({ FAKE: "99.99", CASH: "0.01" }).error).toBe("");
});

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "fake-targets-"));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const setup = () => {
	const config = fixtureConfig(directory);
	const warn = vi.fn();
	return {
		config,
		warn,
		store: createTargetsStore({ config, now: () => NOW, warn }),
	};
};

it("reads missing as empty and atomically replaces documents with mode 0600", async () => {
	const { config, store, warn } = setup();
	expect(await store.read()).toEqual({ targets: {}, updatedAt: null });
	const first = await store.save({ FAKE: 50, CASH: 5 });
	expect(first).toEqual({
		version: 1,
		updatedAt: new Date(NOW).toISOString(),
		targets: { FAKE: 50, CASH: 5 },
	});
	const previous = await open(config.targetsPath, "r");
	try {
		const saved = await store.save({ FAKE: 75 });
		expect(JSON.parse(await previous.readFile("utf8"))).toEqual(first);
		expect(JSON.parse(await readFile(config.targetsPath, "utf8"))).toEqual(
			saved,
		);
	} finally {
		await previous.close();
	}
	expect((await stat(config.targetsPath)).mode & 0o777).toBe(0o600);
	expect(await readdir(directory)).toEqual(["targets.json"]);
	expect(warn).not.toHaveBeenCalled();
});

it.each([
	"FAKE_BROKEN_DETAIL",
	JSON.stringify({
		version: 2,
		updatedAt: new Date(NOW).toISOString(),
		targets: {},
	}),
	JSON.stringify({ version: 1, updatedAt: "invalid", targets: {} }),
	JSON.stringify({
		version: 1,
		updatedAt: new Date(NOW).toISOString(),
		targets: { FAKE: 101 },
	}),
])("preserves corrupt files and warns without any contents case %#", async (source) => {
	const { config, store, warn } = setup();
	await writeFile(config.targetsPath, source);
	await expect(store.read()).rejects.toThrow(targetMessages.load);
	await expect(store.save({ FAKE: 5 })).rejects.toThrow(targetMessages.load);
	expect(await readFile(config.targetsPath, "utf8")).toBe(source);
	expect(warn.mock.calls).toEqual(
		Array(2).fill(["Targets: invalid file; left unchanged"]),
	);
	expect(await readdir(directory)).toEqual(["targets.json"]);
});

it("waits for the file lock and rechecks corruption before replacing anything", async () => {
	const { config, store } = setup();
	await store.save({ FAKE: 5 });
	const entered = deferred<void>();
	const release = deferred<void>();
	const held = withFileLock(`${config.targetsPath}.lock`, async () => {
		entered.resolve();
		await release.promise;
		await writeFile(config.targetsPath, "FAKE_CORRUPTION");
	});
	await entered.promise;
	let finished = false;
	const pending = store.save({ FAKE: 10 }).then(
		() => {
			finished = true;
		},
		() => {
			finished = true;
			return "rejected";
		},
	);
	await new Promise((resolve) => setTimeout(resolve, 30));
	expect(finished).toBe(false);
	expect((await stat(`${config.targetsPath}.lock`)).mode & 0o777).toBe(0o600);
	release.resolve();
	await held;
	expect(await pending).toBe("rejected");
	expect(await readFile(config.targetsPath, "utf8")).toBe("FAKE_CORRUPTION");
	expect(await readdir(directory)).toEqual(["targets.json"]);
});

it("serializes independent writers and leaves a complete document without temporary files", async () => {
	const { config, store } = setup();
	const other = createTargetsStore({ config, now: () => NOW });
	const saved = await Promise.all([
		store.save({ FAKE: 10 }),
		other.save({ FAKE: 20 }),
	]);
	expect(saved).toContainEqual(
		JSON.parse(await readFile(config.targetsPath, "utf8")),
	);
	expect(await readdir(directory)).toEqual(["targets.json"]);
});

it("uses deterministic mock targets with memory-only updates and defensive copies", async () => {
	const request = vi.fn(() => {
		throw new Error("Network forbidden");
	});
	vi.stubGlobal("fetch", request);
	const config = fixtureConfig(directory, {
		TOSS_MOCK: "1",
		TARGET_WEIGHTS_PATH: `${directory}/absent/targets.json`,
	});
	const store = createTargetsStore({ config, now: () => NOW });
	const seed = createMockTargets();
	expect(createMockTargets()).toEqual(seed);
	expect(Object.values(seed.targets).reduce((a, b) => a + b, 0)).toBe(100);
	expect(seed.targets.CASH).toBe(5);
	for (const holding of createMockRaw(NOW).holdings?.items ?? [])
		expect(seed.targets).toHaveProperty(holding.symbol);
	expect((await store.read()).targets).toEqual(seed.targets);
	const saved = await store.save({ FAKE: 40 });
	saved.targets.FAKE = 99;
	expect((await store.read()).targets).toEqual({ FAKE: 40 });
	expect(await readdir(directory)).toEqual([]);
	expect(request).not.toHaveBeenCalled();
});
