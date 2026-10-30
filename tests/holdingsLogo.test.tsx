// @vitest-environment jsdom

import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoldingsTable, StockLogo } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { buildState } from "../src/lib/compute";
import { NOW, rawFixture } from "./fixtures";

let container: HTMLDivElement;
let root: Root | undefined;
const row = buildState(rawFixture(), { now: NOW }).holdings[0];

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("renders same-origin lazy decorative logos with the initial market fallback and visible market text", () => {
	const state = buildState(rawFixture(), { now: NOW });
	const html = renderToStaticMarkup(
		<MaskProvider>
			<HoldingsTable state={state} />
		</MaskProvider>,
	);
	for (const symbol of ["FAKEKR", "FAKEUS"])
		expect(html).toContain(
			`src="/api/logo?symbol=${symbol}" alt="" loading="lazy" decoding="async"`,
		);
	expect(html).toContain('class="market-icon" aria-hidden="true">국<img');
	expect(html).toContain('class="market-icon us" aria-hidden="true">해<img');
	expect(html).toContain("FAKEKR · 국내");
	expect(html).toContain("FAKEUS · 미국");
	expect(html).not.toContain('class="loaded"');
});

it.each([
	{ state: "loaded", complete: true, naturalWidth: 24, loaded: true },
	{ state: "broken", complete: true, naturalWidth: 0, loaded: false },
	{ state: "pending", complete: false, naturalWidth: 0, loaded: false },
])("handles an image that is already $state before hydration", async ({
	complete,
	naturalWidth,
	loaded,
}) => {
	container.innerHTML = renderToString(<StockLogo row={row} />);
	const image = container.querySelector("img");
	if (!image) throw new Error("Missing SSR logo");
	vi.spyOn(image, "complete", "get").mockReturnValue(complete);
	vi.spyOn(image, "naturalWidth", "get").mockReturnValue(naturalWidth);
	if (complete) image.dispatchEvent(new Event(loaded ? "load" : "error"));
	expect(image.classList.contains("loaded")).toBe(false);
	expect(container.textContent).toBe("국");
	const onRecoverableError = vi.fn();
	await act(() => {
		root = hydrateRoot(container, <StockLogo row={row} />, {
			onRecoverableError,
		});
	});
	expect(container.querySelector("img")).toBe(image);
	expect(image.classList.contains("loaded")).toBe(loaded);
	expect(container.textContent).toBe(loaded ? "" : "국");
	expect(onRecoverableError).not.toHaveBeenCalled();
});

it("shows a later load and restores the market fallback on error", async () => {
	root = createRoot(container);
	await act(() => root?.render(<StockLogo row={row} />));
	const image = container.querySelector("img");
	if (!image) throw new Error("Missing logo");
	expect(container.textContent).toBe("국");
	await act(() => image.dispatchEvent(new Event("load")));
	expect(image.classList.contains("loaded")).toBe(true);
	expect(container.textContent).toBe("");
	await act(() => image.dispatchEvent(new Event("error")));
	expect(image.classList.contains("loaded")).toBe(false);
	expect(container.textContent).toBe("국");
});

it("resets a loaded logo on symbol changes and checks cached replacements", async () => {
	const complete = vi
		.spyOn(HTMLImageElement.prototype, "complete", "get")
		.mockReturnValue(true);
	const naturalWidth = vi
		.spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
		.mockReturnValue(24);
	root = createRoot(container);
	await act(() => root?.render(<StockLogo row={row} />));
	const image = container.querySelector("img");
	if (!image) throw new Error("Missing logo");
	expect(image.classList.contains("loaded")).toBe(true);
	complete.mockReturnValue(false);
	naturalWidth.mockReturnValue(0);
	const replacement = { ...row, symbol: "FAKEU3", market: "US" as const };
	await act(() => root?.render(<StockLogo row={replacement} />));
	expect(container.querySelector("img")).toBe(image);
	expect(image.getAttribute("src")).toBe("/api/logo?symbol=FAKEU3");
	expect(image.classList.contains("loaded")).toBe(false);
	expect(container.textContent).toBe("해");
	complete.mockReturnValue(true);
	naturalWidth.mockReturnValue(24);
	await act(() => root?.render(<StockLogo row={row} />));
	expect(image.classList.contains("loaded")).toBe(true);
	expect(container.textContent).toBe("");
});
