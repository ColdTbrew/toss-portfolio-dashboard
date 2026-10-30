import { useEffect, useState } from "react";
import { type RebalanceRow, rebalance } from "../lib/rebalance";
import {
	parseTargetDraft,
	type TargetsData,
	targetMessages,
} from "../lib/targets";
import {
	loadTargets,
	saveTargets,
	TargetsRequestError,
} from "../lib/targetsClient";
import type { PortfolioState } from "../lib/types";
import { Amount } from "./Amount";
import { AnalyticsEmpty, AnalyticsPanel } from "./AnalyticsPanel";
import { useMask } from "./MaskProvider";

const percent = (value: number | null) =>
	value === null ? "—" : `${value.toFixed(2)}%`;

export function RebalancePanel({
	state,
	initial,
}: {
	state: PortfolioState;
	initial?: TargetsData;
}) {
	const { masked } = useMask();
	const [data, setData] = useState(initial);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const [loadError, setLoadError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly starts a fresh request.
	useEffect(() => {
		if (initial) return;
		const abort = new AbortController();
		setLoadError(false);
		loadTargets(abort.signal)
			.then((next) => {
				if (!abort.signal.aborted) setData(next);
			})
			.catch(() => {
				if (!abort.signal.aborted) setLoadError(true);
			});
		return () => abort.abort();
	}, [initial, attempt]);
	const validation = parseTargetDraft(draft);
	const targets =
		editing && !validation.error ? validation.targets : (data?.targets ?? {});
	const calculation = rebalance(state, targets);
	// Keep saved, no-longer-held targets editable even while clearing their fields.
	const symbols = new Set(calculation.rows.map((row) => row.symbol));
	const rows = [
		...calculation.rows,
		...rebalance(state, data?.targets ?? {})
			.rows.filter((row) => !symbols.has(row.symbol))
			.map((row) => ({ ...row, targetPercent: null })),
	];
	const markets = new Map(
		state.holdings.map((row) => [row.symbol, row.market]),
	);
	const label = (row: RebalanceRow) =>
		row.symbol === "CASH"
			? "현금"
			: markets.get(row.symbol) === "KR"
				? row.name.length > 9
					? `${row.name.slice(0, 8)}…`
					: row.name
				: row.symbol;
	function edit() {
		setDraft(
			Object.fromEntries(
				Object.entries(data?.targets ?? {}).map(([symbol, value]) => [
					symbol,
					String(value),
				]),
			),
		);
		setMessage("");
		setEditing(true);
	}
	async function save() {
		if (saving || validation.error) return;
		setSaving(true);
		setMessage("");
		try {
			const saved = await saveTargets(validation.targets);
			setData({ ...saved, editable: true });
			setEditing(false);
			setMessage("저장했어요");
		} catch (cause) {
			if (cause instanceof TargetsRequestError && cause.status === 405) {
				setData((previous) =>
					previous ? { ...previous, editable: false } : previous,
				);
				setEditing(false);
				setMessage(targetMessages.readonly);
			} else
				setMessage(
					cause instanceof TargetsRequestError
						? cause.message
						: targetMessages.save,
				);
		} finally {
			setSaving(false);
		}
	}
	function needed(row: RebalanceRow) {
		if (row.neededKrw === null) return "—";
		if (row.symbol === "CASH")
			return masked ? "—" : <Amount value={row.neededKrw} signed />;
		const direction =
			row.neededKrw > 0 ? "매수" : row.neededKrw < 0 ? "매도" : "—";
		return (
			<>
				{direction}
				{!masked && (
					<>
						{" "}
						<Amount value={Math.abs(row.neededKrw)} />
						{row.shares !== null && row.neededKrw !== 0 && (
							<small>
								약 <Amount value={row.shares} quantity />
							</small>
						)}
					</>
				)}
			</>
		);
	}
	return (
		<AnalyticsPanel
			id="rebalance-heading"
			eyebrow="TARGET WEIGHTS"
			title="리밸런싱"
			info={`현재 비중은 현금 포함 총자산 기준입니다. 차이는 현재 비중 − 목표 비중입니다. ${masked ? "" : "필요 금액 = (목표 비중 − 현재 비중) × 총자산. 수량은 현재가와 중간환율 기준으로 미국은 0.01주, 국내는 1주 단위로 내림합니다. 순 필요 현금은 목표를 지정한 보유종목의 매수 금액 − 매도 금액이며, 현금 행은 목표 잔액 차이입니다. "}보유 정보가 없는 목표는 합계에만 포함합니다.`}
		>
			<div className="rebalance-actions">
				{data?.editable &&
					(editing ? (
						<>
							<button
								type="button"
								className="button primary-button"
								disabled={saving || !!validation.error}
								onClick={() => void save()}
							>
								{saving ? "저장 중…" : "저장"}
							</button>
							<button
								type="button"
								className="button"
								disabled={saving}
								onClick={() => {
									setEditing(false);
									setMessage("");
								}}
							>
								취소
							</button>
						</>
					) : (
						<button type="button" className="button" onClick={edit}>
							목표 편집
						</button>
					))}
				{data && !data.editable && (
					<p className="subtle">{targetMessages.readonly}</p>
				)}
			</div>
			{editing && (
				<p id="target-help" className="subtle rebalance-hint">
					빈칸은 미지정 · 합계 100% 이하 · 소수 둘째 자리까지
				</p>
			)}
			{editing && validation.error && (
				<p id="target-error" className="status-message" role="alert">
					{validation.error}
				</p>
			)}
			<output className="status-message">{message}</output>
			<div className="analytics-content">
				{!data ? (
					<AnalyticsEmpty loading={!loadError}>
						{targetMessages.load}
						<button
							type="button"
							className="button"
							onClick={() => setAttempt((value) => value + 1)}
						>
							다시 시도
						</button>
					</AnalyticsEmpty>
				) : !editing && !Object.keys(data.targets).length ? (
					<AnalyticsEmpty>
						목표 비중을 설정하면 차이를 확인할 수 있어요.
					</AnalyticsEmpty>
				) : (
					<section
						className="analytics-scroll"
						aria-label="리밸런싱 표"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus enables scrolling the table.
						tabIndex={0}
					>
						<table className="analytics-table rebalance-table">
							<thead>
								<tr>
									<th scope="col">종목</th>
									<th scope="col">현재 비중</th>
									<th scope="col">목표 비중</th>
									<th scope="col">차이</th>
									<th scope="col">{masked ? "방향" : "필요 금액"}</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row, index) => (
									<tr key={row.symbol}>
										<th scope="row" title={row.name}>
											{label(row)}
										</th>
										<td>{percent(row.currentPercent)}</td>
										<td>
											{editing ? (
												<>
													<input
														type="number"
														inputMode="decimal"
														min="0"
														max="100"
														step="0.01"
														placeholder="—"
														value={
															draft[row.symbol] === "invalid"
																? ""
																: (draft[row.symbol] ?? "")
														}
														disabled={saving}
														aria-label={`${row.symbol === "CASH" ? "현금" : row.symbol} 목표 비중 (%)`}
														aria-invalid={!!validation.fields[row.symbol]}
														aria-describedby={`target-help${validation.fields[row.symbol] ? ` target-field-${index}` : validation.error ? " target-error" : ""}`}
														onInput={(event) => {
															const text = event.currentTarget.validity.badInput
																? "invalid"
																: event.currentTarget.value;
															setDraft((previous) => ({
																...previous,
																[row.symbol]: text,
															}));
															setMessage("");
														}}
													/>
													{validation.fields[row.symbol] && (
														<small
															id={`target-field-${index}`}
															className="rebalance-field-error"
														>
															{validation.fields[row.symbol]}
														</small>
													)}
												</>
											) : (
												percent(row.targetPercent)
											)}
										</td>
										<td className="rebalance-drift">
											{row.driftPp === null
												? "—"
												: `${Math.abs(row.driftPp).toFixed(2)}%p${row.driftPp > 0 ? " 초과" : row.driftPp < 0 ? " 부족" : ""}`}
										</td>
										<td>{needed(row)}</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr>
									<th scope="row">합계</th>
									<td>미지정 {percent(calculation.untargetedPercent)}</td>
									<td>{percent(calculation.targetTotal)}</td>
									<td colSpan={2}>
										{masked ? (
											"—"
										) : (
											<>
												순 필요 현금{" "}
												{calculation.netCashNeededKrw === null ? (
													"—"
												) : (
													<Amount value={calculation.netCashNeededKrw} signed />
												)}
											</>
										)}
									</td>
								</tr>
							</tfoot>
						</table>
					</section>
				)}
			</div>
			<p className="chart-note analytics-note">
				참고용 계산이며 주문 기능은 없어요
				<br />
				미지정 종목은 계산에서 제외 · 차이는 손익이 아닌 목표 대비 비중
			</p>
		</AnalyticsPanel>
	);
}
