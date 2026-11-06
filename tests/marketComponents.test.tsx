// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { IntradaySpark } from "../src/components/IntradaySpark";
import { MarketStrip } from "../src/components/MarketStrip";
import { MaskProvider } from "../src/components/MaskProvider";
import { Sparkline } from "../src/components/Sparkline";
import type { MarketState } from "../src/lib/types";
import { deferred } from "./fixtures";
import { privacyFixture, privateValues } from "./privacyFixture";

const market: MarketState = {
	fetchedAt: "2026-10-29T00:00:00Z",
	items: [
		{
			id: "^IXIC",
			label: "나스닥",
			value: 18500.25,
			change: 100,
			changeRate: 0.01,
			asOf: "2026-10-29T00:00:00Z",
		},
		{
			id: "CL=F",
			label: "WTI",
			value: 72.4,
			currency: "USD",
			change: -1,
			changeRate: -0.02,
			asOf: "2026-10-29T00:00:00Z",
			stale: true,
		},
		{
			id: "USD/KRW",
			label: "달러/원",
			value: 1350.5,
			currency: "KRW",
			change: null,
			changeRate: null,
			asOf: "2026-10-29T00:00:00Z",
		},
	],
};
let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
	vi.useFakeTimers();
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

it.each([
	[[10, 15, 20], "profit"],
	[[20, 15, 10], "loss"],
	[[10, 10, 10], "profit"],
	[[10, 8, 10], "profit"],
])("uses direction colour for %j without printing candle amounts", (closes, colour) => {
	container.innerHTML = renderToStaticMarkup(<Sparkline closes={closes} />);
	const svg = container.querySelector("svg");
	expect(svg?.classList.contains(colour)).toBe(true);
	expect(svg?.getAttribute("width")).toBe("72");
	expect(svg?.getAttribute("height")).toBe("24");
	expect(svg?.getAttribute("aria-hidden")).toBe("true");
	expect(container.querySelector("polyline")?.getAttribute("fill")).toBe(
		"none",
	);
	expect(
		container.querySelector("polyline")?.getAttribute("stroke-width"),
	).toBe("1.5");
	expect(container.textContent).toBe("");
	expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it("reserves the same SVG size for missing, single-point and invalid series", () => {
	for (const closes of [undefined, [], [10], [NaN, Infinity]]) {
		container.innerHTML = renderToStaticMarkup(<Sparkline closes={closes} />);
		expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
			"0 0 72 24",
		);
		expect(container.querySelector("polyline")).toBeNull();
	}
});

it("keeps market prices visible when masked but never emits personal KRW values or candle amounts", () => {
	const closes = [7151625, 6282152, 67327299];
	const render = (masked: boolean) =>
		renderToStaticMarkup(
			<MaskProvider initialMasked={masked}>
				<MarketStrip initial={market} />
				<Sparkline closes={closes} />
			</MaskProvider>,
		);
	const html = render(true);
	expect(html).toBe(render(false));
	for (const value of [...closes, ...privateValues()]) {
		expect(html).not.toContain(String(value));
		expect(html).not.toContain(new Intl.NumberFormat("ko-KR").format(value));
	}
	expect(html).toContain("18,500.25");
	expect(html).toContain("$72.40");
	expect(html).toContain("₩1,350.50");
	expect(html).toContain('class="market-change profit">+1.00%');
	expect(html).toContain('class="market-change loss">-2.00%');
	expect(html).toContain('class="market-item stale"');
});

it("fetches sparklines once per table mount, reserves space, polls after 15 minutes and cleans up", async () => {
	const gate = deferred<Response>();
	const request = vi.fn<typeof fetch>(() =>
		gate.promise.then((response) => response.clone()),
	);
	vi.stubGlobal("fetch", request);
	root = createRoot(container);
	const state = privacyFixture();
	const render = () =>
		root?.render(
			<MaskProvider>
				<HoldingsTable state={state} />
			</MaskProvider>,
		);
	await act(render);
	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0][0]).toBe("/api/sparklines");
	expect(container.querySelectorAll(".holding-sparkline")).toHaveLength(2);
	expect(container.querySelectorAll("polyline")).toHaveLength(0);
	await act(async () =>
		gate.resolve(Response.json({ FAKEKR: [10, 20], FAKEUS: [20, 10] })),
	);
	expect(container.querySelectorAll(".holding-sparkline")).toHaveLength(2);
	expect(container.querySelectorAll("polyline")).toHaveLength(2);
	for (const value of privateValues(state))
		expect(container.innerHTML).not.toContain(String(value));
	await act(render);
	expect(request).toHaveBeenCalledTimes(1);
	await act(() => vi.advanceTimersByTimeAsync(899_999));
	expect(request).toHaveBeenCalledTimes(1);
	await act(() => vi.advanceTimersByTimeAsync(1));
	expect(request).toHaveBeenCalledTimes(2);
	await act(() => root?.unmount());
	root = undefined;
	expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
	await vi.advanceTimersByTimeAsync(900_000);
	expect(request).toHaveBeenCalledTimes(2);
});

