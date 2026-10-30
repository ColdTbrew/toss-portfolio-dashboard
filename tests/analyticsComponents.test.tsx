// @vitest-environment jsdom
import { act, createContext, type ReactNode, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsSection } from "../src/components/AnalyticsSection";
import { BenchmarkChart } from "../src/components/BenchmarkChart";
import { ContributionChart } from "../src/components/ContributionChart";
import { CorrelationMatrix } from "../src/components/CorrelationMatrix";
import { FxEffect } from "../src/components/FxEffect";
import { HoldingsHeatmap } from "../src/components/HoldingsHeatmap";
import { MaskProvider } from "../src/components/MaskProvider";
import { RiskMetrics } from "../src/components/RiskMetrics";
import { buildState } from "../src/lib/compute";
import type { AnalyticsData } from "../src/lib/types";
import {
	createMockRaw,
	createMockTrend,
	mockHistory,
} from "../src/server/mock";
import { deferred, NOW } from "./fixtures";

// Exercise chart payloads, custom tiles, axes and every active tooltip even in SSR.
vi.mock("recharts", () => {
	type Datum = Record<string, unknown>;
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
	function Treemap({
		data,
		content,
		children,
	}: {
		data: Datum[];
		content: (node: Datum) => ReactNode;
		children: ReactNode;
	}) {
		return (
			<Chart data={data}>
				<svg>
					<title>모의 차트</title>
					{data.map((row, i) => (
						<g key={String(row.name)}>
							{content({
								...row,
								depth: 1,
								index: i,
								x: 0,
								y: 0,
								width: i === 0 ? 20 : 150,
								height: 100,
							})}
						</g>
					))}
				</svg>
				{children}
			</Chart>
		);
	}
	function Tooltip({
		formatter,
		content,
	}: {
		formatter?: (value: number) => ReactNode;
		content?: (props: unknown) => ReactNode;
	}) {
		return (
			<div>
				{useContext(Data).map((row, i) => (
					<div key={String(row.name ?? row.date ?? i)}>
						{content
							? content({
									active: true,
									label: row.date,
									payload: [{ payload: row }],
								})
							: Object.entries(row)
									.filter(([, value]) => typeof value === "number")
									.map(([key, value]) => (
										<span key={key}>{formatter?.(Number(value))}</span>
									))}
					</div>
				))}
			</div>
		);
	}
	function Axis({
		tickFormatter,
		dataKey,
	}: {
		tickFormatter?: (value: string | number) => ReactNode;
		dataKey?: string;
	}) {
		return (
			<div>
				{useContext(Data).map((row, i) => (
					<span key={String(row.date ?? i)}>
						{tickFormatter?.(
							dataKey
								? String(row[dataKey])
								: Number(row.portfolio ?? row.value ?? 0),
						)}
					</span>
				))}
			</div>
		);
	}
	const Empty = () => null;
	return {
		ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
		Treemap,
		LineChart: Chart,
		Tooltip,
		XAxis: Axis,
		YAxis: Axis,
		Line: Empty,
		CartesianGrid: Empty,
	};
});

