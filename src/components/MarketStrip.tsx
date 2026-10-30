import { formatPercent } from "../lib/format";
import type { MarketState } from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { pnlClass } from "./SummaryCards";

const number = new Intl.NumberFormat("ko-KR", {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export function MarketStrip({ initial }: { initial?: MarketState }) {
	const market = usePollingJson<MarketState>("/api/market", 60_000, initial);
	if (!market?.items.length) return null;
	return (
		<section className="market-strip" aria-label="시장 동향">
			{market.items.map((item) => (
				<div
					key={item.id}
					className={`market-item${item.stale ? " stale" : ""}`}
					title={item.stale ? "마지막으로 받은 시세" : undefined}
				>
					<p className="market-label">{item.label}</p>
					<p className="market-value">
						{item.currency === "USD" ? "$" : item.currency === "KRW" ? "₩" : ""}
						{number.format(item.value)}
					</p>
					<p className={`market-change ${pnlClass(item.changeRate ?? 0)}`}>
						{item.changeRate === null
							? "—"
							: formatPercent(item.changeRate, true)}
					</p>
				</div>
			))}
		</section>
	);
}
