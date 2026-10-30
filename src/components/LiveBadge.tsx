export interface LiveStatus {
	ws: string;
	lastRefreshAt: string;
}

export function LiveBadge({
	connected,
	status,
	mock,
}: {
	connected: boolean;
	status: LiveStatus;
	mock: boolean;
}) {
	const live = connected && (mock || status.ws === "open");
	const label =
		!connected || ["connecting", "backoff", "closed"].includes(status.ws)
			? "재연결 중"
			: live
				? "연결됨"
				: "장외 · 대기";
	return (
		<output className={`live-badge ${live ? "is-live" : ""}`}>
			<span className="live-dot" />
			{mock ? "모의 실시간" : "실시간"} · {label}
		</output>
	);
}
