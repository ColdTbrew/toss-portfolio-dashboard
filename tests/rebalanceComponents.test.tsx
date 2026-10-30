// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MaskProvider, useMask } from "../src/components/MaskProvider";
import { RebalancePanel } from "../src/components/RebalancePanel";
import { buildState } from "../src/lib/compute";
import { formatKrw } from "../src/lib/format";
import { rebalance } from "../src/lib/rebalance";
import { type TargetsData, targetMessages } from "../src/lib/targets";
import { deferred, NOW, rawFixture } from "./fixtures";

const state = buildState(rawFixture());
const initial: TargetsData = {
	targets: { FAKEKR: 20, FAKEUS: 70, CASH: 5 },
	updatedAt: new Date(NOW).toISOString(),
	editable: true,
};
const amountPattern = /\d[\d,]*\s*(원|만원)|₩\s?\d|\$\s?\d/;
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
	vi.restoreAllMocks();
});
function MaskToggle() {
	const { toggle } = useMask();
	return (
		<button type="button" onClick={toggle}>
			가리기 전환
		</button>
	);
}
async function mount(data?: TargetsData) {
	root = createRoot(container);
	await act(() =>
		root?.render(
			<MaskProvider>
				<MaskToggle />
				<RebalancePanel state={state} initial={data} />
			</MaskProvider>,
		),
	);
}
function button(text: string) {
	const node = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === text,
	);
	if (!node) throw new Error("Test button missing");
	return node;
}
const click = async (text: string) => act(() => button(text).click());
async function input(symbol: string, value: string) {
	const node = container.querySelector<HTMLInputElement>(
		`input[aria-label="${symbol} 목표 비중 (%)"]`,
	);
	if (!node) throw new Error("Test input missing");
	await act(() => {
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(node, value);
		node.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
function assertPrivate(html: string) {
	expect(html).not.toMatch(amountPattern);
	expect(html).not.toMatch(/약\s*(?:<[^>]+>)*\s*[\d,]+/);
	expect(html).not.toMatch(/[\d.,]+주/);
	for (const row of rebalance(state, initial.targets).rows) {
		if (row.neededKrw !== null)
			expect(html).not.toContain(formatKrw(Math.abs(row.neededKrw)));
	}
	expect(html).not.toMatch(/class="(?:profit|loss)"/);
}

it.each([
	true,
	false,
])("suppresses directions and partial amounts with missing FX (masked: %s), then restores them", async (masked) => {
	localStorage.setItem("tpd:maskAmounts", String(masked));
	const raw = rawFixture();
	raw.fx = null;
	root = createRoot(container);
	const render = (state: ReturnType<typeof buildState>) =>
		root?.render(
			<MaskProvider>
				<RebalancePanel state={state} initial={initial} />
			</MaskProvider>,
		);
	await act(() => render(buildState(raw)));
	expect(
		container.querySelector('[aria-live="polite"]')?.textContent,
	).toContain("자산 평가에 필요한 정보");
	for (const row of container.querySelectorAll("tbody tr")) {
		const cells = row.querySelectorAll("td");
		expect(cells[0].textContent).toBe("—");
		expect(cells[2].textContent).toBe("—");
		expect(cells[3].textContent).toBe("—");
	}
	expect(container.querySelector("tbody")?.textContent).toContain("70.00%");
	expect(container.querySelector("tbody")?.textContent).not.toMatch(
		/매수|매도/,
	);
	expect(container.innerHTML).not.toMatch(amountPattern);
	if (!masked)
		expect(container.querySelector("tfoot")?.textContent).toContain(
			"순 필요 현금 —",
		);
	await act(() => render(buildState(rawFixture())));
	expect(container.querySelector('[aria-live="polite"]')).toBeNull();
	expect(container.querySelector("tbody")?.textContent).toMatch(/매수/);
	expect(container.querySelector("tbody")?.textContent).toMatch(/매도/);
	if (!masked) expect(container.textContent).toContain("13,600원");
});

it("renders weights, drift, cash and totals, and emits no amounts in masked SSR markup or attributes", () => {
	const masked = renderToStaticMarkup(
		<MaskProvider>
			<RebalancePanel state={state} initial={initial} />
		</MaskProvider>,
	);
	assertPrivate(masked);
	for (const label of [
		"리밸런싱",
		"초과",
		"부족",
		"현금",
		"매수",
		"매도",
		"미지정 5.00%",
		"95.00%",
		"참고용 계산이며 주문 기능은 없어요",
	])
		expect(masked).toContain(label);
	expect(masked).toContain("analytics-scroll");
	const unmasked = renderToStaticMarkup(
		<MaskProvider initialMasked={false}>
			<RebalancePanel state={state} initial={initial} />
		</MaskProvider>,
	);
	expect(unmasked).toContain("13,600원");
	expect(unmasked).toContain("12,400원");
	expect(unmasked).toContain("0.04주");
	expect(unmasked).toContain("1주");
	expect(unmasked).toContain("순 필요 현금");
});

it("loads only its own API and aborts pending loads on unmount", async () => {
	const gate = deferred<Response>();
	const fetcher = vi.fn<typeof fetch>(() => gate.promise);
	vi.stubGlobal("fetch", fetcher);
	await mount();
	expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"/api/targets",
		expect.objectContaining({
			method: "GET",
			cache: "no-store",
			redirect: "error",
		}),
	);
	await act(() => gate.resolve(Response.json(initial)));
	expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
	assertPrivate(container.innerHTML);
	await act(() => root?.unmount());
	root = undefined;
	expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

it("validates edits inline, previews without amounts, saves once and preserves targets only in React state", async () => {
	const pending = deferred<Response>();
	const fetcher = vi.fn<typeof fetch>(() => pending.promise);
	vi.stubGlobal("fetch", fetcher);
	const storage = vi.spyOn(Storage.prototype, "setItem");
	await mount(initial);
	await click("목표 편집");
	expect(container.querySelectorAll('input[type="number"]')).toHaveLength(3);
	for (const value of ["-1", "101", "1.234"]) {
		await input("FAKEKR", value);
		expect(button("저장").disabled).toBe(true);
		expect(container.querySelector('[aria-invalid="true"]')).not.toBeNull();
		expect(container.textContent).toContain(targetMessages.percent);
		assertPrivate(container.innerHTML);
	}
	await input("FAKEKR", "30");
	expect(container.textContent).toContain(targetMessages.sum);
	expect(button("저장").disabled).toBe(true);
	await input("FAKEKR", "21.25");
	expect(button("저장").disabled).toBe(false);
	await click("저장");
	expect(button("저장 중…").disabled).toBe(true);
	expect(button("취소").disabled).toBe(true);
	expect(
		[...container.querySelectorAll("input")].every((node) => node.disabled),
	).toBe(true);
	expect(fetcher).toHaveBeenCalledExactlyOnceWith(
		"/api/targets",
		expect.objectContaining({
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ targets: { FAKEKR: 21.25, FAKEUS: 70, CASH: 5 } }),
		}),
	);
	await act(() =>
		pending.resolve(
			Response.json({
				version: 1,
				updatedAt: new Date(NOW).toISOString(),
				targets: { FAKEKR: 21.25, FAKEUS: 70, CASH: 5 },
			}),
		),
	);
	expect(container.textContent).toContain("저장했어요");
	expect(container.querySelector("input")).toBeNull();
	expect(container.textContent).toContain("21.25%");
	expect(storage).not.toHaveBeenCalled();
	assertPrivate(container.innerHTML);
});

it("cancels drafts, distinguishes blank from zero and keeps every edit private across mask toggles", async () => {
	const fetcher = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	await mount(initial);
	await click("목표 편집");
	await input("FAKEKR", "");
	const first = container.querySelector("tbody tr");
	expect(first?.textContent).not.toContain("매도");
	expect(first?.textContent).not.toContain("매수");
	await input("FAKEKR", "0");
	expect(first?.textContent).toContain("매도");
	assertPrivate(container.innerHTML);
	await click("가리기 전환");
	expect(container.innerHTML).toMatch(amountPattern);
	await click("가리기 전환");
	assertPrivate(container.innerHTML);
	await click("취소");
	expect(container.textContent).toContain("20.00%");
	await click("목표 편집");
	expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("20");
	expect(fetcher).not.toHaveBeenCalled();
});

it("shows an empty state with editing and allows removing all targets", async () => {
	const fetcher = vi.fn<typeof fetch>(async () =>
		Response.json({
			version: 1,
			targets: {},
			updatedAt: new Date(NOW).toISOString(),
		}),
	);
	vi.stubGlobal("fetch", fetcher);
	await mount({ ...initial, targets: {} });
	expect(container.textContent).toContain("목표 비중을 설정하면");
	await click("목표 편집");
	expect(container.querySelectorAll("input")).toHaveLength(3);
	expect(container.textContent).toContain("미지정 100.00%");
	await click("저장");
	expect(container.textContent).toContain("저장했어요");
	expect(container.textContent).toContain("목표 비중을 설정하면");
});

it("rejects native malformed numeric text even when the input value stays blank", async () => {
	await mount(initial);
	await click("목표 편집");
	await input("FAKEKR", "");
	const node = container.querySelector<HTMLInputElement>("input");
	if (!node) throw new Error("Test input missing");
	const validity = vi
		.spyOn(node, "validity", "get")
		.mockReturnValue({ ...node.validity, badInput: true });
	await act(() => node.dispatchEvent(new Event("input", { bubbles: true })));
	expect(button("저장").disabled).toBe(true);
	expect(node.getAttribute("aria-invalid")).toBe("true");
	assertPrivate(container.innerHTML);
	validity.mockRestore();
	await input("FAKEKR", "20");
	expect(button("저장").disabled).toBe(false);
});

it("keeps absent holdings visible so a saved target can be cleared", async () => {
	await mount({ ...initial, targets: { FAKEOTHER: 20 } });
	await click("목표 편집");
	await input("FAKEOTHER", "");
	expect(container.querySelectorAll("input")).toHaveLength(4);
	expect(container.textContent).toContain("미지정 100.00%");
});

it("hides editing for proxy responses and switches to read-only after a 405", async () => {
	await mount({ ...initial, editable: false });
	expect(container.textContent).toContain(targetMessages.readonly);
	expect(container.textContent).not.toContain("목표 편집");
	await act(() => root?.unmount());
	root = undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async () =>
			Response.json({ error: targetMessages.readonly }, { status: 405 }),
		),
	);
	await mount(initial);
	await click("목표 편집");
	await click("저장");
	expect(container.textContent).toContain(targetMessages.readonly);
	expect(container.textContent).not.toContain("목표 편집");
	expect(container.querySelector("input")).toBeNull();
});

