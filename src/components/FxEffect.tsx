import { useState } from "react";
import { holdingFx, totalFx } from "../lib/analytics";
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

export function FxEffect({
	state,
	data,
}: {
	state: PortfolioState;
	data?: AnalyticsData;
}) {
	const { masked } = useMask();
	const [period, setPeriod] = useState(30);
	const rows = state.holdings
		.filter((row) => row.currency === "USD")
		.map((row) => ({
			name: row.name,
			symbol: row.symbol,
			effect: data ? holdingFx(row, data, period) : null,
		}));
	const total = totalFx(rows.map((row) => row.effect));
	const cells = (effect: ReturnType<typeof holdingFx>) =>
		(["price", "fx", "total"] as const).map((key) => (
			<td key={key} className={pnlClass(effect?.[key] ?? 0)}>
				{effect ? (
					<>
						{!masked && (
							<>
								<Amount value={effect[key]} signed />
								<br />
							</>
						)}
						{formatPercent(effect[`${key}Rate`], true)}
					</>
				) : (
					"—"
				)}
			</td>
		));
	return (
		<AnalyticsPanel
			id="fx-effect-heading"
			eyebrow="CURRENCY EFFECT"
			title="환율 효과"
			info="현재 수량을 계속 보유했다고 가정합니다. 가격 효과 = 수량 × (종가 변화) × 시작 환율, 환율 효과 = 수량 × 마지막 종가 × 환율 변화. 각 비율은 시작 평가금 대비입니다. 토스 보유 데이터에는 평균 매입 환율이 없어 매입 이후의 분해는 제공하지 않습니다. 과거 종가나 환율이 없으면 계산하지 않습니다."
		>
			<AnalyticsPeriods
				label="환율 효과 기간"
				value={period}
				onChange={setPeriod}
				options={[
					[7, "1주"],
					[30, "1개월"],
					[90, "3개월"],
					[180, "6개월"],
				]}
			/>
			<div className="analytics-content">
				{!data || !rows.length ? (
					<AnalyticsEmpty loading={!data}>
						미국 보유종목이 없습니다.
					</AnalyticsEmpty>
				) : (
					<section
						className="analytics-scroll"
						aria-label="환율 효과 표"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling the table.
						tabIndex={0}
					>
						<table className="analytics-table fx-table">
							<thead>
								<tr>
									<th scope="col">종목</th>
									<th scope="col">가격 효과</th>
									<th scope="col">환율 효과</th>
									<th scope="col">합계</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.symbol}>
										<th scope="row" title={row.name}>
											{row.symbol}
										</th>
										{cells(row.effect)}
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr>
									<th scope="row">전체 합계</th>
									{cells(total)}
								</tr>
							</tfoot>
						</table>
					</section>
				)}
			</div>
			<p className="chart-note analytics-note">
				최근 일봉 기준 · 현재 수량 고정 · 시작 평가금 대비 % · 누락 종목이
				있으면 합계도 —
			</p>
		</AnalyticsPanel>
	);
}
