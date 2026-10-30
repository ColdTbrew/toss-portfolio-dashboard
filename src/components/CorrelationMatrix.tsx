import { useMemo, useState } from "react";
import { pairwiseCorrelation } from "../lib/analytics";
import type { AnalyticsData, HoldingRow, PortfolioState } from "../lib/types";
import {
	AnalyticsEmpty,
	AnalyticsPanel,
	AnalyticsPeriods,
} from "./AnalyticsPanel";

const label = (row: HoldingRow) =>
	row.market === "US"
		? row.symbol
		: row.name.length > 6
			? `${row.name.slice(0, 6)}…`
			: row.name;
export function CorrelationMatrix({
	state,
	data,
}: {
	state: PortfolioState;
	data?: AnalyticsData;
}) {
	const [period, setPeriod] = useState(120);
	const symbols = state.holdings.map((row) => row.symbol).join("|");
	const matrix = useMemo(() => {
		const held = symbols ? symbols.split("|") : [];
		return held.map((a, i) =>
			held.map((b, j) =>
				i === j
					? 1
					: pairwiseCorrelation(
							data?.candles[a] ?? [],
							data?.candles[b] ?? [],
							period,
						),
			),
		);
	}, [symbols, data, period]);
	return (
		<AnalyticsPanel
			id="correlation-heading"
			eyebrow="RETURN CORRELATION"
			title="상관관계"
			info="같은 날짜의 일별 단순 수익률을 종목 쌍별 공통 날짜로 맞춰 Pearson 상관계수를 계산합니다. 겹치는 수익률이 20개 미만이면 —로 표시합니다. 한국과 미국의 장 마감 시간이 달라 같은 날짜 비교에서 시장 간 상관관계가 낮게 측정될 수 있습니다."
		>
			<AnalyticsPeriods
				label="상관관계 기간"
				value={period}
				onChange={setPeriod}
				options={[
					[60, "3개월"],
					[120, "6개월"],
				]}
			/>
			<div className="analytics-content analytics-content-tall">
				{!data || !state.holdings.length ? (
					<AnalyticsEmpty loading={!data}>보유종목이 없습니다.</AnalyticsEmpty>
				) : (
					<section
						className="analytics-scroll matrix-scroll"
						aria-label="종목 수익률 상관관계 행렬"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling the table.
						tabIndex={0}
					>
						<table className="analytics-table correlation-table">
							<thead>
								<tr>
									<th scope="col">종목</th>
									{state.holdings.map((row) => (
										<th key={row.symbol} scope="col" title={row.name}>
											{label(row)}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{state.holdings.map((row, i) => (
									<tr key={row.symbol}>
										<th scope="row" title={row.name}>
											{label(row)}
										</th>
										{state.holdings.map((other, j) => {
											const value = matrix[i][j];
											const fill =
												value === null
													? undefined
													: `color-mix(in srgb, var(${value >= 0 ? "--profit" : "--loss"}) ${Math.abs(value) * 40}%, var(--surface))`;
											return (
												<td
													key={other.symbol}
													style={{ background: fill }}
													title={`${row.name} · ${other.name}`}
												>
													{value === null ? "—" : value.toFixed(2)}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</section>
				)}
			</div>
			<p className="chart-note analytics-note">
				최근 {period}거래일 · −1.00 ~ +1.00 · 양수는 빨강, 음수는 파랑 · %
				수익률의 동행 정도
			</p>
		</AnalyticsPanel>
	);
}
