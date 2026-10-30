import { useState } from "react";
import { type ContributionPeriod, contributions } from "../lib/analytics";
import { formatPercent } from "../lib/format";
import type { AnalyticsData, PortfolioState } from "../lib/types";
import { Amount } from "./Amount";
import {
	AnalyticsEmpty,
	AnalyticsPanel,
	AnalyticsPeriods,
} from "./AnalyticsPanel";
import { useMask } from "./MaskProvider";
import { pnlClass } from "./SummaryCards";

export function ContributionChart({
	state,
	data,
}: {
	state: PortfolioState;
	data?: AnalyticsData;
}) {
	const { masked } = useMask();
	const [period, setPeriod] = useState<ContributionPeriod>("today");
	const rows = data ? contributions(state, data, period) : [];
	const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.amount ?? 0)));
	return (
		<AnalyticsPanel
			id="contribution-heading"
			eyebrow="PROFIT CONTRIBUTION"
			title="수익 기여도"
		>
			<AnalyticsPeriods
				label="수익 기여도 기간"
				value={period}
				onChange={setPeriod}
				options={[
					["today", "오늘"],
					[7, "1주"],
					[30, "1개월"],
					[90, "3개월"],
					["all", "전체"],
				]}
			/>
			<div className="analytics-content">
				{!rows.length ? (
					<AnalyticsEmpty loading={!data}>보유종목이 없습니다.</AnalyticsEmpty>
				) : (
					<ul className="contribution-list">
						{rows.map((row) => (
							<li key={row.symbol}>
								<span className="contribution-name" title={row.name}>
									{row.name}
								</span>
								<span className="contribution-track" aria-hidden="true">
									<span
										className={
											row.amount !== null && row.amount < 0
												? "contribution-bar negative"
												: "contribution-bar"
										}
										style={{
											width: `${(Math.abs(row.amount ?? 0) / maximum) * 50}%`,
										}}
									/>
								</span>
								<span className={pnlClass(row.amount ?? 0)}>
									{row.amount === null ? (
										"—"
									) : masked ? (
										row.contribution === null ? (
											"•••••"
										) : (
											`${formatPercent(row.contribution, true)}p`
										)
									) : (
										<Amount value={row.amount} signed />
									)}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<p className="chart-note analytics-note">
				{period === "today"
					? "오늘 손익 · 미국 종목은 현재 중간환율로 환산"
					: period === "all"
						? "미국 평가손익은 현재 중간환율로 환산"
						: "현재 보유 수량을 기간 내내 보유했다고 가정한 추정치 · 최근 일봉 기준 · 과거 환율 누락 시 현재 중간환율 적용"}
				{masked &&
					(period === "all"
						? " · 총 매입금액 대비 기여도 (%p)"
						: " · 기간 시작 주식 평가금 대비 기여도 (%p)")}
			</p>
		</AnalyticsPanel>
	);
}
