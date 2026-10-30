import { useEffect, useRef, useState } from "react";
import { ratio } from "../lib/compute";
import { formatMoney, formatPercent } from "../lib/format";
import type { HoldingRow, PortfolioState, Sparklines } from "../lib/types";
import { usePollingJson } from "../lib/usePollingJson";
import { Amount } from "./Amount";
import { Sparkline } from "./Sparkline";
import { pnlClass } from "./SummaryCards";

type SortKey =
	| "name"
	| "quantity"
	| "avgPrice"
	| "lastPrice"
	| "evalKrw"
	| "profitLoss"
	| "returnRate"
	| "dailyPl"
	| "weight";
const columns: [SortKey, string][] = [
	["name", "종목"],
	["quantity", "수량"],
	["avgPrice", "평균가"],
	["lastPrice", "현재가"],
	["evalKrw", "평가금액 (원)"],
	["profitLoss", "손익"],
	["returnRate", "수익률"],
	["dailyPl", "오늘 손익"],
	["weight", "비중"],
];

export function StockLogo({ row }: { row: HoldingRow }) {
	const imageRef = useRef<HTMLImageElement>(null);
	const [loadedSymbol, setLoadedSymbol] = useState<string | null>(null);
	const loaded = loadedSymbol === row.symbol;
	useEffect(() => {
		const image = imageRef.current;
		// SSR images can finish loading before hydration attaches onLoad.
		setLoadedSymbol(
			image?.complete && image.naturalWidth > 0 ? row.symbol : null,
		);
	}, [row.symbol]);
	return (
		<span
			className={`market-icon${row.market === "US" ? " us" : ""}`}
			aria-hidden="true"
		>
			{!loaded && (row.market === "KR" ? "국" : "해")}
			<img
				ref={imageRef}
				src={`/api/logo?symbol=${encodeURIComponent(row.symbol)}`}
				alt=""
				loading="lazy"
				decoding="async"
				className={loaded ? "loaded" : ""}
				onLoad={() => setLoadedSymbol(row.symbol)}
				onError={() => setLoadedSymbol(null)}
			/>
		</span>
	);
}

function PriceCell({ row, fx }: { row: HoldingRow; fx?: number }) {
	const previous = useRef(row.lastPrice);
	const [flash, setFlash] = useState("");
	useEffect(() => {
		const direction = row.lastPrice - previous.current;
		previous.current = row.lastPrice;
		if (!direction || !row.lastTickAt) return;
		setFlash(direction > 0 ? "tick-up" : "tick-down");
		const timeout = setTimeout(() => setFlash(""), 650);
		return () => clearTimeout(timeout);
	}, [row.lastPrice, row.lastTickAt]);
	return (
		<td className={flash}>
			{formatMoney(row.lastPrice, row.currency)}
			{row.currency === "USD" && fx && (
				<small>{formatMoney(row.lastPrice * fx, "KRW")}</small>
			)}
		</td>
	);
}

export function HoldingsTable({ state }: { state: PortfolioState }) {
	const sparklines = usePollingJson<Sparklines>("/api/sparklines", 900_000);
	const [market, setMarket] = useState<"ALL" | "KR" | "US">("ALL");
	const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
		key: "evalKrw",
		asc: false,
	});
	const rows = state.holdings
		.filter((row) => market === "ALL" || row.market === market)
		.sort((a, b) => {
			const av = a[sort.key],
				bv = b[sort.key];
			const result =
				typeof av === "string" && typeof bv === "string"
					? av.localeCompare(bv, "ko")
					: Number(av) - Number(bv);
			return sort.asc ? result : -result;
		});
	return (
		<section
			className="panel holdings-panel"
			aria-labelledby="holdings-heading"
		>
			<div className="panel-heading">
				<div>
					<p className="eyebrow">MY STOCKS</p>
					<h2 id="holdings-heading">
						보유종목 <span className="count">{state.holdings.length}</span>
					</h2>
				</div>
				<fieldset className="segmented" aria-label="시장 필터">
					{(
						[
							["ALL", "전체"],
							["KR", "국내"],
							["US", "해외"],
						] as const
					).map(([value, label]) => (
						<button
							type="button"
							key={value}
							aria-pressed={market === value}
							onClick={() => setMarket(value)}
						>
							{label}
						</button>
					))}
				</fieldset>
			</div>
			<div className="table-scroll">
				<table>
					<thead>
						<tr>
							{columns.map(([key, label]) => (
								<th
									key={key}
									aria-sort={
										sort.key === key
											? sort.asc
												? "ascending"
												: "descending"
											: "none"
									}
								>
									<button
										type="button"
										onClick={() =>
											setSort({
												key,
												asc: sort.key === key ? !sort.asc : key === "name",
											})
										}
									>
										{label}{" "}
										<span aria-hidden="true">
											{sort.key === key ? (sort.asc ? "↑" : "↓") : "↕"}
										</span>
									</button>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={`${row.market}:${row.symbol}`}>
								<td>
									<div className="stock-name">
										<StockLogo row={row} />
										<div>
											<strong>{row.name}</strong>
											<small>
												{row.symbol} · {row.market === "KR" ? "국내" : "미국"}
											</small>
											<Sparkline closes={sparklines?.[row.symbol]} />
										</div>
									</div>
								</td>
								<td>
									<Amount value={row.quantity} quantity />
								</td>
								<td>
									<Amount value={row.avgPrice} currency={row.currency} />
								</td>
								<PriceCell row={row} fx={state.fx?.midRate} />
								<td>
									<Amount value={row.evalKrw} />
									{row.currency === "USD" && (
										<small>
											<Amount value={row.evalAmount} currency="USD" />
										</small>
									)}
								</td>
								<td className={pnlClass(row.profitLoss)}>
									<Amount
										value={row.profitLoss}
										currency={row.currency}
										signed
									/>
								</td>
								<td className={pnlClass(row.returnRate)}>
									{formatPercent(row.returnRate, true)}
								</td>
								<td className={pnlClass(row.dailyPl)}>
									<Amount value={row.dailyPl} currency={row.currency} signed />
									<small>
										{formatPercent(
											ratio(row.dailyPl, row.evalAmount - row.dailyPl),
											true,
										)}
									</small>
								</td>
								<td>{formatPercent(row.weight)}</td>
							</tr>
						))}
					</tbody>
				</table>
				{!rows.length && (
					<p className="empty-state">보유 중인 종목이 없습니다.</p>
				)}
			</div>
		</section>
	);
}
