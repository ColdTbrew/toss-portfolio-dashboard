import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
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
					<p className="eyebrow">PERFORMANCE</p>
					<h2 id="pnl-heading">종목별 {masked ? "수익률" : "손익"}</h2>
				</div>
				<span className="subtle">{masked ? "% 기준" : "원화 환산"}</span>
			</div>
			{data.length ? (
				<div className="bar-wrap">
					<ResponsiveContainer
						width="100%"
						height={Math.max(260, data.length * 30)}
					>
						<BarChart
							key={masked ? "rate" : "amount"}
							data={data}
							layout="vertical"
							margin={{ left: 0, right: 20, top: 8, bottom: 0 }}
							accessibilityLayer
						>
							<CartesianGrid
								stroke="var(--border)"
								horizontal={false}
								strokeDasharray="3 5"
							/>
							<XAxis
								type="number"
								tickFormatter={format}
								tick={{ fontSize: 10, fill: "var(--muted)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis
								type="category"
								dataKey="name"
								width={114}
								tick={{ fontSize: 11, fill: "var(--muted)" }}
								tickFormatter={(name) => String(name).slice(0, 12)}
								axisLine={false}
								tickLine={false}
							/>
							<Tooltip
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
				</div>
			) : (
				<p className="empty-state">보유종목이 없습니다.</p>
			)}
		</section>
	);
}
