import { useState } from "react";
import { holdingRisk, portfolioRisk } from "../lib/analytics";
import { formatPercent } from "../lib/format";
import type { AnalyticsData, PortfolioState, TrendPoint } from "../lib/types";
import {
	AnalyticsEmpty,
	AnalyticsPanel,
	AnalyticsPeriods,
} from "./AnalyticsPanel";
import { snapshotMethod } from "./BenchmarkChart";
import { pnlClass } from "./SummaryCards";

export function RiskMetrics({
	state,
	points,
	data,
}: {
	state: PortfolioState;
	points: TrendPoint[];
	data?: AnalyticsData;
}) {
	const [period, setPeriod] = useState(90);
	const risk = portfolioRisk(points, period);
	const format = (value: number | null | undefined) =>
		value == null ? "—" : formatPercent(value);
	return (
		<AnalyticsPanel
			id="risk-heading"
			eyebrow="RISK METRICS"
			title="위험 지표"
			info={`${snapshotMethod} MDD는 기간 내 고점 대비 최대 하락률입니다. 포트폴리오는 연결 수익률, 종목은 현지 통화 종가의 일별 로그 수익률 표본 표준편차에 √252를 곱해 연환산합니다. 변동성은 수익률 기록이 20개 이상일 때 표시합니다.`}
		>
			<AnalyticsPeriods
				label="위험 지표 기간"
				value={period}
				onChange={setPeriod}
				options={[
					[90, "3개월"],
					[180, "6개월"],
					[0, "전체"],
				]}
			/>
			<div className="analytics-content analytics-content-tall">
				{!data ? (
					<AnalyticsEmpty loading />
				) : (
					<>
						<div className="portfolio-risk">
							{risk ? (
								<div className="risk-cards">
									{[
										["최대 낙폭", risk.mdd],
										["현재 낙폭", risk.current],
										["연환산 변동성", risk.volatility],
									].map(([label, value]) => (
										<div key={label} className="risk-card">
											<p className="subtle">{label}</p>
											<strong>{format(value as number | null)}</strong>
										</div>
									))}
								</div>
							) : (
								<AnalyticsEmpty>
									기록이 2일 이상 쌓이면 위험 지표가 표시됩니다
								</AnalyticsEmpty>
							)}
						</div>
						<p className="chart-note risk-hint">
							포트폴리오 변동성: {risk?.count ?? 0}개 수익률 기록 · 최소 20개
							필요
						</p>
						<section
							className="analytics-scroll"
							aria-label="종목별 위험 지표 표"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling the table.
							tabIndex={0}
						>
							<table className="analytics-table risk-table">
								<thead>
									<tr>
										<th scope="col">종목</th>
										<th scope="col">연환산 변동성</th>
										<th scope="col">MDD</th>
										<th scope="col">기간 수익률</th>
									</tr>
								</thead>
								<tbody>
									{state.holdings.map((row) => {
										const metric = holdingRisk(
											data.candles[row.symbol] ?? [],
											period,
										);
										return (
											<tr key={row.symbol}>
												<th scope="row" title={row.name}>
													{row.market === "US"
														? row.symbol
														: row.name.length > 9
															? `${row.name.slice(0, 8)}…`
															: row.name}
												</th>
												<td>{format(metric?.volatility)}</td>
												<td className={pnlClass(metric?.mdd ?? 0)}>
													{format(metric?.mdd)}
												</td>
												<td className={pnlClass(metric?.returnRate ?? 0)}>
													{format(metric?.returnRate)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
							{!state.holdings.length && (
								<AnalyticsEmpty>보유종목이 없습니다.</AnalyticsEmpty>
							)}
						</section>
					</>
				)}
			</div>
			<p className="chart-note analytics-note">
				종목 위험은 현지 통화 기준 · 전체는 최대 약 200거래일 · 배당·수량 변화
				미반영
			</p>
		</AnalyticsPanel>
	);
}
