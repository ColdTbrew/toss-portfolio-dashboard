import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AllocationChart } from "../components/AllocationChart";
import { HoldingsTable } from "../components/HoldingsTable";
import { LiveBadge, type LiveStatus } from "../components/LiveBadge";
import { useMask } from "../components/MaskProvider";
import { PnlBarChart } from "../components/PnlBarChart";
import { ShareModal } from "../components/ShareModal";
import { SummaryCards } from "../components/SummaryCards";
import { ThemeToggle } from "../components/ThemeToggle";
import { TrendChart } from "../components/TrendChart";
import { applyTick } from "../lib/compute";
import type { PortfolioState, Tick, TrendPoint } from "../lib/types";

const loadInitial = createIsomorphicFn()
	.server(async () => {
		const [portfolio, trend] = await Promise.all([
			import("./api/portfolio"),
			import("./api/trend"),
		]);
		return Promise.all([portfolio.GET(), trend.GET()]);
	})
	.client(() => Promise.all([fetch("/api/portfolio"), fetch("/api/trend")]));

export const Route = createFileRoute("/")({
	loader: async () => {
		const [portfolio, trend] = await loadInitial();
		if (!portfolio.ok) throw new Error("포트폴리오를 불러오지 못했어요.");
		return {
			state: (await portfolio.json()) as PortfolioState,
			trend: trend.ok ? ((await trend.json()) as TrendPoint[]) : [],
			trendError: !trend.ok,
		};
	},
	component: Dashboard,
	errorComponent: ({ reset }) => (
		<main className="load-error">
			<h1>포트폴리오를 불러오지 못했어요</h1>
			<p>서버 설정과 연결 상태를 확인해 주세요.</p>
			<button type="button" className="button" onClick={reset}>
				다시 시도
			</button>
		</main>
	),
});

function Dashboard() {
	const initial = Route.useLoaderData();
	const [state, setState] = useState(initial.state);
	const [trend, setTrend] = useState(initial.trend);
	const [trendError, setTrendError] = useState(initial.trendError);
	const [connected, setConnected] = useState(false);
	const [status, setStatus] = useState<LiveStatus>({
		ws: "idle",
		lastRefreshAt: initial.state.fetchedAt,
	});
	const [sharing, setSharing] = useState(false);
	const { masked, toggle } = useMask();
	useEffect(() => {
		const source = new EventSource("/api/stream");
		const abort = new AbortController();
		source.onopen = () => setConnected(true);
		source.onerror = () => setConnected(false);
		source.addEventListener("snapshot", (event) => {
			try {
				setState(JSON.parse(event.data) as PortfolioState);
			} catch {
				setConnected(false);
			}
		});
		source.addEventListener("ticks", (event) => {
			try {
				const ticks = JSON.parse(event.data) as Tick[];
				setState((previous) => ticks.reduce(applyTick, previous));
			} catch {
				setConnected(false);
			}
		});
		source.addEventListener("status", (event) => {
			try {
				setStatus(JSON.parse(event.data) as LiveStatus);
			} catch {
				setConnected(false);
			}
		});
		async function refreshTrend() {
			try {
				const response = await fetch("/api/trend", { signal: abort.signal });
				if (!response.ok) throw new Error();
				const points = (await response.json()) as TrendPoint[];
				if (!abort.signal.aborted) {
					setTrend(points);
					setTrendError(false);
				}
			} catch {
				if (!abort.signal.aborted) setTrendError(true);
			}
		}
		const timer = setInterval(() => void refreshTrend(), 60_000);
		return () => {
			source.close();
			abort.abort();
			clearInterval(timer);
		};
	}, []);
	const updated = new Intl.DateTimeFormat("ko-KR", {
		timeZone: "Asia/Seoul",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(new Date(status.lastRefreshAt));
	return (
		<div className="app-shell">
			<header className="site-header">
				<a href="#main" className="skip-link">
					본문으로 이동
				</a>
				<div className="brand">
					<span className="brand-mark" aria-hidden="true">
						↗
					</span>
					<span>내 포트폴리오</span>
					<span className="read-only">조회 전용</span>
				</div>
				<div className="header-actions">
					<button
						type="button"
						className="button mask-button"
						aria-pressed={masked}
						onClick={toggle}
					>
						<svg
							aria-hidden="true"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
						>
							<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
							<circle cx="12" cy="12" r="3" />
							{masked && <path d="m3 3 18 18" />}
						</svg>{" "}
						금액 가리기
					</button>
					<ThemeToggle />
					<button
						type="button"
						className="button primary-button"
						onClick={() => setSharing(true)}
					>
						<span aria-hidden="true">↗</span> 추출
					</button>
				</div>
			</header>
			<main id="main">
				<div className="page-heading">
					<div>
						<p className="eyebrow">MY PORTFOLIO</p>
						<h1>자산의 흐름을 한눈에</h1>
						<p className="page-subtitle">
							오늘의 변화부터 차곡차곡 쌓인 수익까지.
						</p>
					</div>
					<div className="connection-info">
						<LiveBadge
							connected={connected}
							status={status}
							mock={state.mock}
						/>
						<span className="subtle">
							마지막 갱신 {updated} <span className="timezone">KST</span>
						</span>
					</div>
				</div>
				{state.mock && (
					<div className="mock-banner">
						<span className="mock-tag">DEMO</span>모의 데이터로 둘러보고 있어요.
						실제 자산 정보가 아닙니다.
					</div>
				)}
				{Object.keys(state.errors).length > 0 && (
					<div className="error-banner" aria-live="polite">
						<strong>
							일부 정보를 갱신하지 못했어요. 마지막으로 받은 값을 표시합니다.
						</strong>
						{Object.entries(state.errors).map(([key, message]) => (
							<p key={key}>{message}</p>
						))}
					</div>
				)}
				{trendError && (
					<div className="error-banner" aria-live="polite">
						일별 기록을 갱신하지 못했어요. 잠시 후 다시 연결합니다.
					</div>
				)}
				<SummaryCards state={state} />
				<div className="charts-grid">
					<AllocationChart state={state} />
					<PnlBarChart state={state} />
				</div>
				<TrendChart points={trend} />
				<HoldingsTable state={state} />
				<footer className="site-footer">
					<span>
						내 포트폴리오 <span className="footer-dot">·</span> 조회 전용
						대시보드
					</span>
					<span>원화 환산은 중간환율 기준 · 한국 시간</span>
				</footer>
			</main>
			{sharing && (
				<ShareModal state={state} onClose={() => setSharing(false)} />
			)}
		</div>
	);
}
