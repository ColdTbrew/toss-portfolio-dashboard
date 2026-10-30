import { useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { ratio } from "../lib/compute";
import { formatPercent } from "../lib/format";
import type { AnalyticsData, PortfolioState } from "../lib/types";
import { formatAmount } from "./Amount";
import {
	AnalyticsEmpty,
	AnalyticsPanel,
	AnalyticsPeriods,
} from "./AnalyticsPanel";
import { useMask } from "./MaskProvider";

export function HoldingsHeatmap({
	state,
	data,
}: {
	state: PortfolioState;
	data?: AnalyticsData;
}) {
	const { masked } = useMask();
	const [period, setPeriod] = useState<"today" | "all">("today");
	const total = state.holdings.reduce(
		(sum, row) => sum + Math.max(0, row.evalKrw),
		0,
	);
	// Chart payloads contain weights, percentages and already masked display text only.
	const tiles = state.holdings
		.filter((row) => row.evalKrw > 0)
		.map((row) => {
			const change =
				period === "today"
					? ratio(row.dailyPl, row.evalAmount - row.dailyPl)
					: row.returnRate;
			const intensity = Math.min(
				1,
				Math.abs(change) / (period === "today" ? 0.05 : 0.5),
			);
			const weight = ratio(row.evalKrw, total);
			return {
				name: row.name,
				value: weight,
				change,
				weight,
				amount: masked ? undefined : formatAmount(row.evalKrw, { masked }),
				fill:
					Math.abs(change) < 0.0005
						? "var(--hover)"
						: `color-mix(in srgb, var(${change > 0 ? "--profit" : "--loss"}) ${18 + intensity * 40}%, var(--surface))`,
			};
		});
	return (
		<AnalyticsPanel
			id="heatmap-heading"
			eyebrow="HOLDINGS HEATMAP"
			title="히트맵"
		>
			<AnalyticsPeriods
				label="히트맵 기준"
				value={period}
				onChange={setPeriod}
				options={[
					["today", "오늘"],
					["all", "전체 수익률"],
				]}
			/>
			<div className="analytics-content">
				{!data || !tiles.length ? (
					<AnalyticsEmpty loading={!data}>보유종목이 없습니다.</AnalyticsEmpty>
				) : (
					<ResponsiveContainer width="100%" height="100%">
						<Treemap
							key={`${period}-${masked}`}
							data={tiles}
							dataKey="value"
							isAnimationActive={false}
							isUpdateAnimationActive={false}
							nodeGap={3}
							content={(node) => {
								if (node.depth === 0) return <g />;
								const { x, y, width, height, name } = node;
								const tile = tiles.find((tile) => tile.name === name);
								if (!tile) return <g />;
								const title = `${name} · 비중 ${formatPercent(tile.weight)} · ${formatPercent(tile.change, true)}${tile.amount ? ` · ${tile.amount}` : ""}`;
								const maxLength = Math.max(2, Math.floor((width - 16) / 12));
								return (
									<g>
										<title>{title}</title>
										<rect
											x={x}
											y={y}
											width={width}
											height={height}
											fill={tile.fill}
											rx={5}
										/>
										{width >= 62 && height >= 48 && (
											<text
												x={x + 8}
												y={y + height / 2 - (height >= 76 ? 10 : 2)}
												fill="var(--text)"
												fontSize={11}
											>
												<tspan>
													{name.length > maxLength
														? `${name.slice(0, maxLength - 1)}…`
														: name}
												</tspan>
												<tspan x={x + 8} dy={18} fontWeight={650}>
													{formatPercent(tile.change, true)}
												</tspan>
												{height >= 76 && width >= 80 && (
													<tspan x={x + 8} dy={18}>
														비중 {formatPercent(tile.weight)}
													</tspan>
												)}
											</text>
										)}
									</g>
								);
							}}
						>
							<Tooltip
								content={({ active, payload }) => {
									const tile = active
										? tiles.find(
												(tile) => tile.name === payload?.[0]?.payload?.name,
											)
										: undefined;
									return tile ? (
										<div className="principal-tooltip">
											<p>{tile.name}</p>
											<p>비중 {formatPercent(tile.weight)}</p>
											<p>수익률 {formatPercent(tile.change, true)}</p>
											{tile.amount && <p>평가금 {tile.amount}</p>}
										</div>
									) : null;
								}}
							/>
						</Treemap>
					</ResponsiveContainer>
				)}
			</div>
			<p className="chart-note analytics-note">
				면적은 주식 평가금 비중 · 빨강은 상승, 파랑은 하락 · 색 농도는{" "}
				{period === "today" ? "±5%" : "±50%"}에서 제한
			</p>
		</AnalyticsPanel>
	);
}
