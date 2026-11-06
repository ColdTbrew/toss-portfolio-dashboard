import { useEffect, useId, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatMoney } from "../lib/format";
import { chartSeries, dayRange, roundTicks } from "../lib/intradayChart";
import type { HoldingRow, IntradayData } from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { pnlClass } from "./SummaryCards";

const compact = new Intl.NumberFormat("ko-KR", {
	notation: "compact",
	maximumFractionDigits: 1,
});

const MOBILE_QUERY = "(max-width: 640px)";

function useIsMobile() {
	const [mobile, setMobile] = useState(false);
	useEffect(() => {
		if (typeof matchMedia !== "function") return;
		const query = matchMedia(MOBILE_QUERY);
		const update = () => setMobile(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return mobile;
}

export function HoldingExpand({ row }: { row: HoldingRow }) {
	const gradientId = useId().replaceAll(":", "");
	const data = usePollingJson<IntradayData>(
		`/api/intraday?symbol=${encodeURIComponent(row.symbol)}`,
		60_000,
	);
	const isMobile = useIsMobile();
	const raw = data?.points ?? [];
	const points = chartSeries(raw);
	const range = dayRange(raw);
	const previousClose =
		data?.previousClose ??
		(row.quantity > 0 ? row.lastPrice - row.dailyPl / row.quantity : null);
	const tone = pnlClass(row.dailyPl);
	const stroke =
		tone === "profit"
			? "var(--profit)"
			: tone === "loss"
				? "var(--loss)"
				: "var(--chart-line)";
	const timeZone = row.market === "KR" ? "Asia/Seoul" : "America/New_York";
	const timeFormat = new Intl.DateTimeFormat("ko-KR", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const formatTime = (iso: string) => timeFormat.format(new Date(iso));
	const minuteOfDay = (iso: string) => {
		const [hour = 0, minute = 0] = formatTime(iso).split(":").map(Number);
		return hour * 60 + minute;
	};
	const ticks = roundTicks(points, isMobile ? 4 : 7, minuteOfDay);
	const closes = points.map((point) => point.close);
	const low = Math.min(
		...closes,
		range?.low ?? Infinity,
		previousClose ?? Infinity,
	);
	const high = Math.max(
		...closes,
		range?.high ?? -Infinity,
		previousClose ?? -Infinity,
	);
	const pad = (high - low) * 0.1 || high * 0.01 || 1;
	const money = (value: number) => formatMoney(value, row.currency);
	const axisTick = { fontSize: 11, fill: "var(--chart-axis)" };
	return (
		<div className="holding-expand">
			<div className="holding-expand-head">
				<dl className="holding-expand-meta">
					{previousClose !== null && (
						<div>
							<dt>전일 종가</dt>
							<dd>{money(previousClose)}</dd>
						</div>
					)}
					{range && (
						<>
							<div>
								<dt>고가</dt>
								<dd>{money(range.high)}</dd>
							</div>
							<div>
								<dt>저가</dt>
								<dd>{money(range.low)}</dd>
							</div>
						</>
					)}
				</dl>
				<p className="holding-expand-basis">
					{raw.length > points.length ? "5분 단위" : "1분 단위"} ·{" "}
					{row.market === "KR" ? "한국" : "뉴욕"} 시각
				</p>
			</div>
			{points.length >= 2 ? (
				<div className="chart-frame holding-expand-chart">
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart
							data={points}
							margin={{ top: 8, right: 18, left: 0, bottom: 0 }}
							accessibilityLayer
						>
							<defs>
								<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
									<stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
								</linearGradient>
							</defs>
							<CartesianGrid
								stroke="var(--chart-grid)"
								vertical={false}
								strokeDasharray="3 5"
							/>
							<XAxis
								dataKey="t"
								ticks={ticks}
								interval={0}
								tickFormatter={formatTime}
								tick={axisTick}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								domain={[low - pad, high + pad]}
								width={48}
								tickCount={4}
								tickFormatter={(value) => compact.format(Number(value))}
								tick={axisTick}
								axisLine={false}
								tickLine={false}
							/>
							<Tooltip
								itemStyle={{ color: "var(--text)" }}
								labelStyle={{ color: "var(--muted)" }}
								formatter={(value) => money(Number(value))}
								labelFormatter={(iso) => formatTime(String(iso))}
								contentStyle={{
									background: "var(--surface)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									color: "var(--text)",
								}}
							/>
							{previousClose !== null && (
								<ReferenceLine
									y={previousClose}
									stroke="var(--muted)"
									strokeDasharray="4 4"
								/>
							)}
							<Area
								type="linear"
								dataKey="close"
								name="체결가"
								stroke={stroke}
								strokeWidth={2}
								fill={`url(#${gradientId})`}
								dot={false}
								activeDot={{
									r: 4,
									strokeWidth: 2,
									stroke: "var(--surface)",
								}}
								isAnimationActive={false}
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			) : (
				<p className="empty-state holding-expand-chart">
					{data
						? "오늘의 체결 추이를 불러오지 못했어요."
						: "오늘의 체결 추이를 불러오는 중…"}
				</p>
			)}
		</div>
	);
}
