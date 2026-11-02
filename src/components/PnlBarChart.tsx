import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Text,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatPercent } from "../lib/format";
import type { PortfolioState } from "../lib/types";
import { formatAmount } from "./Amount";
import { useMask } from "./MaskProvider";

export function PnlBarChart({ state }: { state: PortfolioState }) {
	const { masked } = useMask();
	const [axisWidth, setAxisWidth] = useState(144);
	// Only the selected metric enters Recharts payloads, including accessibility and tooltips.
	const data = state.holdings
		.map((row) => ({
			name: row.name,
			value: masked
				? row.returnRate
				: row.profitLoss *
					(row.currency === "USD" ? (state.fx?.midRate ?? 0) : 1),
		}))
		.sort((a, b) => b.value - a.value);
	const format = (value: number) =>
		masked
			? formatPercent(value, true)
			: formatAmount(value, { masked, signed: true });
	return (
		<section className="panel pnl-panel" aria-labelledby="pnl-heading">
			<div className="panel-heading">
				<div>
					<p className="eyebrow">PERFORMANCE</p>
					<h2 id="pnl-heading">종목별 {masked ? "수익률" : "손익"}</h2>
				</div>
				<span className="subtle">{masked ? "% 기준" : "원화 환산"}</span>
			</div>
			{data.length ? (
				<section
					className="bar-wrap"
					aria-label={`종목별 ${masked ? "수익률" : "손익"} 차트`}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling every bar in a compact chart.
					tabIndex={0}
				>
					<ResponsiveContainer
						width="100%"
						height="100%"
						minHeight={data.length * 18 + 32}
						onResize={(width) =>
							setAxisWidth(
								Math.min(180, Math.max(112, Math.round(width * 0.36))),
							)
						}
					>
						<BarChart
							key={masked ? "rate" : "amount"}
							data={data}
							layout="vertical"
							margin={{ left: 0, right: 32, top: 8, bottom: 0 }}
							accessibilityLayer
						>
							<CartesianGrid
								stroke="var(--chart-grid)"
								horizontal={false}
								strokeDasharray="3 5"
							/>
							<XAxis
								type="number"
								tickCount={3}
								minTickGap={16}
								tickFormatter={format}
								tick={{ fontSize: 12, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								type="category"
								dataKey="name"
								width={axisWidth}
								interval={0}
								tickMargin={8}
								tick={({ x, y, payload }) => (
									<g>
										<title>{String(payload.value)}</title>
										<Text
											x={x}
											y={y}
											width={axisWidth - 16}
											maxLines={1}
											breakAll
											textAnchor="end"
											verticalAnchor="middle"
											style={{ fontSize: 12 }}
											fill="var(--muted)"
										>
											{String(payload.value)}
										</Text>
									</g>
								)}
								axisLine={false}
								tickLine={false}
							/>
							<Tooltip
								itemStyle={{ color: "var(--text)" }}
								labelStyle={{ color: "var(--muted)" }}
								formatter={(value) => format(Number(value))}
								cursor={{ fill: "var(--hover)" }}
								contentStyle={{
									background: "var(--surface)",
									border: "1px solid var(--border)",
									borderRadius: 12,
									color: "var(--text)",
								}}
							/>
							<Bar
								dataKey="value"
								name={masked ? "수익률" : "손익"}
								radius={[4, 4, 4, 4]}
								barSize={13}
								isAnimationActive={false}
							>
								{data.map((row) => (
									<Cell
										key={row.name}
										fill={row.value >= 0 ? "var(--profit)" : "var(--loss)"}
									/>
								))}
							</Bar>
						</BarChart>
					</ResponsiveContainer>
				</section>
			) : (
				<p className="empty-state">보유종목이 없습니다.</p>
			)}
		</section>
	);
}
