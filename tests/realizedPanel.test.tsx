// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MaskProvider, useMask } from "../src/components/MaskProvider";
import { RealizedPanel } from "../src/components/RealizedPanel";
import { formatKrw, formatMoney, formatPercent } from "../src/lib/format";
import { GET } from "../src/routes/api/realized";
import { createMockRealized } from "../src/server/mock";

// Inspect exactly what reaches Recharts, even without browser layout in jsdom.
vi.mock("recharts", () => {
	const Wrap = ({ children }: { children?: ReactNode }) => (
		<div>{children}</div>
	);
	return {
		ResponsiveContainer: Wrap,
		Bar: ({
			minPointSize,
			children,
		}: {
			minPointSize: (value: number) => number;
			children: ReactNode;
		}) => (
			<div data-min-bar={minPointSize(0.001)} data-zero-bar={minPointSize(0)}>
				{children}
			</div>
		),
		BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
			<div data-chart={JSON.stringify(data)}>{children}</div>
		),
		Cell: ({
			fillOpacity,
			stroke,
		}: {
			fillOpacity: number;
			stroke?: string;
		}) => <span data-cell-opacity={fillOpacity} data-cell-stroke={stroke} />,
		CartesianGrid: () => null,
		XAxis: () => null,
		YAxis: () => null,
		Tooltip: () => null,
	};
});
const now = Date.parse("2026-11-12T08:00:00Z");
const data = createMockRealized(now);
let root: Root | undefined;
let container: HTMLDivElement;
function Toggle() {
	const { toggle } = useMask();
	return (
		<button type="button" onClick={toggle}>
			금액 가리기
		</button>
	);
}
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	localStorage.setItem("tpd:maskAmounts", "false");
	container = document.createElement("div");
	document.body.append(container);
});
afterEach(async () => {
	await act(() => root?.unmount());
	root = undefined;
	container.remove();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});
