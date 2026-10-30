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
import { ratio } from "../lib/compute";
import { formatKrwManwon, formatPercent } from "../lib/format";
import { principalSeries } from "../lib/principal";
import type { PortfolioState, TrendPoint } from "../lib/types";
import { Amount } from "./Amount";
import { useMask } from "./MaskProvider";
import { pnlClass } from "./SummaryCards";

const periods = [
	{ label: "1주", days: 7 },
	{ label: "1달", days: 30 },
	{ label: "3달", days: 90 },
	{ label: "1년", days: 365 },
];

export function PrincipalChart({
	totals,
	points,
}: {
	totals: PortfolioState["totals"];
	points: TrendPoint[];
}) {
	const { masked } = useMask();
	const [compare, setCompare] = useState(true);
	const [periodDays, setPeriodDays] = useState(30);
	const series = principalSeries(points, periodDays);
	const gap = totals.stocksEvalKrw - totals.purchaseKrw;
	const gapRate = ratio(gap, totals.purchaseKrw);
	// A shared scale preserves both lines' geometry without putting KRW in chart payloads.
	const scale = Math.max(
		1,
		...series.flatMap((point) => [
			Math.abs(point.value),
			Math.abs(point.principal),
		]),
	);
	const data = series.map((point) => ({
		date: point.date,
		value: masked ? point.value / scale : point.value,
		principal: masked ? point.principal / scale : point.principal,
	}));
	const step = Math.max(1, Math.ceil((data.length - 1) / 4));
	const ticks = data
		.filter((_, index) => index % step === 0)
		.map((point) => point.date);
	return (
		<section
			className="panel principal-panel"
			aria-labelledby="principal-heading"
		>
			<div className="panel-heading">
				<div>
					<p className="eyebrow">PRINCIPAL VS VALUE</p>
					<h2 id="principal-heading">투자 자산 추이</h2>
				</div>
			</div>
			<div className="principal-header">
				<p className="subtle">평가금</p>
				<p className="principal-value">
					<Amount value={totals.stocksEvalKrw} />
				</p>
				<p className="principal-change">
					원금보다{" "}
					<span className={pnlClass(gap)}>
						<Amount value={gap} signed /> ({formatPercent(gapRate, true)})
					</span>
				</p>
			</div>
			<div className="principal-controls">
				<label className="share-option principal-compare">
					<input
						type="checkbox"
						checked={compare}
						onChange={(event) => setCompare(event.target.checked)}
					/>
					원금과 비교
				</label>
				<fieldset className="segmented" aria-label="투자 자산 추이 기간">
					{periods.map((period) => (
						<button
							key={period.days}
							type="button"
							aria-pressed={periodDays === period.days}
							onClick={() => setPeriodDays(period.days)}
						>
							{period.label}
						</button>
					))}
				</fieldset>
			</div>
			{data.length >= 2 ? (
				<ResponsiveContainer width="100%" height={240}>
					<LineChart
						key={masked ? "masked" : "amounts"}
						data={data}
						margin={{ top: 16, right: 20, left: 0, bottom: 4 }}
						accessibilityLayer
					>
						<CartesianGrid
							stroke="var(--border)"
							vertical={false}
							strokeDasharray="3 5"
						/>
						<XAxis
							dataKey="date"
							tickFormatter={(date) => String(date).slice(5).replace("-", ".")}
							ticks={ticks}
							minTickGap={16}
							tick={{ fontSize: 11, fill: "var(--muted)" }}
							axisLine={false}
							tickLine={false}
						/>
						<YAxis
							domain={["auto", "auto"]}
							width={masked ? 0 : 88}
							tickCount={4}
							tickFormatter={(value) =>
								masked ? "" : formatKrwManwon(Number(value))
							}
							tick={masked ? false : { fontSize: 11, fill: "var(--muted)" }}
							axisLine={false}
							tickLine={false}
						/>
						<Tooltip
							content={({ active, label }) => {
								const point = series.find((point) => point.date === label);
								if (!active || !point) return null;
								return (
									<div className="principal-tooltip">
										<p className="subtle">{point.date}</p>
										{!masked && (
											<>
												<p className="principal-tooltip-row">
													<span>평가금</span> <Amount value={point.value} />
												</p>
												{compare && (
													<p className="principal-tooltip-row">
														<span>원금</span> <Amount value={point.principal} />
													</p>
												)}
											</>
										)}
										<p className="principal-tooltip-row">
											<span>원금 대비</span>{" "}
											<span className={pnlClass(point.gap)}>
												{!masked && <Amount value={point.gap} signed />} (
												{formatPercent(point.gapRate, true)})
											</span>
										</p>
									</div>
								);
							}}
						/>
						<Line
							type="linear"
							dataKey="value"
							name="평가금"
							stroke="var(--accent)"
							strokeWidth={2.5}
							dot={false}
							activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--surface)" }}
							isAnimationActive={false}
						/>
						{compare && (
							<Line
								type="linear"
								dataKey="principal"
								name="원금"
								stroke="var(--muted)"
								strokeWidth={1.5}
								strokeDasharray="5 5"
								dot={false}
								activeDot={{ r: 4, strokeWidth: 1, stroke: "var(--surface)" }}
								isAnimationActive={false}
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			) : (
				<p className="empty-state">
					{data.length === 0
						? "아직 일별 기록이 없습니다."
						: "기록이 2일 이상 쌓이면 추이가 표시됩니다"}
				</p>
			)}
			<p className="chart-note">
				평가금{compare ? " · 원금" : ""} · 일별 스냅샷 · 한국 시간 기준
				{data.length < periodDays ? ` · 최근 ${data.length}일 기록` : ""}
			</p>
		</section>
	);
}
