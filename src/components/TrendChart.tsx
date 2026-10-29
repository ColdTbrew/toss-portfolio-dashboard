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
import { formatPercent } from "../lib/format";
import type { TrendPoint } from "../lib/types";
import { formatAmount } from "./Amount";
import { useMask } from "./MaskProvider";
import { pnlClass } from "./SummaryCards";

export function TrendChart({ points }: { points: TrendPoint[] }) {
	const { masked } = useMask();
	const [selection, setSelection] = useState<"rate" | "assets">("rate");
	const mode = masked ? "rate" : selection;
	const data = points.map((point) => ({
		date: point.date,
		value: mode === "rate" ? point.returnRate : point.totalAssetsKrw,
	}));
	const format = (value: number) =>
		mode === "rate"
			? formatPercent(value, true)
			: formatAmount(value, { masked });
	const latest = data.at(-1);
	return (
		<section className="panel trend-panel" aria-labelledby="trend-heading">
			<div className="panel-heading">
				<div>
					<p className="eyebrow">PORTFOLIO HISTORY</p>
					<h2 id="trend-heading">
						{mode === "rate" ? "수익률" : "총자산"} 추이{" "}
						{latest && (
							<span
								className={`trend-value ${mode === "rate" ? pnlClass(latest.value) : ""}`}
							>
								{format(latest.value)}
							</span>
						)}
					</h2>
				</div>
				<fieldset className="segmented" aria-label="추이 표시 기준">
					<button
						type="button"
						aria-pressed={mode === "rate"}
						onClick={() => setSelection("rate")}
					>
						수익률
					</button>
					<button
						type="button"
						aria-pressed={mode === "assets"}
						disabled={masked}
						onClick={() => setSelection("assets")}
					>
						총자산
					</button>
				</fieldset>
			</div>
			{data.length ? (
				<ResponsiveContainer width="100%" height={240}>
					<LineChart
						key={mode}
						data={data}
						margin={{ top: 16, right: 16, left: 18, bottom: 4 }}
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
							minTickGap={36}
							tick={{ fontSize: 11, fill: "var(--muted)" }}
							axisLine={false}
							tickLine={false}
						/>
						<YAxis
							domain={["auto", "auto"]}
							width={mode === "assets" ? 96 : 65}
							tickFormatter={format}
							tick={{ fontSize: 11, fill: "var(--muted)" }}
							axisLine={false}
							tickLine={false}
						/>
						<Tooltip
							formatter={(value) => format(Number(value))}
							contentStyle={{
								background: "var(--surface)",
								border: "1px solid var(--border)",
								borderRadius: 12,
								color: "var(--text)",
							}}
						/>
						<Line
							type="monotone"
							dataKey="value"
							name={mode === "rate" ? "수익률" : "총자산"}
							stroke="var(--accent)"
							strokeWidth={2.5}
							dot={data.length === 1}
							activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--surface)" }}
							isAnimationActive={false}
						/>
					</LineChart>
				</ResponsiveContainer>
			) : (
				<p className="empty-state">
					아직 일별 기록이 없습니다. 첫 스냅샷이 쌓이면 추이가 표시됩니다.
				</p>
			)}
			<p className="chart-note">
				일별 스냅샷 · 한국 시간 기준
				{masked ? " · 금액을 가리는 동안 수익률로 표시됩니다" : ""}
			</p>
		</section>
	);
}
