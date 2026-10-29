export function redact(value: string): string {
	return value
		.replace(/\b(Bearer|Basic)\s+[^\s,"'<>}]+/gi, "$1 [REDACTED]")
		.replace(/\beyJ[\w-]*\.[\w-]+\.[\w-]+/g, "[REDACTED]")
		.replace(
			/((?:["']?)(?:access_token|client_secret|client_id|accountSeq|accountNo|X-Tossinvest-Account)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s&,;}]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/\b(?:tsck_live_|tssk_)[\w-]+/g, "[REDACTED]")
		.replace(/\b\d{3,}-\d{2,}-\d{3,}\b|\d{8,}/g, "[REDACTED]");
}

export function summarizeHttpError(
	status: number,
	body: unknown,
	sensitiveValues: string[] = [],
): string {
	const object =
		body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	const error =
		object.error && typeof object.error === "object"
			? (object.error as Record<string, unknown>)
			: object;
	const code =
		typeof error.code === "string"
			? error.code
			: typeof object.error === "string"
				? object.error
				: "unknown";
	const message =
		typeof error.message === "string"
			? error.message
			: typeof object.error_description === "string"
				? object.error_description
				: "Request failed";
	const sanitize = (value: string) => {
		let text = value;
		for (const secret of sensitiveValues)
			if (secret) text = text.split(secret).join("[REDACTED]");
		return redact(text).replace(/[\r\n]/g, " ");
	};
	return `HTTP ${status} code=${sanitize(code).slice(0, 80)} msg=${sanitize(message).slice(0, 200)}`;
}

export function safeError(error: unknown): string {
	return redact(
		error instanceof Error ? error.message : "Operation failed",
	).slice(0, 300);
}

// Accept strings only: callers cannot accidentally dump headers or response objects.
export const log = {
	info: (message: string) => console.info(redact(message)),
	warn: (message: string) => console.warn(redact(message)),
	error: (message: string) => console.error(redact(message)),
};
