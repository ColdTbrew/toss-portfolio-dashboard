import { createContext, type ReactNode, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AllocationChart } from "../src/components/AllocationChart";
import { Amount, formatAmount } from "../src/components/Amount";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { PnlBarChart } from "../src/components/PnlBarChart";
import { PrincipalChart } from "../src/components/PrincipalChart";
import { SummaryCards } from "../src/components/SummaryCards";
import { TrendChart } from "../src/components/TrendChart";
import {
	formatKrw,
	formatKrwManwon,
	formatPercent,
	formatUsd,
} from "../src/lib/format";
import { privacyFixture, privacyTrend, privateValues } from "./privacyFixture";

// Recharts mounts SVG after layout. Expose its client payloads and tooltip/axis
// formatter output here so SSR assertions also detect hidden chart data leaks.
vi.mock("recharts", () => {
	type Datum = {
		name?: string;
		date?: string;
		value?: number;
		weight?: number;
	};
	const Data = createContext<Datum[]>([]);
	function Chart({
		data = [],
		children,
	}: {
		data?: Datum[];
		children?: ReactNode;
	}) {
		return (
			<Data.Provider value={data}>
				<div data-chart={JSON.stringify(data)}>{children}</div>
			</Data.Provider>
		);
	}
	function Tooltip({
		formatter,
		content,
	}: {
		formatter?: (value: number) => string;
		content?: (props: { active: boolean; label?: string }) => ReactNode;
	}) {
		return (
			<div>
				{useContext(Data).map((row, index) => (
					<span key={row.name ?? row.date ?? index}>
						{content
							? content({ active: true, label: row.date })
							: formatter?.(row.value ?? row.weight ?? 0)}
					</span>
				))}
			</div>
		);
	}
	function Axis({
		tickFormatter,
		dataKey,
	}: {
		tickFormatter?: (value: number | string) => string;
		dataKey?: keyof Datum;
	}) {
		return (
			<div>
				{useContext(Data).map((row, index) => (
					<span key={row.name ?? row.date ?? index}>
						{tickFormatter?.(
							(dataKey ? row[dataKey] : (row.value ?? row.weight)) ?? 0,
						)}
					</span>
				))}
			</div>
		);
	}
	const Empty = () => null;
	return {
		ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
		BarChart: Chart,
		LineChart: Chart,
		PieChart: Chart,
		Pie: Chart,
		Tooltip,
		XAxis: Axis,
		YAxis: Axis,
		Bar: Empty,
		Line: Empty,
		Cell: Empty,
		CartesianGrid: Empty,
	};
});

function dashboard(masked?: boolean) {
	const state = privacyFixture();
	return renderToStaticMarkup(
		<MaskProvider initialMasked={masked}>
			<SummaryCards state={state} />
			<HoldingsTable state={state} />
			<AllocationChart state={state} />
			<PnlBarChart state={state} />
			<TrendChart points={privacyTrend} />
			<PrincipalChart totals={state.totals} points={privacyTrend} />
		</MaskProvider>,
	);
}

function representations(value: number) {
	return [
		...new Set([
			String(value),
			String(Math.round(value)),
			value.toFixed(2),
			new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 }).format(
				value,
			),
			formatKrw(value),
			formatKrw(value, true),
			formatKrwManwon(value),
			formatUsd(value),
			formatUsd(value, true),
		]),
	].flatMap((text) => [text, text.replaceAll(",", "")]);
}

