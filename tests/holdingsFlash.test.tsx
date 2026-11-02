// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { buildState } from "../src/lib/compute";
import type { PortfolioState } from "../src/lib/types";
import { NOW, rawFixture } from "./fixtures";

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"fetch",
		vi.fn(() => new Promise<Response>(() => {})),
	);
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	container.remove();
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

function withPrice(state: PortfolioState, lastPrice: number, tick: string) {
	return {
		...state,
		holdings: state.holdings.map((row, index) =>
			index === 0 ? { ...row, lastPrice, lastTickAt: tick } : row,
		),
	};
}

it("flashes the desktop price cell and the mobile price on ticks (up = tick-up, down = tick-down)", async () => {
	const base = buildState(rawFixture(), { now: NOW });
	const price = base.holdings[0].lastPrice;
	root = createRoot(container);
	await render(base);
	expect(container.querySelectorAll(".tick-up, .tick-down")).toHaveLength(0);

	await render(withPrice(base, price + 100, "2026-01-01T00:00:01Z"));
	const up = container.querySelectorAll(".tick-up");
	expect([...up].map((node) => node.tagName)).toEqual(["SPAN", "TD"]);
	expect(up[0].textContent).toContain("현재가");
	expect(container.querySelectorAll(".tick-down")).toHaveLength(0);

	await act(() => vi.advanceTimersByTime(650));
	expect(container.querySelectorAll(".tick-up, .tick-down")).toHaveLength(0);

	await render(withPrice(base, price - 100, "2026-01-01T00:00:02Z"));
	expect(
		[...container.querySelectorAll(".tick-down")].map((node) => node.tagName),
	).toEqual(["SPAN", "TD"]);
	expect(container.querySelectorAll(".tick-up")).toHaveLength(0);
});