async function mount() {
	root = createRoot(container);
	await act(() =>
		root?.render(
			<MaskProvider>
				<Toggle />
				<RealizedPanel />
			</MaskProvider>,
		),
	);
}
it("renders day totals, pending/estimated chips, switches month rows and masks all periods", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(data)),
	);
	await mount();
	expect(
		container.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
	).toBe("일");
	expect(container.querySelector(".realized-total")?.textContent).toBe(
		formatKrw(data.totals.day.realizedKrw, true),
	);
	expect(container.querySelectorAll("tbody tr")).toHaveLength(
		data.bySymbol.day.length,
	);
	expect(container.textContent).toContain("결제 대기");
	expect(container.textContent).toContain("추정");
	const tabs = [
		...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	];
	await act(() => tabs[2].click());
	expect(container.querySelector(".realized-total")?.textContent).toBe(
		formatKrw(data.totals.month.realizedKrw, true),
	);
	expect(container.querySelectorAll("tbody tr")).toHaveLength(
		Math.min(5, data.bySymbol.month.length),
	);
	expect(data.bySymbol.month.length).toBeGreaterThan(data.bySymbol.day.length);
	const sorted = [...data.bySymbol.month].sort(
		(a, b) => Math.abs(b.realizedKrw) - Math.abs(a.realizedKrw),
	);
	expect(container.querySelector("tbody tr")?.textContent).toContain(
		sorted[0].symbol,
	);
	await act(() =>
		container.querySelector<HTMLButtonElement>("button")?.click(),
	);
	for (const [index, period] of (
		["day", "week", "month", "year"] as const
	).entries()) {
		await act(() => tabs[index].click());
		expect(container.innerHTML).not.toMatch(/\d[\d,]*원|\$[\d,]|\d[\d.,]*주/);
		expect(container.textContent).toContain(
			formatPercent(data.totals[period].rate, true),
		);
		for (const row of data.bySymbol[period]) {
			expect(container.textContent).not.toContain(
				formatMoney(row.realized, row.currency, true),
			);
		}
		const payload = JSON.parse(
			container.querySelector("[data-chart]")?.getAttribute("data-chart") ??
				"[]",
		);
		expect(payload.map((row: { value: number }) => row.value)).toEqual(
			data.buckets[period].map((row) => row.rate),
		);
	}
});
it("collapses to the five largest symbols, expands, and resets on click and keyboard period changes", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(data)),
	);
	await mount();
	const tabs = [
		...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
	];
	expect(container.querySelector(".realized-expand")).toBeNull();
	await act(() => tabs[3].click());
	const sorted = [...data.bySymbol.year].sort(
		(a, b) => Math.abs(b.realizedKrw) - Math.abs(a.realizedKrw),
	);
	expect(sorted.length).toBeGreaterThan(5);
	const visibleSymbols = () =>
		[...container.querySelectorAll("tbody .realized-symbol small")].map(
			(row) => row.textContent?.split(" ")[0],
		);
	expect(visibleSymbols()).toEqual(sorted.slice(0, 5).map((row) => row.symbol));
	const expand = () => {
		const button =
			container.querySelector<HTMLButtonElement>(".realized-expand");
		if (!button) throw new Error("Missing expand button");
		return button;
	};
	expect(expand().textContent).toBe(`전체 ${sorted.length}개 보기`);
	expect(expand().getAttribute("aria-expanded")).toBe("false");
	await act(() => expand().click());
	expect(visibleSymbols()).toEqual(sorted.map((row) => row.symbol));
	expect(expand().textContent).toBe("접기");
	expect(expand().getAttribute("aria-expanded")).toBe("true");
	for (const row of sorted) {
		const rendered = [...container.querySelectorAll("tbody tr")].find((tr) =>
			tr.textContent?.includes(row.symbol),
		);
		expect(rendered?.querySelector(".realized-date")?.textContent).toContain(
			`최근 ${row.lastSellDate.slice(5)}`,
		);
		if (row.sellCount > 1)
			expect(rendered?.textContent).toContain(`${row.sellCount}회`);
	}
	await act(() => expand().click());
	expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
	await act(() => expand().click());
	await act(() => tabs[2].click());
	expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
	expect(expand().getAttribute("aria-expanded")).toBe("false");
	await act(() => expand().click());
	await act(() =>
		tabs[2].dispatchEvent(
			new KeyboardEvent("keydown", { key: "End", bubbles: true }),
		),
	);
	expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
	expect(expand().getAttribute("aria-expanded")).toBe("false");
});
it("uses opacity for the current bucket and gives nonzero bars a visible minimum height", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json(data)),
	);
	await mount();
	const cells = [...container.querySelectorAll("[data-cell-opacity]")];
	expect(cells).toHaveLength(30);
	expect(cells.at(-1)?.getAttribute("data-cell-opacity")).toBe("1");
	expect(
		cells
			.slice(0, -1)
			.every((cell) => cell.getAttribute("data-cell-opacity") === "0.45"),
	).toBe(true);
	expect(container.querySelector("[data-cell-stroke]")).toBeNull();
	expect(
		container.querySelector("[data-min-bar]")?.getAttribute("data-min-bar"),
	).toBe("3");
	expect(
		container.querySelector("[data-zero-bar]")?.getAttribute("data-zero-bar"),
	).toBe("0");
});
it("polls only the realized route every 30 minutes and renders nothing for unavailable data", async () => {
	vi.useFakeTimers();
	const fetcher = vi.fn<typeof fetch>(
		async () => new Response(null, { status: 404 }),
	);
	vi.stubGlobal("fetch", fetcher);
	await mount();
	expect(container.querySelector("section")).toBeNull();
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"/api/realized",
		expect.objectContaining({ method: "GET" }),
	);
	fetcher.mockImplementation(async () => Response.json(data));
	await act(() => vi.advanceTimersByTimeAsync(1_800_000));
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(container.querySelector("section")).not.toBeNull();
	await act(() => root?.unmount());
	root = undefined;
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it("shows a short empty state", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({ ...data, bySymbol: { ...data.bySymbol, day: [] } }),
		),
	);
	await mount();
	expect(container.textContent).toContain("이 기간에 매도한 종목이 없어요");
});
it("keeps deterministic totals and current buckets consistent across KST and year boundaries", () => {
	for (const date of [
		now,
		Date.parse("2026-12-31T16:00:00Z"),
		Date.parse("2026-11-08T16:00:00Z"),
	]) {
		const sample = createMockRealized(date);
		expect(sample).toEqual(createMockRealized(date));
		expect(sample.buckets.day).toHaveLength(30);
		expect(sample.buckets.week).toHaveLength(12);
		expect(sample.buckets.month).toHaveLength(12);
		for (const period of ["day", "week", "month", "year"] as const) {
			const rows = sample.bySymbol[period];
			const total = sample.totals[period];
			expect(total.realizedKrw).toBe(
				rows.reduce((sum, row) => sum + row.realizedKrw, 0),
			);
			expect(total.sellCount).toBe(
				rows.reduce((sum, row) => sum + row.sellCount, 0),
			);
			expect(new Set(rows.map((row) => row.symbol)).size).toBe(rows.length);
			expect(total.costKrw).toBe(
				rows.reduce((sum, row) => sum + row.costKrw, 0),
			);
			for (const row of rows) {
				expect(row.rate).toBe(row.realizedKrw / row.costKrw);
				if (row.fxEstimated) expect(row.fxRate).toBeNull();
				expect(Math.abs(row.realized)).toBeLessThanOrEqual(
					row.sellCount * (row.currency === "USD" ? 300 : 300_000),
				);
			}
			expect(total.rate).toBe(total.realizedKrw / total.costKrw);
			expect(total.pendingKrw).toBe(
				rows.reduce((sum, row) => sum + row.pendingKrw, 0),
			);
			for (const ccy of ["KRW", "USD"] as const)
				expect(total.byCcy[ccy]).toBe(
					rows
						.filter((row) => row.currency === ccy)
						.reduce((sum, row) => sum + row.realized, 0),
				);
			expect(sample.buckets[period].at(-1)).toMatchObject({
				realizedKrw: total.realizedKrw,
				rate: total.rate,
				estimated: total.estimated,
			});
		}
		for (const bucket of sample.buckets.week)
			expect(new Date(`${bucket.key}T00:00:00Z`).getUTCDay()).toBe(1);
		expect(sample.buckets.day.some((row) => row.realizedKrw === 0)).toBe(true);
		expect(sample.bySymbol.day).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ market: "KR", pending: false }),
				expect.objectContaining({
					market: "US",
					pending: true,
					fxEstimated: true,
					fxRate: null,
				}),
			]),
		);
	}
});
it("provides plausible native amounts, dense recent sells, monthly history and repeated-symbol aggregates", () => {
	const sample = createMockRealized(now);
	const days = sample.buckets.day;
	const active = days.filter((row) => row.realizedKrw !== 0);
	expect(active).toHaveLength(11);
	expect(active.length).toBeLessThan(30);
	expect(days.some((row) => row.realizedKrw < 0)).toBe(true);
	expect(days.some((row) => row.realizedKrw > 0)).toBe(true);
	// Individual recent sell days stay in the native-currency design-review range.
	for (const day of days)
		expect(Math.abs(day.realizedKrw)).toBeLessThan(500_000);
	// At month end the entire recent window is the current calendar month.
	const monthEnd = createMockRealized(Date.parse("2026-11-30T08:00:00Z"));
	expect(monthEnd.totals.month.sellCount).toBe(12);
	expect(sample.buckets.month.every((row) => row.realizedKrw !== 0)).toBe(true);
	expect(sample.buckets.year.length).toBeGreaterThanOrEqual(3);
	expect(sample.buckets.year.every((row) => row.realizedKrw !== 0)).toBe(true);
	const repeated = sample.bySymbol.month.find(
		(row) => row.symbol === sample.bySymbol.day[0].symbol,
	);
	expect(repeated).toMatchObject({
		quantity: 20,
		realized: 145100,
		realizedKrw: 145100,
		costKrw: 480000,
		sellCount: 2,
		lastSellDate: "2026-11-10",
		pending: false,
		fxEstimated: false,
		fxRate: null,
	});
	const pending = sample.bySymbol.day.find((row) => row.pending);
	if (!pending) throw new Error("Missing pending sell");
	expect(pending.realized).toBe(125);
	expect(pending.currency).toBe("USD");
	const mixed = sample.bySymbol.year.find(
		(row) => row.symbol === pending.symbol,
	);
	expect(mixed?.sellCount).toBeGreaterThan(1);
	expect(mixed).toMatchObject({
		pending: true,
		fxEstimated: true,
		fxRate: null,
		pendingKrw: pending.realizedKrw,
	});
	const mixedSettled = sample.bySymbol.year.find(
		(row) => row.currency === "USD" && !row.fxEstimated && row.sellCount > 1,
	);
	expect(mixedSettled).toMatchObject({
		pending: false,
		fxEstimated: false,
		fxRate: null,
	});
	// With November's window fully in this year, month buckets also reconcile.
	expect(
		sample.buckets.month
			.filter((row) => row.key.startsWith("2026"))
			.reduce((sum, row) => sum + row.realizedKrw, 0),
	).toBe(sample.totals.year.realizedKrw);
});
it("serves fixtures only in mock mode and never fetches in real or proxy mode", async () => {
	const fetcher = vi.fn(() => {
		throw new Error("Network forbidden");
	});
	vi.stubGlobal("fetch", fetcher);
	vi.stubEnv("UPSTREAM_URL", undefined);
	vi.stubEnv("TOSS_MOCK", "1");
	expect(await (await GET()).json()).toMatchObject({ basis: "settlement" });
	vi.stubEnv("TOSS_MOCK", "0");
	expect((await GET()).status).toBe(404);
	vi.stubEnv("UPSTREAM_URL", "https://fake-upstream.invalid");
	expect((await GET()).status).toBe(404);
	expect(fetcher).not.toHaveBeenCalled();
});