describe("privacy rendering", () => {
	it.each([
		true,
		false,
	])("renders principal comparison safely for 0/1/2 points (masked=%s)", (masked) => {
		const { totals } = privacyFixture();
		for (const count of [0, 1, 2]) {
			const html = renderToStaticMarkup(
				<MaskProvider initialMasked={masked}>
					<PrincipalChart
						totals={totals}
						points={privacyTrend.slice(0, count)}
					/>
				</MaskProvider>,
			);
			expect(html).toContain("투자 자산 추이");
			expect(html).toContain(`최근 ${count}일 기록`);
			expect(html).toContain(
				formatPercent(
					(totals.stocksEvalKrw - totals.purchaseKrw) / totals.purchaseKrw,
					true,
				),
			);
			expect(html).not.toMatch(/NaN|Infinity/);
			if (count < 2) {
				expect(html).toContain(
					count === 0
						? "아직 일별 기록이 없습니다."
						: "기록이 2일 이상 쌓이면 추이가 표시됩니다",
				);
				expect(html).not.toContain("data-chart=");
			} else {
				expect(html).toContain("data-chart=");
				expect(html).not.toContain("empty-state");
				for (const point of privacyTrend) {
					expect(html).toContain(point.date);
					expect(html).toContain(
						formatPercent(
							(point.stocksEvalKrw - point.purchaseKrw) / point.purchaseKrw,
							true,
						),
					);
				}
			}
			if (masked) {
				expect(html).toContain("•••••");
				expect(html).not.toMatch(/[\d,]+(?:만)?원/);
				for (const value of privateValues())
					for (const text of representations(value))
						expect(html, text).not.toContain(text);
			} else {
				expect(html).toContain(formatKrw(totals.stocksEvalKrw));
				expect(html).toContain(
					formatKrw(totals.stocksEvalKrw - totals.purchaseKrw, true),
				);
				if (count === 2) {
					for (const point of privacyTrend) {
						expect(html).toContain(formatKrw(point.stocksEvalKrw));
						expect(html).toContain(formatKrw(point.purchaseKrw));
						expect(html).toContain(formatKrwManwon(point.stocksEvalKrw));
					}
				}
			}
		}
	});
	it("uses live totals for the principal header and ledger values for the tooltip", () => {
		const totals = { ...privacyFixture().totals, stocksEvalKrw: 79321567 };
		const html = renderToStaticMarkup(
			<MaskProvider initialMasked={false}>
				<PrincipalChart totals={totals} points={privacyTrend} />
			</MaskProvider>,
		);
		expect(html).toContain(formatKrw(totals.stocksEvalKrw));
		expect(html).toContain(
			formatKrw(totals.stocksEvalKrw - totals.purchaseKrw, true),
		);
		expect(html).toContain(
			formatPercent(
				(totals.stocksEvalKrw - totals.purchaseKrw) / totals.purchaseKrw,
				true,
			),
		);
		for (const point of privacyTrend)
			expect(html).toContain(formatKrw(point.stocksEvalKrw));
		expect(html).toMatch(/type="checkbox" checked=""/);
		expect(html).toMatch(/aria-pressed="true">1달/);
	});
	it("does not borrow an older point when the selected month has only one record", () => {
		const html = renderToStaticMarkup(
			<MaskProvider>
				<PrincipalChart
					totals={privacyFixture().totals}
					points={[{ ...privacyTrend[0], date: "2026-08-01" }, privacyTrend[1]]}
				/>
			</MaskProvider>,
		);
		expect(html).toContain("기록이 2일 이상 쌓이면 추이가 표시됩니다");
		expect(html).toContain("최근 1일 기록");
		expect(html).not.toContain("data-chart=");
	});
	it.each([
		[0, 0, "neutral", "0.00%"],
		[1500000, 2000000, "loss", "-25.00%"],
	])("handles zero or losing principal comparisons", (value, principal, sign, rate) => {
		const html = renderToStaticMarkup(
			<MaskProvider>
				<PrincipalChart
					totals={{
						...privacyFixture().totals,
						stocksEvalKrw: value,
						purchaseKrw: principal,
					}}
					points={[]}
				/>
			</MaskProvider>,
		);
		expect(html).toContain(`class="${sign}"`);
		expect(html).toContain(rate);
		expect(html).not.toMatch(/NaN|Infinity/);
	});
	it.each([
		true,
		false,
	])("handles sparse history safely (masked=%s)", (masked) => {
		for (const count of [0, 1, 2]) {
			const points = privacyTrend.slice(0, count);
			const html = renderToStaticMarkup(
				<MaskProvider initialMasked={masked}>
					<TrendChart points={points} />
				</MaskProvider>,
			);
			const note = "기록이 2일 이상 쌓이면 추이가 표시됩니다";
			if (count < 2) {
				expect(html).toContain(note);
				expect(html).not.toContain("data-chart=");
			} else {
				expect(html).not.toContain(note);
				expect(html).toContain("data-chart=");
			}
			const latest = points.at(-1);
			if (latest) {
				expect(html).toContain(formatPercent(latest.returnRate, true));
			} else {
				expect(html).toContain("아직 일별 기록이 없습니다.");
			}
			if (masked) {
				expect(html).toMatch(/disabled=""[^>]*>총자산/);
				for (const value of privateValues())
					for (const text of representations(value))
						expect(html, text).not.toContain(text);
			}
		}
	});
	it("SSR is masked by default; no private amounts, quantities or average prices occur anywhere in the markup", () => {
		const html = dashboard();
		expect(html).toContain("data-chart=");
		expect(html).toBe(dashboard(true));
		expect(html).toContain("•••••");
		for (const value of privateValues())
			for (const text of representations(value))
				expect(html, text).not.toContain(text);
		expect(html).toContain(
			formatPercent(privacyFixture().totals.returnRate, true),
		);
		expect(html).toContain(formatPercent(privacyFixture().holdings[0].weight));
		expect(html).toContain("52,000원");
		expect(html).toContain("$212.50");
		expect(html).toContain("1,300원");
		expect(html).toContain("종목별 수익률");
		expect(html).toMatch(/disabled=""[^>]*>총자산/);
	});
	it("the same unmasked components expose the formatted values, so leak detection is effective", () => {
		const state = privacyFixture();
		const html = dashboard(false);
		for (const value of [
			state.totals.totalAssetsKrw,
			state.totals.stocksEvalKrw,
			state.totals.purchaseKrw,
			state.totals.profitLossKrw,
			state.totals.dailyPlKrw,
			state.cash?.krw,
			state.cash?.totalKrw,
		]) {
			expect(html).toContain(formatKrw(value ?? 0));
		}
		expect(html).toContain(formatUsd(state.cash?.usd ?? 0));
		for (const row of state.holdings) {
			for (const value of [
				row.avgPrice,
				row.evalAmount,
				row.profitLoss,
				row.dailyPl,
			])
				expect(html).toContain(
					formatAmount(value, { masked: false, currency: row.currency }),
				);
			expect(html).toContain(
				formatAmount(row.quantity, { masked: false, quantity: true }),
			);
			expect(html).toContain(formatKrw(row.evalKrw));
		}
		expect(html).not.toContain("•••••");
		expect(html).toContain("종목별 손익");
	});
	it("Amount never emits private props or attributes when masked, including all fixture values", () => {
		for (const value of privateValues()) {
			const html = renderToStaticMarkup(
				<MaskProvider>
					<Amount value={value} />
					<Amount value={value} currency="USD" />
					<Amount value={value} quantity />
				</MaskProvider>,
			);
			expect(html).toBe('<span class="amount">•••••</span>'.repeat(3));
			const visible = renderToStaticMarkup(
				<MaskProvider initialMasked={false}>
					<Amount value={value} />
				</MaskProvider>,
			);
			expect(visible).toContain(formatKrw(value));
		}
	});
});
