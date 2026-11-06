// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { buildState } from "../src/lib/compute";
import type { PortfolioState } from "../src/lib/types";
import { NOW, rawFixture } from "./fixtures";

const intradayPayload = {
	previousClose: 9900,
	points: [
		{ t: "2026-10-29T00:30:00Z", close: 9900 },
		{ t: "2026-10-29T01:00:00Z", close: 9950 },
		{ t: "2026-10-29T01:30:00Z", close: 10000 },
	],
};

let container: HTMLDivElement;
let root: Root | undefined;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	localStorage.setItem("tpd:maskAmounts", "false");
	request = vi.fn(async () => Response.json(intradayPayload));
	vi.stubGlobal("fetch", request);
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	container.remove();
	localStorage.clear();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const render = (state: PortfolioState) =>
	act(() =>
		root?.render(
			<MaskProvider>
				<HoldingsTable state={state} />
			</MaskProvider>,
		),
	);

const rows = () => [
	...container.querySelectorAll<HTMLElement>(
		".holdings-panel tbody tr:not(.holding-expand-row)",
	),
];
const expand = () =>
	container.querySelector<HTMLElement>(".holding-expand-row .holding-expand");
const intradayCalls = () =>
	request.mock.calls.filter(([url]) => String(url).includes("/api/intraday"));

const toggleRow = async (index = 0, key: "click" | "Enter" | " " = "click") => {
	const row = rows()[index];
	await act(async () => {
		row?.focus();
		row?.dispatchEvent(
			key === "click"
				? new MouseEvent("click", { bubbles: true })
				: new KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
	return row;
};

it("expands the row inline on click and Enter, fetching that symbol's intraday", async () => {
	const state = buildState(rawFixture(), { now: NOW });
	root = createRoot(container);
	await render(state);
	expect(expand()).toBeNull();
	expect(container.querySelector("dialog")).toBeNull();

	const row = await toggleRow(0, "click");
	expect(row?.getAttribute("aria-expanded")).toBe("true");
	expect(expand()?.querySelector(".holding-expand-chart")).toBeTruthy();
	expect(intradayCalls().map(([url]) => String(url))).toEqual([
		"/api/intraday?symbol=FAKEUS",
	]);
	await act(async () => {});
	expect(expand()?.textContent).toContain("$200.00");
	expect(expand()?.textContent).toContain("+$1.00");
	expect(expand()?.textContent).toContain("(+1.01%)");

	// Toggle closes; no drawer ever appears.
	await toggleRow(0, "click");
	expect(expand()).toBeNull();
	expect(row?.getAttribute("aria-expanded")).toBe("false");
	expect(container.querySelector("dialog")).toBeNull();

	await toggleRow(0, "Enter");
	expect(expand()).toBeTruthy();
	expect(intradayCalls()).toHaveLength(2);

	// Opening another row collapses the first (single accordion).
	await toggleRow(1, " ");
	expect(rows()[0]?.getAttribute("aria-expanded")).toBe("false");
	expect(rows()[1]?.getAttribute("aria-expanded")).toBe("true");
	expect(
		intradayCalls()
			.map(([url]) => String(url))
			.at(-1),
	).toBe("/api/intraday?symbol=FAKEKR");
	expect(container.querySelectorAll(".holding-expand-row")).toHaveLength(1);
});

it("shows the info grid and masks amounts while keeping the market price", async () => {
	localStorage.setItem("tpd:maskAmounts", "true");
	const state = buildState(rawFixture(), { now: NOW });
	root = createRoot(container);
	await render(state);
	await toggleRow();
	await act(async () => {});
	const facts = expand()?.querySelector(".holding-expand-facts");
	expect(facts?.textContent).toContain("수량");
	expect(facts?.textContent).toContain("평균 단가");
	expect(facts?.textContent).toContain("평가 금액");
	expect(facts?.textContent).toContain("평가 손익");
	expect(facts?.textContent).toContain("비중");
	expect(facts?.textContent).toContain("오늘 손익");
	expect(facts?.textContent).toContain("•••••");
	expect(expand()?.textContent).toContain("$200.00");
});

it("refreshes the intraday series while expanded and stops after collapse", async () => {
	const state = buildState(rawFixture(), { now: NOW });
	root = createRoot(container);
	await render(state);
	await toggleRow();
	await act(async () => {});
	expect(intradayCalls()).toHaveLength(1);
	await act(async () => vi.advanceTimersByTimeAsync(60_000));
	expect(intradayCalls()).toHaveLength(2);
	await toggleRow();
	expect(expand()).toBeNull();
	await act(async () => vi.advanceTimersByTimeAsync(120_000));
	expect(intradayCalls()).toHaveLength(2);
});