const state = buildState(createMockRaw(NOW), { now: NOW, mock: true });
const points = createMockTrend(NOW);
const data: AnalyticsData = {
	fetchedAt: new Date(NOW).toISOString(),
	candles: Object.fromEntries(
		state.holdings.map((row) => [
			row.symbol,
			mockHistory(row.symbol, row.lastPrice, NOW),
		]),
	),
	benchmarks: {
		"^KS11": mockHistory("^KS11", 2650, NOW),
		"^GSPC": mockHistory("^GSPC", 5900, NOW),
		"^IXIC": mockHistory("^IXIC", 18500, NOW),
	},
	usdkrw: mockHistory("KRW=X", 1350, NOW),
};
const widgets = [
	{
		name: "수익 기여도",
		render: (value?: AnalyticsData) => (
			<ContributionChart state={state} data={value} />
		),
	},
	{
		name: "히트맵",
		render: (value?: AnalyticsData) => (
			<HoldingsHeatmap state={state} data={value} />
		),
	},
	{
		name: "벤치마크 비교",
		render: (value?: AnalyticsData) => (
			<BenchmarkChart points={points} data={value} />
		),
	},
	{
		name: "환율 효과",
		render: (value?: AnalyticsData) => <FxEffect state={state} data={value} />,
	},
	{
		name: "위험 지표",
		render: (value?: AnalyticsData) => (
			<RiskMetrics state={state} points={points} data={value} />
		),
	},
	{
		name: "상관관계",
		render: (value?: AnalyticsData) => (
			<CorrelationMatrix state={state} data={value} />
		),
	},
];
const amountPattern = /\d[\d,]*\s*(원|만원)|₩\s?\d|\$\s?\d/;
const render = (node: ReactNode, masked = true) =>
	renderToStaticMarkup(
		<MaskProvider initialMasked={masked}>{node}</MaskProvider>,
	);
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	localStorage.setItem("tpd:maskAmounts", "true");
	container = document.createElement("div");
	document.body.append(container);
});
afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	container.remove();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe.each(widgets)("$name", ({ name, render: widget }) => {
	it("renders data and masks amounts in all markup, chart payloads, titles and tooltips", () => {
		const html = render(widget(data));
		expect(html).toContain(name);
		expect(html).not.toMatch(amountPattern);
		expect(html).toMatch(/•••••|%/);
		expect(html).not.toMatch(/NaN|Infinity/);
		expect(html).not.toContain("분석 데이터를 불러오는 중입니다.");
	});
	it("keeps its content frame while waiting for analytics", () => {
		const html = render(widget());
		expect(html).toContain("analytics-content");
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toMatch(amountPattern);
	});
	it("keeps every period private and reacts to period controls", async () => {
		root = createRoot(container);
		await act(() => root?.render(<MaskProvider>{widget(data)}</MaskProvider>));
		const buttons = [
			...container.querySelectorAll<HTMLButtonElement>(".segmented button"),
		];
		for (const button of buttons) {
			await act(() => button.click());
			expect(button.getAttribute("aria-pressed")).toBe("true");
			expect(container.innerHTML).not.toMatch(amountPattern);
			expect(container.innerHTML).toMatch(/•••••|%/);
		}
	});
});
it.each([
	true,
	false,
])("benchmark and risk retain empty frames for zero/one distinct day (masked=%s)", (masked) => {
	for (const count of [0, 1]) {
		const sample = points.slice(0, count);
		expect(
			render(<BenchmarkChart points={sample} data={data} />, masked),
		).toContain("기록이 2일 이상 쌓이면 추이가 표시됩니다");
		const risk = render(
			<RiskMetrics state={state} points={sample} data={data} />,
			masked,
		);
		expect(risk).toContain("기록이 2일 이상 쌓이면 위험 지표가 표시됩니다");
		expect(risk).toContain("analytics-content-tall");
		expect(risk).not.toMatch(amountPattern);
	}
});
it("exposes amounts only when unmasked, including heatmap hover and tiny tile titles", () => {
	for (const widget of [widgets[0], widgets[1], widgets[3]]) {
		expect(render(widget.render(data), false)).toMatch(amountPattern);
		expect(render(widget.render(data))).not.toMatch(amountPattern);
	}
	for (const widget of [widgets[2], widgets[4], widgets[5]])
		expect(render(widget.render(data))).toBe(
			render(widget.render(data), false),
		);
	const heatmap = render(widgets[1].render(data));
	expect(heatmap).toContain(`<title>${state.holdings[0].name} · 비중`);
});
it("shows missing FX effects and totals as dashes without inventing amounts", () => {
	const html = render(
		<FxEffect state={state} data={{ ...data, usdkrw: [] }} />,
		false,
	);
	expect(html).toContain("전체 합계");
	expect(html).toContain(">—</td>");
	expect(html).not.toMatch(amountPattern);
});
it("shows diagonal 1.00 with absent pairwise data and contains table scrolling inside panels", () => {
	const html = render(
		<CorrelationMatrix state={state} data={{ ...data, candles: {} }} />,
	);
	expect(html).toContain(">1.00</td>");
	expect(html).toContain(">—</td>");
	expect(html).toContain("analytics-scroll matrix-scroll");
	expect(render(widgets[4].render(data))).toContain("analytics-scroll");
});
it("fetches same-origin analytics after mount, polls every 30 minutes and cleans up", async () => {
	vi.useFakeTimers();
	const gate = deferred<Response>();
	const request = vi.fn<typeof fetch>((url) =>
		url === "/api/targets"
			? Promise.resolve(
					Response.json({ targets: {}, updatedAt: null, editable: true }),
				)
			: gate.promise.then((response) => response.clone()),
	);
	vi.stubGlobal("fetch", request);
	root = createRoot(container);
	await act(() =>
		root?.render(
			<MaskProvider>
				<AnalyticsSection state={state} points={points} />
			</MaskProvider>,
		),
	);
	expect(container.querySelectorAll(".analytics-panel")).toHaveLength(7);
	expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(6);
	const analyticsCalls = () =>
		request.mock.calls.filter(([url]) => url === "/api/analytics");
	expect(analyticsCalls()).toEqual([
		["/api/analytics", expect.objectContaining({ method: "GET" })],
	]);
	expect(
		request.mock.calls.every(([url]) =>
			["/api/analytics", "/api/targets"].includes(String(url)),
		),
	).toBe(true);
	await act(async () => gate.resolve(Response.json(data)));
	expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
	await act(() => vi.advanceTimersByTimeAsync(1_799_999));
	expect(analyticsCalls()).toHaveLength(1);
	await act(() => vi.advanceTimersByTimeAsync(1));
	expect(analyticsCalls()).toHaveLength(2);
	await act(() => root?.unmount());
	root = undefined;
	expect(analyticsCalls()[0][1]?.signal?.aborted).toBe(true);
});
