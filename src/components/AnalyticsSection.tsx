import type { AnalyticsData, PortfolioState, TrendPoint } from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { BenchmarkChart } from "./BenchmarkChart";
import { ContributionChart } from "./ContributionChart";
import { CorrelationMatrix } from "./CorrelationMatrix";
import { FxEffect } from "./FxEffect";
import { HoldingsHeatmap } from "./HoldingsHeatmap";
import { RebalancePanel } from "./RebalancePanel";
import { RiskMetrics } from "./RiskMetrics";

export function AnalyticsSection({
	state,
	points,
}: {
	state: PortfolioState;
	points: TrendPoint[];
}) {
	const data = usePollingJson<AnalyticsData>("/api/analytics", 1_800_000);
	return (
		<section className="analytics-section" aria-labelledby="analytics-heading">
			<div className="panel-heading">
				<div>
					<p className="eyebrow">ANALYTICS</p>
					<h2 id="analytics-heading">포트폴리오 분석</h2>
				</div>
			</div>
			<div className="analytics-grid">
				<ContributionChart state={state} data={data} />
				<HoldingsHeatmap state={state} data={data} />
				<BenchmarkChart points={points} data={data} />
				<FxEffect state={state} data={data} />
				<RiskMetrics state={state} points={points} data={data} />
				<CorrelationMatrix state={state} data={data} />
				<RebalancePanel state={state} />
			</div>
		</section>
	);
}
