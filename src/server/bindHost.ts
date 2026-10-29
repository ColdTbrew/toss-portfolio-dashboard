export function validateBindHost(env: NodeJS.ProcessEnv): void {
	if (env.NODE_ENV !== "production") return;
	const host = env.HOST?.trim();
	if (
		!host ||
		["0.0.0.0", "::", "[::]"].includes(host) ||
		/<[^>]*>/.test(host)
	) {
		throw new Error(
			"프로덕션 시작 거부: ~/.config/toss-dashboard.env에 HOST를 실제 바인드 주소로 설정하세요. 빈 값, 전체 인터페이스 주소(0.0.0.0, ::, [::]), <...> 자리표시자는 사용할 수 없습니다.",
		);
	}
}
