import { formatKrw, formatPercent } from "../lib/format";
import type { PortfolioState } from "../lib/types";
import { Amount } from "./Amount";

export const pnlClass = (value: number) =>
	value > 0 ? "profit" : value < 0 ? "loss" : "neutral";

export function SummaryCards({ state }: { state: PortfolioState }) {
	const { totals, cash, fx } = state;
	return (
		<section className="summary-grid" aria-label="자산 요약">
			<article className="summary-card primary-card">
				<p className="eyebrow">총자산</p>
				<h2>
					<Amount value={totals.totalAssetsKrw} />
				</h2>
				<p className="summary-detail">
					주식 <Amount value={totals.stocksEvalKrw} />
				</p>
				<p className="summary-detail">
					매입 <Amount value={totals.purchaseKrw} />
				</p>
			</article>
			<article className="summary-card">
				<p className="eyebrow">총 수익률</p>
				<h2 className={pnlClass(totals.returnRate)}>
					{formatPercent(totals.returnRate, true)}
				</h2>
				<p className={`summary-detail ${pnlClass(totals.profitLossKrw)}`}>
					<Amount value={totals.profitLossKrw} signed />
				</p>
				<p className="card-note">매입금액 대비 평가손익</p>
			</article>
			<article className="summary-card">
				<p className="eyebrow">오늘 손익</p>
				<h2 className={pnlClass(totals.dailyPlKrw)}>
					<Amount value={totals.dailyPlKrw} signed />
				</h2>
				<p className={`summary-detail ${pnlClass(totals.dailyPlRate)}`}>
					{formatPercent(totals.dailyPlRate, true)}
				</p>
				<p className="card-note">오늘의 주식 평가 변동</p>
			</article>
			<article className="summary-card">
				<p className="eyebrow">보유 현금</p>
				<h2>{cash ? <Amount value={cash.totalKrw} /> : "—"}</h2>
				<p className="summary-detail">
					KRW {cash ? <Amount value={cash.krw} /> : "—"}
				</p>
				<p className="summary-detail">
					USD {cash ? <Amount value={cash.usd} currency="USD" /> : "—"}
				</p>
			</article>
			<article className="summary-card">
				<p className="eyebrow">원·달러 환율</p>
				<h2>{fx ? formatKrw(fx.midRate) : "—"}</h2>
				<p className="summary-detail">1 USD 기준</p>
				<p className="card-note">중간환율로 원화 환산</p>
			</article>
		</section>
	);
}
