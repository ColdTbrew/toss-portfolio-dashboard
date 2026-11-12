import { useState } from "react";
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
import type {
	MaskedRealizedData,
	RealizedData,
	RealizedPeriod,
} from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { formatAmount } from "./Amount";
import { useMask } from "./MaskProvider";

const periods = [
	["day", "일"],
	["week", "주"],
	["month", "월"],
	["year", "년"],
] as const;
const tone = (value: number) =>
	value > 0 ? "profit" : value < 0 ? "loss" : "neutral";

export function RealizedPanel() {
	const { masked } = useMask();
	const data = usePollingJson<RealizedData | MaskedRealizedData | null>(
		masked ? "/api/realized?masked=1" : "/api/realized",
		5 * 60_000,
		undefined,
		{ clearOnError: true },
	);
	const [period, setPeriod] = useState<RealizedPeriod>("day");
	const [expanded, setExpanded] = useState(false);
	const selectPeriod = (next: RealizedPeriod) => {
		if (next !== period) setExpanded(false);
		setPeriod(next);
	};
	if (!data || (!masked && data.masked)) return null;
	const total = data.totals[period];
	const rows = [...data.bySymbol[period]].sort((a, b) =>
		masked
			? Math.abs(b.rate) - Math.abs(a.rate)
			: Math.abs(b.realizedKrw ?? 0) - Math.abs(a.realizedKrw ?? 0),
	);
	// Only rates enter chart payloads when masked, including tooltip/accessibility data.
	const chart = data.buckets[period].map((bucket, i, buckets) => ({
		label: bucket.label,
		value: masked ? bucket.rate : (bucket.realizedKrw ?? 0),
		estimated: bucket.estimated,
		current: i === buckets.length - 1,
	}));
	const amount = (value: number | null, currency: "KRW" | "USD" = "KRW") =>
		formatAmount(value ?? 0, { masked, signed: true, currency });
	const chartFormat = (value: number) =>
		masked ? formatPercent(value, true) : amount(value);
	return (
		<section
			className="panel realized-panel"
			aria-labelledby="realized-heading"
		>
			<div className="panel-heading realized-heading">
				<div>
					<p className="eyebrow">REALIZED</p>
					<h2 id="realized-heading" title="결제일 기준 · 한국 시간">
						실현 손익
					</h2>
				</div>
				<div className="segmented" role="tablist" aria-label="실현 손익 기간">
					{periods.map(([key, label], index) => (
						<button
							key={key}
							type="button"
							role="tab"
							id={`realized-tab-${key}`}
							aria-selected={period === key}
							aria-controls="realized-content"
							tabIndex={period === key ? 0 : -1}
							onClick={() => selectPeriod(key)}
							onKeyDown={(event) => {
								const step =
									event.key === "ArrowRight"
										? 1
										: event.key === "ArrowLeft"
											? -1
											: 0;
								const next =
									event.key === "Home"
										? 0
										: event.key === "End"
											? 3
											: step
												? (index + step + 4) % 4
												: -1;
								if (next < 0) return;
								event.preventDefault();
								selectPeriod(periods[next][0]);
								document
									.getElementById(`realized-tab-${periods[next][0]}`)
									?.focus();
							}}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div
				id="realized-content"
				role="tabpanel"
				aria-labelledby={`realized-tab-${period}`}
			>
				<div className="realized-overview">
					<div className="realized-summary">
						<strong
							className={`realized-total ${masked ? "neutral" : tone(total.realizedKrw ?? 0)}`}
						>
							{amount(total.realizedKrw)}
						</strong>
						<div className="realized-meta">
							<strong className={tone(total.rate)}>
								{formatPercent(total.rate, true)}
							</strong>
							<span className="subtle">
								매도 {total.sellCount}건 · 결제일 기준
							</span>
						</div>
						<div className="realized-meta subtle">
							<span>KRW {amount(total.byCcy?.KRW ?? null)}</span>
							<span>USD {amount(total.byCcy?.USD ?? null, "USD")}</span>
						</div>
						<div className="realized-meta">
							{total.pending && (
								<span className="realized-chip">
									결제 대기 {amount(total.pendingKrw)}
								</span>
							)}
							{total.estimated && <span className="realized-chip">추정</span>}
						</div>
					</div>
					<div
						className="realized-chart"
						role="img"
						aria-label={`실현 ${masked ? "수익률" : "손익"} 추이 · 마지막 막대가 현재 기간`}
					>
						<ResponsiveContainer width="100%" height="100%">
							<BarChart
								key={masked ? "rate" : "amount"}
								data={chart}
								margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
								accessibilityLayer
							>
								<CartesianGrid
									stroke="var(--chart-grid)"
									vertical={false}
									strokeDasharray="3 5"
								/>
								<XAxis
									dataKey="label"
									axisLine={false}
									tickLine={false}
									minTickGap={24}
									tick={{ fill: "var(--muted)", fontSize: 11 }}
								/>
								<YAxis hide domain={["auto", "auto"]} />
								<Tooltip
									formatter={(value) => chartFormat(Number(value))}
									labelFormatter={(label, payload) =>
										`${label}${payload[0]?.payload.current ? " · 현재" : ""}${payload[0]?.payload.estimated ? " · 추정" : ""}`
									}
									cursor={{ fill: "var(--hover)" }}
									contentStyle={{
										background: "var(--surface)",
										border: "1px solid var(--border)",
										borderRadius: 12,
									}}
									itemStyle={{ color: "var(--text)" }}
									labelStyle={{ color: "var(--muted)" }}
								/>
								<Bar
									dataKey="value"
									name={masked ? "수익률" : "실현 손익"}
									radius={[3, 3, 3, 3]}
									maxBarSize={24}
									minPointSize={(value) => (value ? 3 : 0)}
									isAnimationActive={false}
								>
									{chart.map((row) => (
										<Cell
											key={row.label}
											fill={
												row.value > 0
													? "var(--profit)"
													: row.value < 0
														? "var(--loss)"
														: "var(--muted)"
											}
											fillOpacity={row.current ? 1 : 0.45}
										/>
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					</div>
				</div>
				{rows.length ? (
					<table id="realized-symbols" className="realized-table">
						<thead>
							<tr>
								<th scope="col">종목</th>
								<th scope="col">매도일</th>
								<th scope="col">수량</th>
								<th scope="col">실현 손익</th>
								<th scope="col">수익률</th>
							</tr>
						</thead>
						<tbody>
							{(expanded ? rows : rows.slice(0, 5)).map((row) => (
								<tr key={`${row.market}:${row.symbol}`}>
									<td className="realized-symbol">
										<span
											className={`market-icon ${row.market === "US" ? "us" : ""}`}
										>
											{row.market}
										</span>
										<div>
											<strong>{row.name}</strong>
											<small>
												<span className="realized-ticker" title={row.symbol}>
													{row.symbol}
												</span>
												{row.pending && (
													<>
														{" "}
														<span
															className="realized-chip realized-row-chip"
															title="결제 대기"
														>
															대기
														</span>
													</>
												)}
												{(row.estimated || row.fxEstimated) && (
													<>
														{" "}
														<span
															className="realized-chip realized-row-chip"
															title={
																row.fxEstimated ? "환율 추정" : "원가 추정"
															}
														>
															추정
														</span>
													</>
												)}
											</small>
										</div>
									</td>
									<td className="realized-date">
										최근 {row.lastSellDate.slice(5)}
										{row.sellCount > 1 && ` · ${row.sellCount}회`}
										<span className="realized-mobile-quantity">
											{" "}
											·{" "}
											{formatAmount(row.quantity ?? 0, {
												masked,
												quantity: true,
											})}
										</span>
									</td>
									<td className="realized-quantity">
										{formatAmount(row.quantity ?? 0, {
											masked,
											quantity: true,
										})}
									</td>
									<td
										className={`realized-profit ${masked ? "neutral" : tone(row.realizedKrw ?? 0)}`}
									>
										{amount(row.realized, row.currency)}
										{row.currency === "USD" && (
											<small>{amount(row.realizedKrw)}</small>
										)}
									</td>
									<td className={`realized-rate ${tone(row.rate)}`}>
										{formatPercent(row.rate, true)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className="empty-state">이 기간에 매도한 종목이 없어요</p>
				)}
				{rows.length > 5 && (
					<button
						type="button"
						className="realized-expand"
						aria-expanded={expanded}
						aria-controls="realized-symbols"
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? "접기" : `전체 ${rows.length}개 보기`}
					</button>
				)}
			</div>
		</section>
	);
}
