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
import { Amount, formatAmount } from "./Amount";
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
	const latest = points.at(-1);
	const step = Math.max(1, Math.ceil((data.length - 1) / 4));
	const ticks = data
		.filter((_, index) => index % step === 0)
		.map((point) => point.date);
	return (
		<section className="panel trend-panel" aria-labelledby="trend-heading">
			<h2 id="trend-heading" className="sr-only">
				{mode === "rate" ? "수익률" : "총자산"} 추이
			</h2>
			<fieldset className="trend-tabs" aria-label="추이 표시 기준">
				<button
					type="button"
					aria-pressed={mode === "rate"}
					onClick={() => setSelection("rate")}
				>
					수익률{" "}
					<span
						className={`trend-value ${latest ? pnlClass(latest.returnRate) : ""}`}
					>
						{latest ? formatPercent(latest.returnRate, true) : "—"}
					</span>
				</button>
				<button
					type="button"
					aria-pressed={mode === "assets"}
					disabled={masked}
					onClick={() => setSelection("assets")}
				>
					총자산{" "}
					<span className="trend-value">
						{latest ? <Amount value={latest.totalAssetsKrw} /> : "—"}
					</span>
				</button>
			</fieldset>
			{data.length >= 2 ? (
				<div className="trend-plot">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							key={mode}
							data={data}
							margin={{ top: 16, right: 20, left: 0, bottom: 4 }}
							accessibilityLayer
						>
							<CartesianGrid stroke="var(--grid)" vertical={false} />
							<XAxis
								dataKey="date"
								tickFormatter={(date) =>
									String(date).slice(5).replace("-", ".")
								}
								ticks={ticks}
								minTickGap={16}
								tick={{ fontSize: 12, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								domain={["auto", "auto"]}
								width={mode === "assets" ? 104 : 64}
								tickCount={4}
								tickFormatter={format}
								tick={{ fontSize: 12, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<Tooltip
								formatter={(value) => format(Number(value))}
								contentStyle={{
									background: "var(--surface)",
									border: "1px solid var(--border)",
									borderRadius: "var(--radius-control)",
									color: "var(--text)",
								}}
							/>
							<Line
								type="linear"
								dataKey="value"
								name={mode === "rate" ? "수익률" : "총자산"}
								stroke="var(--text)"
								strokeWidth={2}
								dot={false}
								activeDot={{ r: 4, strokeWidth: 1, stroke: "var(--surface)" }}
								isAnimationActive={false}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			) : (
				<p className="empty-state">
					{!latest && "아직 일별 기록이 없습니다. "}
					기록이 2일 이상 쌓이면 추이가 표시됩니다
				</p>
			)}
			<p className="chart-note">
				일별 스냅샷 · 한국 시간 기준
				{masked ? " · 금액을 가리는 동안 수익률로 표시됩니다" : ""}
			</p>
		</section>
	);
}