it("shows known server errors without leaking arbitrary response amounts and retains the draft for retry", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			Response.json({ error: targetMessages.sum }, { status: 400 }),
		)
		.mockResolvedValueOnce(
			Response.json({ error: "FAKE_DETAIL 123,456원 $78.90" }, { status: 500 }),
		)
		.mockRejectedValueOnce(new Error("FAKE_NETWORK_DETAIL"));
	vi.stubGlobal("fetch", fetcher);
	await mount(initial);
	await click("목표 편집");
	await click("저장");
	expect(container.textContent).toContain(targetMessages.sum);
	expect(button("저장").disabled).toBe(false);
	await click("저장");
	expect(container.textContent).toContain(targetMessages.save);
	expect(container.textContent).not.toContain("FAKE_DETAIL");
	assertPrivate(container.innerHTML);
	await click("저장");
	expect(container.textContent).not.toContain("FAKE_NETWORK_DETAIL");
	expect(container.querySelectorAll("input")).toHaveLength(3);
});

it("reports GET failure and retries without enabling edits prematurely", async () => {
	const fetcher = vi
		.fn<typeof fetch>()
		.mockRejectedValueOnce(new Error("FAKE_ERROR"))
		.mockResolvedValueOnce(Response.json(initial));
	vi.stubGlobal("fetch", fetcher);
	await mount();
	expect(container.textContent).toContain(targetMessages.load);
	expect(container.textContent).not.toContain("목표 편집");
	await click("다시 시도");
	expect(container.textContent).toContain("목표 편집");
});
