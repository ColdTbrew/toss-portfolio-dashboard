import { useId } from "react";
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
import { ratio } from "../lib/compute";
import { formatMoney, formatPercent } from "../lib/format";
import type { HoldingRow, IntradayData } from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { Amount } from "./Amount";
import { pnlClass } from "./SummaryCards";

const compact = new Intl.NumberFormat("ko-KR", {
	notation: "compact",
	maximumFractionDigits: 1,
});

export function HoldingExpand({ row }: { row: HoldingRow }) {
	const gradientId = useId().replaceAll(":", "");
	const data = usePollingJson<IntradayData>(
		`/api/intraday?symbol=${encodeURIComponent(row.symbol)}`,
		60_000,
	);
	const points = data?.points ?? [];
	const previousClose =
		data?.previousClose ??
		(row.quantity > 0 ? row.lastPrice - row.dailyPl / row.quantity : null);
	const dayRate = ratio(row.dailyPl, row.evalAmount - row.dailyPl);
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
		hour12: false,
	});
	const formatTime = (iso: string) => timeFormat.format(new Date(iso));
	const closes = points.map((point) => point.close);
	const low = closes.length
		? Math.min(...closes, previousClose ?? Infinity)
		: 0;
	const high = closes.length
		? Math.max(...closes, previousClose ?? -Infinity)
		: 1;
	const pad = (high - low) * 0.1 || high * 0.01 || 1;
	return (
		<div className="holding-expand">
			<p className="holding-expand-price">
				<small>현재가</small>
				<strong>{formatMoney(row.lastPrice, row.currency)}</strong>
				<span className={`holding-expand-change ${tone}`}>
					<Amount value={row.dailyPl} currency={row.currency} signed />
					{` (${formatPercent(dayRate, true)})`}
				</span>
			</p>
			{points.length >= 2 ? (
				<div className="chart-frame holding-expand-chart">
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart
							data={points}
							margin={{ top: 12, right: 8, left: 4, bottom: 4 }}
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
								tickFormatter={formatTime}
								minTickGap={40}
								tick={{ fontSize: 12, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								domain={[low - pad, high + pad]}
								width={52}
								tickFormatter={(value) => compact.format(Number(value))}
								tick={{ fontSize: 12, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<Tooltip
								itemStyle={{ color: "var(--text)" }}
								labelStyle={{ color: "var(--muted)" }}
								formatter={(value) => formatMoney(Number(value), row.currency)}
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
			<p className="chart-note">
				오늘 1분 간격 체결가 · {row.market === "KR" ? "한국" : "미국(뉴욕)"}{" "}
				시각 기준
			</p>
			<dl className="holding-expand-facts">
				<div>
					<dt>수량</dt>
					<dd>
						<Amount value={row.quantity} quantity />
					</dd>
				</div>
				<div>
					<dt>평균 단가</dt>
					<dd>
						<Amount value={row.avgPrice} currency={row.currency} />
					</dd>
				</div>
				<div>
					<dt>평가 금액</dt>
					<dd>
						<Amount value={row.evalAmount} currency={row.currency} />
						{row.currency === "USD" && (
							<small>
								<Amount value={row.evalKrw} />
							</small>
						)}
					</dd>
				</div>
				<div>
					<dt>평가 손익</dt>
					<dd className={pnlClass(row.profitLoss)}>
						<Amount value={row.profitLoss} currency={row.currency} signed />
						<small>{formatPercent(row.returnRate, true)}</small>
					</dd>
				</div>
				<div>
					<dt>비중</dt>
					<dd>{formatPercent(row.weight)}</dd>
				</div>
				<div>
					<dt>오늘 손익</dt>
					<dd className={pnlClass(row.dailyPl)}>
						<Amount value={row.dailyPl} currency={row.currency} signed />
					</dd>
				</div>
			</dl>
		</div>
	);
}
