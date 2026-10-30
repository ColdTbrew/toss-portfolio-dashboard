export type TargetWeights = Record<string, number>;
export interface TargetsDocument {
	version: 1;
	updatedAt: string;
	targets: TargetWeights;
}
export interface TargetsData {
	targets: TargetWeights;
	updatedAt: string | null;
	editable: boolean;
}

export const TARGET_BODY_LIMIT = 4096;
export const targetMessages = {
	payload: "목표 비중 형식을 확인해 주세요.",
	symbol: "종목 코드는 영문 대문자·숫자·점으로 1~12자까지 입력해 주세요.",
	count: "목표는 최대 100개까지 저장할 수 있어요.",
	percent: "비중은 0~100 사이, 소수 둘째 자리까지 입력해 주세요.",
	sum: "목표 비중의 합계는 100% 이하여야 해요.",
	size: "목표 데이터는 4 KB 이하여야 해요.",
	load: "목표 비중을 불러오지 못했어요.",
	save: "목표 비중을 저장하지 못했어요.",
	readonly: "미리보기에서는 목표 비중을 편집할 수 없어요.",
	origin: "같은 사이트에서만 저장할 수 있어요.",
	contentType: "JSON 형식으로 보내 주세요.",
} as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function validPercent(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= 100 &&
		Math.round(value * 100) / 100 === value
	);
}

export function validateTargets(value: unknown): TargetWeights {
	if (!isRecord(value)) throw new Error(targetMessages.payload);
	const entries = Object.entries(value);
	if (entries.length > 100) throw new Error(targetMessages.count);
	let sum = 0;
	for (const [symbol, percent] of entries) {
		if (!/^[A-Z0-9.]{1,12}$/.test(symbol))
			throw new Error(targetMessages.symbol);
		if (!validPercent(percent)) throw new Error(targetMessages.percent);
		sum += percent;
	}
	if (sum > 100.005) throw new Error(targetMessages.sum);
	return Object.fromEntries(entries) as TargetWeights;
}

export function validateTargetPayload(value: unknown): TargetWeights {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 1 ||
		!Object.hasOwn(value, "targets")
	)
		throw new Error(targetMessages.payload);
	return validateTargets(value.targets);
}

export function validTargetTimestamp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
			value,
		) &&
		Number.isFinite(Date.parse(value))
	);
}

export function parseTargetsData(value: unknown): TargetsData {
	if (
		!isRecord(value) ||
		(value.updatedAt !== null && !validTargetTimestamp(value.updatedAt))
	)
		throw new Error(targetMessages.payload);
	return {
		targets: validateTargets(value.targets),
		updatedAt: value.updatedAt,
		editable: value.editable === true,
	};
}

export function parseTargetDraft(draft: Record<string, string>) {
	const targets: TargetWeights = Object.create(null);
	const fields: Record<string, string> = Object.create(null);
	for (const [symbol, text] of Object.entries(draft)) {
		if (text.trim() === "") continue;
		if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !validPercent(Number(text)))
			fields[symbol] = targetMessages.percent;
		else targets[symbol] = Number(text);
	}
	let error = Object.keys(fields).length ? targetMessages.percent : "";
	try {
		validateTargets(targets);
		if (
			new TextEncoder().encode(JSON.stringify({ targets })).byteLength >
			TARGET_BODY_LIMIT
		)
			error = targetMessages.size;
	} catch (cause) {
		error = cause instanceof Error ? cause.message : targetMessages.payload;
	}
	return { targets, fields, error };
}
