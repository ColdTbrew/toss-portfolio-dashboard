import {
	isRecord,
	parseTargetsData,
	type TargetWeights,
	targetMessages,
} from "./targets";

export class TargetsRequestError extends Error {
	constructor(
		message: string,
		public status: number,
	) {
		super(message);
	}
}

async function result(response: Response, fallback: string) {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new TargetsRequestError(fallback, response.status);
	}
	if (!response.ok) {
		// Only display the API's fixed messages, never arbitrary response contents.
		const message =
			isRecord(body) &&
			Object.values(targetMessages).some((text) => text === body.error)
				? String(body.error)
				: fallback;
		throw new TargetsRequestError(message, response.status);
	}
	return parseTargetsData(body);
}

export async function loadTargets(signal: AbortSignal) {
	return result(
		await fetch("/api/targets", {
			method: "GET",
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error",
			signal,
		}),
		targetMessages.load,
	);
}

export async function saveTargets(targets: TargetWeights) {
	return result(
		await fetch("/api/targets", {
			method: "PUT",
			cache: "no-store",
			credentials: "same-origin",
			redirect: "error",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ targets }),
		}),
		targetMessages.save,
	);
}
