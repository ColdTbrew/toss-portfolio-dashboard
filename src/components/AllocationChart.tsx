import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPercent } from "../lib/format";
import { allocationSlices } from "../lib/shareCard";
import type { PortfolioState } from "../lib/types";

export function AllocationChart({ state }: { state: PortfolioState }) {
	const data = allocationSlices(state);
	return (
		<section className="panel" aria-labelledby="allocation-heading">
			<div className="panel-heading">
				<div>
					<h2 id="allocation-heading">자산 비중</h2>
				</div>
				<span className="subtle">현금 포함</span>
			</div>
			{data.length ? (
				<div className="allocation-content">
					<div className="donut-wrap">
						<ResponsiveContainer width="100%" height={160}>
							<PieChart accessibilityLayer>
								<Pie
									data={data}
									dataKey="weight"
									nameKey="name"
									innerRadius={61}
									outerRadius={75}
									paddingAngle={1.5}
									stroke="none"
									isAnimationActive={false}
								>
									{data.map((slice, index) => (
										<Cell key={slice.name} fill={`var(--alloc-${index + 1})`} />
									))}
								</Pie>
								<Tooltip
									formatter={(value) => formatPercent(Number(value))}
									contentStyle={{
										background: "var(--surface)",
										border: "1px solid var(--border)",
										borderRadius: "var(--radius-control)",
										color: "var(--text)",
									}}
								/>
							</PieChart>
						</ResponsiveContainer>
						<div className="donut-center">
							<small>
								{state.holdings.length}종목
								{state.cash && state.cash.totalKrw > 0 ? " + 현금" : ""}
							</small>
						</div>
					</div>
					<ul className="allocation-legend">
						{data.map((slice, index) => (
							<li key={slice.name}>
								<span className="legend-name">
									<i style={{ background: `var(--alloc-${index + 1})` }} />
									<span title={slice.name}>{slice.name}</span>
								</span>
								<span>{formatPercent(slice.weight)}</span>
							</li>
						))}
					</ul>
				</div>
			) : (
				<p className="empty-state">비중을 표시할 자산이 없습니다.</p>
			)}
		</section>
	);
}
