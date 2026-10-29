import { createContext, type ReactNode, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AllocationChart } from "../src/components/AllocationChart";
import { Amount, formatAmount } from "../src/components/Amount";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { PnlBarChart } from "../src/components/PnlBarChart";
import { SummaryCards } from "../src/components/SummaryCards";
import { TrendChart } from "../src/components/TrendChart";
import { formatKrw, formatPercent, formatUsd } from "../src/lib/format";
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
	function Tooltip({ formatter }: { formatter: (value: number) => string }) {
		return (
			<div>
				{useContext(Data).map((row, index) => (
					<span key={row.name ?? row.date ?? index}>
						{formatter(row.value ?? row.weight ?? 0)}
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
			formatUsd(value),
			formatUsd(value, true),
		]),
	].flatMap((text) => [text, text.replaceAll(",", "")]);
}

describe("privacy rendering", () => {
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
