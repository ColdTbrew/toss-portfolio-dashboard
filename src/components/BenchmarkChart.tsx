import { useState } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { benchmarkComparison } from "../lib/analytics";
import { formatPercent } from "../lib/format";
import type { AnalyticsData, TrendPoint } from "../lib/types";
import {
	AnalyticsEmpty,
	AnalyticsPanel,
	AnalyticsPeriods,
} from "./AnalyticsPanel";

const lines = [
	{
		key: "portfolio",
		name: "포트폴리오",
		color: "var(--accent)",
		dash: undefined,
	},
	{ key: "^KS11", name: "코스피", color: "var(--profit)", dash: "5 3" },
	{ key: "^GSPC", name: "S&P 500", color: "var(--loss)", dash: "2 3" },
	{ key: "^IXIC", name: "나스닥", color: "var(--muted)", dash: "8 3" },
] as const;
export const snapshotMethod =
	"일별 수익률 = 평가손익의 전일 대비 변화 / 전일 주식 평가금. 이를 누적 연결하여 입출금에 따른 원금 변화를 수익에서 제외합니다. 매도로 확정된 실현손익은 포착하지 못합니다.";
export function BenchmarkChart({
	points,
	data,
}: {
	points: TrendPoint[];
	data?: AnalyticsData;
}) {
	const [period, setPeriod] = useState(90);
	const series = data
		? benchmarkComparison(points, data.benchmarks, period)
		: [];
	const visible = lines.filter((line) => series[0]?.[line.key] !== undefined);
	return (
		<AnalyticsPanel
			id="benchmark-heading"
			eyebrow="BENCHMARK COMPARISON"
			title="벤치마크 비교"
			info={`${snapshotMethod} 지수는 각 스냅샷 날짜 이전의 가장 최근 종가를 사용합니다. 시작일 값이 없는 지수는 생략합니다.`}
		>
			<AnalyticsPeriods
				label="벤치마크 비교 기간"
				value={period}
				onChange={setPeriod}
				options={[
					[30, "1개월"],
					[90, "3개월"],
					[180, "6개월"],
					[0, "전체"],
				]}
			/>
			<div className="analytics-content">
				{series.length < 2 ? (
					<AnalyticsEmpty loading={!data}>
						기록이 2일 이상 쌓이면 추이가 표시됩니다
					</AnalyticsEmpty>
				) : (
					<>
						<div className="analytics-legend">
							{visible.map((line) => (
								<span key={line.key}>
									<i style={{ background: line.color }} />
									{line.name}
								</span>
							))}
						</div>
						<ResponsiveContainer width="100%" height={300}>
							<LineChart
								data={series}
								margin={{ top: 16, right: 12, left: 0, bottom: 4 }}
								accessibilityLayer
							>
								<CartesianGrid
									stroke="var(--border)"
									vertical={false}
									strokeDasharray="3 5"
								/>
								<XAxis
									dataKey="date"
									tickFormatter={(date) =>
										String(date).slice(5).replace("-", ".")
									}
									minTickGap={36}
									tick={{ fontSize: 11, fill: "var(--muted)" }}
									axisLine={false}
									tickLine={false}
								/>
								<YAxis
									width={62}
									tickFormatter={(value) =>
										`${(Number(value) * 100).toFixed(1)}%`
									}
									tick={{ fontSize: 11, fill: "var(--muted)" }}
									axisLine={false}
									tickLine={false}
								/>
								<Tooltip
									formatter={(value) => formatPercent(Number(value), true)}
									contentStyle={{
										background: "var(--surface)",
										border: "1px solid var(--border)",
										borderRadius: 12,
										color: "var(--text)",
										fontSize: 12,
									}}
								/>
								{visible.map((line) => (
									<Line
										key={line.key}
										dataKey={line.key}
										name={line.name}
										stroke={line.color}
										strokeDasharray={line.dash}
										strokeWidth={line.key === "portfolio" ? 2.5 : 1.5}
										dot={false}
										isAnimationActive={false}
									/>
								))}
							</LineChart>
						</ResponsiveContainer>
					</>
				)}
			</div>
			<p className="chart-note analytics-note">
				같은 시작일을 0%로 환산 · 지수는 현지 통화 가격 수익률 · 배당 미포함
				{series.length > 1 &&
					` · ${series[0].date} ~ ${series[series.length - 1].date}`}
			</p>
		</AnalyticsPanel>
	);
}