it("SSR renders market data immediately and polls only after 60 seconds", async () => {
	const request = vi.fn<typeof fetch>(async () => Response.json(market));
	vi.stubGlobal("fetch", request);
	root = createRoot(container);
	await act(() => root?.render(<MarketStrip initial={market} />));
	expect(container.querySelectorAll(".market-item")).toHaveLength(3);
	expect(request).not.toHaveBeenCalled();
	await act(() => vi.advanceTimersByTimeAsync(59_999));
	expect(request).not.toHaveBeenCalled();
	await act(() => vi.advanceTimersByTimeAsync(1));
	expect(request).toHaveBeenCalledExactlyOnceWith(
		"/api/market",
		expect.objectContaining({ method: "GET" }),
	);
});

it("renders nothing until the first market response and retains data on refresh failure", async () => {
	const gate = deferred<Response>();
	const request = vi.fn<typeof fetch>(() => gate.promise);
	vi.stubGlobal("fetch", request);
	root = createRoot(container);
	await act(() => root?.render(<MarketStrip />));
	expect(container.innerHTML).toBe("");
	await act(async () => gate.resolve(Response.json(market)));
	expect(container.querySelectorAll(".market-item")).toHaveLength(3);
	request.mockRejectedValue(new Error("Network unavailable"));
	await act(() => vi.advanceTimersByTimeAsync(60_000));
	expect(container.querySelectorAll(".market-item")).toHaveLength(3);
});

it("draws a coloured intraday chart per index with a baseline at the previous close", () => {
	const withIntraday: MarketState = {
		fetchedAt: "2026-10-29T00:00:00Z",
		items: [
			{
				id: "^IXIC",
				label: "나스닥",
				value: 18600,
				change: 100,
				changeRate: 0.0054,
				asOf: "2026-10-29T00:00:00Z",
				previousClose: 18500,
				intraday: [
					{ t: 1, v: 18500 },
					{ t: 2, v: 18560 },
					{ t: 3, v: 18600 },
				],
			},
			{
				id: "^KS11",
				label: "코스피",
				value: 2600,
				change: -10,
				changeRate: -0.0038,
				asOf: "2026-10-29T00:00:00Z",
				previousClose: 2700,
				intraday: [
					{ t: 1, v: 2610 },
					{ t: 2, v: 2605 },
					{ t: 3, v: 2600 },
				],
			},
			{
				id: "USD/KRW",
				label: "달러/원",
				value: 1350.5,
				currency: "KRW",
				change: null,
				changeRate: null,
				asOf: "2026-10-29T00:00:00Z",
			},
		],
	};
	container.innerHTML = renderToStaticMarkup(
		<MarketStrip initial={withIntraday} />,
	);
	const charts = container.querySelectorAll("svg.market-intraday");
	expect(charts).toHaveLength(3);
	expect(charts[0].classList.contains("profit")).toBe(true);
	expect(charts[0].querySelector("polyline")).not.toBeNull();
	expect(charts[0].querySelector("line")).not.toBeNull();
	expect(charts[1].classList.contains("loss")).toBe(true);
	expect(charts[1].querySelector("polyline")).not.toBeNull();
	// 2700 sits outside the 2600-2610 session range, so no baseline is drawn.
	expect(charts[1].querySelector("line")).toBeNull();
	// FX keeps an empty, space-reserving slot.
	expect(charts[2].classList.contains("neutral")).toBe(true);
	expect(charts[2].querySelector("polyline")).toBeNull();
	expect(charts[2].getAttribute("width")).toBe("76");
	expect(charts[2].getAttribute("aria-hidden")).toBe("true");
	expect(container.textContent).not.toContain("NaN");
});

it("reserves chart size for missing or degenerate intraday series", () => {
	for (const props of [
		{},
		{ points: [] },
		{ points: [{ t: 1, v: 5 }] },
		{
			points: [
				{ t: Number.NaN, v: 5 },
				{ t: 2, v: Number.NaN },
			],
		},
	]) {
		container.innerHTML = renderToStaticMarkup(
			<IntradaySpark {...props} tone="neutral" />,
		);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("viewBox")).toBe("0 0 76 24");
		expect(svg?.getAttribute("aria-hidden")).toBe("true");
		expect(container.querySelector("polyline")).toBeNull();
		expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
	}
	container.innerHTML = renderToStaticMarkup(
		<IntradaySpark
			points={[
				{ t: 1, v: 5 },
				{ t: 2, v: 6 },
			]}
			previousClose={Number.NaN}
			tone="neutral"
		/>,
	);
	expect(container.querySelector("polyline")).not.toBeNull();
	expect(container.querySelector("line")).toBeNull();
	expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});
