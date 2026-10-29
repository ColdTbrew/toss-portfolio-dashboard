import type { RawPortfolio } from "../src/lib/types";
import { readConfig } from "../src/server/config";
import type { LedgerSnapshot } from "../src/server/ledger";

export const NOW = Date.parse("2026-10-29T16:11:00+09:00");
export function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

export function fixtureConfig(directory: string, env: NodeJS.ProcessEnv = {}) {
	return readConfig({
		TOSS_ENV_PATH: `${directory}/fake.env`,
		TOSS_TOKEN_PATH: `${directory}/fake-token.json`,
		TOSS_ACCOUNT_PATH: `${directory}/fake-account.json`,
		PORTFOLIO_LEDGER_PATH: `${directory}/fake-ledger.jsonl`,
		...env,
	});
}
export function rawFixture(): RawPortfolio {
	return {
		krw: { currency: "KRW", cashBuyingPower: "5000" },
		usd: { currency: "USD", cashBuyingPower: "10" },
		fx: {
			baseCurrency: "USD",
			quoteCurrency: "KRW",
			midRate: "1300",
			rate: "1305",
			basisPoint: "38.46",
			rateChangeType: "UP",
			validFrom: "2026-10-29T16:10:00+09:00",
			validUntil: "2026-10-29T16:12:00+09:00",
		},
		holdings: {
			totalPurchaseAmount: { krw: "18000", usd: "90" },
			marketValue: {
				amount: { krw: "20000", usd: "100" },
				amountAfterCost: { krw: "19980", usd: "99" },
			},
			profitLoss: {
				amount: { krw: "2000", usd: "10" },
				amountAfterCost: { krw: "1980", usd: "9" },
				rate: "0.1111",
				rateAfterCost: "0.1013",
			},
			dailyProfitLoss: {
				amount: { krw: "200", usd: "1" },
				rate: "0.010101010101010102",
			},
			items: [
				{
					symbol: "FAKEKR",
					name: "가상 테스트 주식",
					marketCountry: "KR",
					currency: "KRW",
					quantity: "2",
					lastPrice: "10000",
					averagePurchasePrice: "9000",
					marketValue: {
						purchaseAmount: "18000",
						amount: "20000",
						amountAfterCost: "19980",
					},
					profitLoss: {
						amount: "2000",
						amountAfterCost: "1980",
						rate: "0.1111",
						rateAfterCost: "0.11",
					},
					dailyProfitLoss: { amount: "200", rate: "0.0101" },
					cost: { commission: "20", tax: "0" },
				},
				{
					symbol: "FAKEUS",
					name: "FAKE Test Stock",
					marketCountry: "US",
					currency: "USD",
					quantity: "0.5",
					lastPrice: "200",
					averagePurchasePrice: "180",
					marketValue: {
						purchaseAmount: "90",
						amount: "100",
						amountAfterCost: "99",
					},
					profitLoss: {
						amount: "10",
						amountAfterCost: "9",
						rate: "0.1111",
						rateAfterCost: "0.1",
					},
					dailyProfitLoss: { amount: "1", rate: "0.0101" },
					cost: { commission: "1", tax: null },
				},
			],
		},
	};
}

// Entirely fictional record, including every field in DESIGN §9.
export const ledgerFixture: LedgerSnapshot = {
	date: "2026-10-28",
	ts: "2026-10-28T16:11:00.000+09:00",
	source: "fake-fixture",
	fx: {
		pair: "USD/KRW",
		midRate: "1300",
		buyRate: "1305",
		validFrom: "2026-10-28T16:10:00+09:00",
		usedForKRW: "midRate",
	},
	cash: { KRW: "5000", USD: "10", basis: "cashBuyingPower", totalKRW: "18000" },
	totals: {
		stocksEvalKRW: "150000",
		stocksEvalByCcy: { KRW: "20000", USD: "100" },
		purchaseByCcy: { KRW: "18000", USD: "90" },
		profitLossByCcy: { KRW: "2000", USD: "10" },
		plRateApi: "0.1111",
		dailyPLByCcy: { KRW: "200", USD: "1" },
		dailyPLRateApi: "0.010101010101010102",
		purchaseKRW: "135000",
		profitLossKRW: "15000",
		totalAssetsKRW: "168000",
	},
	holdings: [
		{
			symbol: "FAKEKR",
			name: "가상 테스트 주식",
			market: "KR",
			currency: "KRW",
			quantity: "2",
			avgPrice: "9000",
			lastPrice: "10000",
			purchaseAmount: "18000",
			evalAmount: "20000",
			evalAfterCost: "19980",
			profitLoss: "2000",
			returnRate: "0.1111",
			dailyPL: "200",
			evalKRW: "20000",
			weight: "0.12",
		},
		{
			symbol: "FAKEUS",
			name: "FAKE Test Stock",
			market: "US",
			currency: "USD",
			quantity: "0.5",
			avgPrice: "180",
			lastPrice: "200",
			purchaseAmount: "90",
			evalAmount: "100",
			evalAfterCost: "99",
			profitLoss: "10",
			returnRate: "0.1111",
			dailyPL: "1",
			evalKRW: "130000",
			weight: "0.77",
		},
	],
};
