import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ReferenceLine,
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
	const [axisWidth, setAxisWidth] = useState(164);
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
		<section className="panel" aria-labelledby="pnl-heading">
			<div className="panel-heading">
				<div>
					<h2 id="pnl-heading">종목별 {masked ? "수익률" : "손익"}</h2>
				</div>
				<span className="subtle">{masked ? "% 기준" : "원화 환산"}</span>
			</div>
			{data.length ? (
				<div className="bar-wrap">
					<ResponsiveContainer
						width="100%"
						height={Math.max(252, data.length * 20 + 32)}
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
							margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
							accessibilityLayer
						>
							<CartesianGrid stroke="var(--grid)" horizontal={false} />
							<XAxis
								type="number"
								tickFormatter={(value) =>
									masked
										? format(value)
										: `${formatAmount(value / 10000, { masked, signed: true }).replace("원", "만원")}`
								}
								tickCount={3}
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
							<ReferenceLine x={0} stroke="var(--control)" />
							<Tooltip
								formatter={(value) => format(Number(value))}
								cursor={false}
								contentStyle={{
									background: "var(--surface)",
									border: "1px solid var(--border)",
									borderRadius: "var(--radius-control)",
									color: "var(--text)",
								}}
							/>
							<Bar
								dataKey="value"
								name={masked ? "수익률" : "손익"}
								radius={1}
								barSize={12}
								isAnimationActive={false}
							>
								{data.map((row) => (
									<Cell
										key={row.name}
										fill={
											row.value > 0
												? "var(--profit)"
												: row.value < 0
													? "var(--loss)"
													: "var(--neutral-num)"
										}
									/>
								))}
							</Bar>
						</BarChart>
					</ResponsiveContainer>
				</div>
			) : (
				<p className="empty-state">보유종목이 없습니다.</p>
			)}
		</section>
	);
}
