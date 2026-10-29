import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPercent } from "../lib/format";
import { ALLOCATION_COLORS, allocationSlices } from "../lib/shareCard";
import type { PortfolioState } from "../lib/types";

export function AllocationChart({ state }: { state: PortfolioState }) {
	const data = allocationSlices(state);
	return (
		<section className="panel" aria-labelledby="allocation-heading">
			<div className="panel-heading">
				<div>
					<p className="eyebrow">ALLOCATION</p>
					<h2 id="allocation-heading">자산 비중</h2>
				</div>
				<span className="subtle">현금 포함</span>
			</div>
			{data.length ? (
				<div className="allocation-content">
					<div className="donut-wrap">
						<ResponsiveContainer width="100%" height={240}>
							<PieChart accessibilityLayer>
								<Pie
									data={data}
									dataKey="weight"
									nameKey="name"
									innerRadius={72}
									outerRadius={101}
									paddingAngle={3}
									stroke="none"
									isAnimationActive={false}
								>
									{data.map((slice, index) => (
										<Cell key={slice.name} fill={ALLOCATION_COLORS[index]} />
									))}
								</Pie>
								<Tooltip
									formatter={(value) => formatPercent(Number(value))}
									contentStyle={{
										background: "var(--surface)",
										border: "1px solid var(--border)",
										borderRadius: 12,
										color: "var(--text)",
									}}
								/>
							</PieChart>
						</ResponsiveContainer>
						<div className="donut-center">
							<strong>
								100<span>%</span>
							</strong>
							<small>전체 자산</small>
						</div>
					</div>
					<ul className="allocation-legend">
						{data.map((slice, index) => (
							<li key={slice.name}>
								<span className="legend-name">
									<i style={{ background: ALLOCATION_COLORS[index] }} />
									{slice.name}
								</span>
								<strong>{formatPercent(slice.weight)}</strong>
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
