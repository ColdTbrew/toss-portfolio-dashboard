import { describe, expect, it } from "vitest";
import { formatKrw } from "../src/lib/format";
import {
	buildShareCardModel,
	type PrivateShareCard,
} from "../src/lib/shareCard";
import { drawShareCard } from "../src/lib/shareCardCanvas";
import { NOW } from "./fixtures";
import { privacyFixture, privateValues } from "./privacyFixture";

function fakeCanvas() {
	const texts: string[] = [];
	const ctx = {
		canvas: { width: 0, height: 0 },
		fillRect() {},
		beginPath() {},
		roundRect() {},
		fill() {},
		arc() {},
		stroke() {},
		fillText(text: string) {
			texts.push(text);
		},
	} as unknown as CanvasRenderingContext2D;
	return { ctx, texts };
}

describe("share cards", () => {
	it("defaults to a model without amounts or account metadata", () => {
		const state = {
			...privacyFixture(),
			accountSeq: "FAKE_ACCOUNT_SEQUENCE",
			accountNumber: "FAKE_ACCOUNT_NUMBER",
			accountName: "FAKE_ACCOUNT_NAME",
			token: "FAKE_TOKEN",
		};
		const model: PrivateShareCard = buildShareCardModel(state, { now: NOW });
		const json = JSON.stringify(model);
		expect(model).not.toHaveProperty("amounts");
		expect(model.includeAmounts).toBe(false);
		expect(json).not.toMatch(
			/account|token|quantity|avgPrice|lastPrice|purchaseAmount|evalAmount|profitLossKrw|totalAssetsKrw/i,
		);
		for (const value of privateValues(state))
			expect(json).not.toContain(String(value));
		expect(
			buildShareCardModel(state, { includeAmounts: false, now: NOW }),
		).toEqual(model);
		const forbidden: PrivateShareCard = {
			...model,
			// @ts-expect-error The default model cannot carry amounts.
			amounts: { totalAssetsKrw: 1, profitLossKrw: 2 },
		};
		expect(forbidden).toBeDefined();
	});
	it("includes exactly two amounts only after explicit opt-in, without leaking metadata", () => {
		const state = {
			...privacyFixture(),
			accountSeq: "FAKE_SEQUENCE",
			accountName: "FAKE_NAME",
			token: "FAKE_TOKEN",
		};
		const model = buildShareCardModel(state, {
			includeAmounts: true,
			now: NOW,
		});
		expect(model.amounts).toEqual({
			totalAssetsKrw: state.totals.totalAssetsKrw,
			profitLossKrw: state.totals.profitLossKrw,
		});
		expect(JSON.stringify(model)).not.toMatch(
			/account|token|quantity|avgPrice/i,
		);
	});
	it("selects the five highest return rates without mutating holdings and groups allocation into top six plus others", () => {
		const state = privacyFixture();
		state.holdings = Array.from({ length: 10 }, (_, index) => ({
			...state.holdings[0],
			name: `FAKE 기업 ${index}`,
			returnRate: (index - 5) / 10,
			weight: 0.08,
		}));
		state.cash = { krw: 20, usd: 0, totalKrw: 20 };
		state.totals.totalAssetsKrw = 100;
		const before = JSON.stringify(state);
		const model = buildShareCardModel(state, { now: NOW });
		expect(model.topHoldings.map((row) => row.returnRate)).toEqual([
			0.4, 0.3, 0.2, 0.1, 0,
		]);
		expect(model.allocation).toHaveLength(7);
		expect(model.allocation[0]).toEqual({ name: "현금", weight: 0.2 });
		expect(model.allocation[6].name).toBe("기타");
		expect(
			model.allocation.reduce((sum, row) => sum + row.weight, 0),
		).toBeCloseTo(1);
		expect(JSON.stringify(state)).toBe(before);
	});
	it.each([
		"dark",
		"light",
	] as const)("renders a 1080×1350 % card without any private fillText values (%s)", (theme) => {
		const state = privacyFixture();
		const { ctx, texts } = fakeCanvas();
		drawShareCard(ctx, buildShareCardModel(state, { now: NOW }), theme);
		expect(ctx.canvas).toEqual({ width: 1080, height: 1350 });
		expect(texts.join(" ")).toContain("%");
		for (const value of privateValues(state)) {
			expect(texts.join(" ")).not.toContain(String(value));
			expect(texts.join(" ")).not.toContain(formatKrw(value));
		}
		expect(texts).toContain("toss-portfolio-dashboard");
		const visible = fakeCanvas();
		drawShareCard(
			visible.ctx,
			buildShareCardModel(state, { includeAmounts: true, now: NOW }),
			theme,
		);
		expect(visible.texts.join(" ")).toContain(
			formatKrw(state.totals.totalAssetsKrw),
		);
		expect(visible.texts.join(" ")).toContain(
			formatKrw(state.totals.profitLossKrw, true),
		);
	});
	it("uses the Korean date across UTC midnight and handles an empty portfolio", () => {
		const state = privacyFixture();
		state.holdings = [];
		state.cash = null;
		const model = buildShareCardModel(state, {
			now: Date.parse("2026-10-29T18:00:00Z"),
		});
		expect(model.date).toBe("2026-10-30");
		expect(model.allocation).toEqual([]);
		expect(model.topHoldings).toEqual([]);
		expect(() => drawShareCard(fakeCanvas().ctx, model, "light")).not.toThrow();
	});
});
