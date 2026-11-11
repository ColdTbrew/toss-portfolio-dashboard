// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HoldingsTable } from "../src/components/HoldingsTable";
import { MaskProvider } from "../src/components/MaskProvider";
import { buildState, ratio } from "../src/lib/compute";
import { formatMoney, formatPercent } from "../src/lib/format";
import { createMockRaw } from "../src/server/mock";

it.each([
	false,
	true,
])("pairs daily and total mobile P/L with masked amounts=%s", (masked) => {
	const state = buildState(createMockRaw(0), { now: 0 });
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		<MaskProvider initialMasked={masked}>
			<HoldingsTable state={state} />
		</MaskProvider>,
	);
	const cards = [...container.querySelectorAll("tbody tr")];
	expect(cards).toHaveLength(12);
	for (const card of cards) {
		const row = state.holdings.find((holding) =>
			card.getAttribute("aria-controls")?.endsWith(`-${holding.symbol}`),
		);
		expect(row).toBeDefined();
		if (!row) throw new Error("Missing holding");
		const groups = card.querySelectorAll(
			".mobile-holding-pl > [data-pl-group]",
		);
		expect(
			[...groups].map((group) => group.getAttribute("data-pl-group")),
		).toEqual(["daily", "total"]);
		for (const [index, group] of [...groups].entries()) {
			const amount = index === 0 ? row.dailyPl : row.profitLoss;
			const rate =
				index === 0
					? ratio(row.dailyPl, row.evalAmount - row.dailyPl)
					: row.returnRate;
			expect(
				[...group.children].map((child) => child.getAttribute("data-pl")),
			).toEqual(["label", "rate", "amount"]);
			expect(group.querySelector('[data-pl="label"]')?.textContent).toBe(
				index === 0 ? "당일 수익" : "총 수익",
			);
			expect(group.querySelector('[data-pl="rate"]')?.textContent).toBe(
				formatPercent(rate, true),
			);
			const amountElement = group.querySelector('[data-pl="amount"]');
			expect(amountElement?.textContent).toBe(
				masked ? "•••••" : formatMoney(amount, row.currency, true),
			);
			expect(amountElement?.className).toBe(
				amount > 0 ? "profit" : amount < 0 ? "loss" : "neutral",
			);
		}
		expect(
			card.querySelector(".mobile-holding-details")?.textContent,
		).not.toContain("손익");
		// The desktop retains all nine cells and its existing P/L values.
		expect(card.children).toHaveLength(9);
		expect(card.children[2].textContent).toBe(
			formatPercent(row.returnRate, true),
		);
		expect(card.children[7].textContent).toBe(
			masked ? "•••••" : formatMoney(row.profitLoss, row.currency, true),
		);
	}
});
