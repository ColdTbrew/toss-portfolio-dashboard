export type Money = string;
export type Currency = "KRW" | "USD";
export type Sparklines = Record<string, number[]>;
export interface MarketItem {
	id: string;
	label: string;
	value: number;
	change: number | null;
	/** Fraction, consistent with portfolio return rates. */
	changeRate: number | null;
	currency?: Currency;
	asOf: string;
	stale?: boolean;
}
export interface MarketState {
	items: MarketItem[];
	fetchedAt: string;
}
export interface ByCcy {
	krw: Money;
	usd: Money | null;
}
export interface HoldingsItem {
	symbol: string;
	name: string;
	marketCountry: "KR" | "US";
	currency: Currency;
	quantity: Money;
	lastPrice: Money;
	averagePurchasePrice: Money;
	marketValue: { purchaseAmount: Money; amount: Money; amountAfterCost: Money };
	profitLoss: {
		amount: Money;
		amountAfterCost: Money;
		rate: Money;
		rateAfterCost: Money;
	};
	dailyProfitLoss: { amount: Money; rate: Money };
	cost: { commission: Money; tax: Money | null };
}
export interface HoldingsOverview {
	totalPurchaseAmount: ByCcy;
	marketValue: { amount: ByCcy; amountAfterCost: ByCcy };
	profitLoss: {
		amount: ByCcy;
		amountAfterCost: ByCcy;
		rate: Money;
		rateAfterCost: Money;
	};
	dailyProfitLoss: { amount: ByCcy; rate: Money };
	items: HoldingsItem[];
}
export interface BuyingPower {
	currency: Currency;
	cashBuyingPower: Money;
}
export interface ExchangeRate {
	baseCurrency: Currency;
	quoteCurrency: Currency;
	rate: Money;
	midRate: Money;
	basisPoint: Money;
	rateChangeType: string;
	validFrom: string;
	validUntil: string;
}
export interface RawPortfolio {
	holdings: HoldingsOverview | null;
	krw: BuyingPower | null;
	usd: BuyingPower | null;
	fx: ExchangeRate | null;
}
export interface HoldingRow {
	symbol: string;
	name: string;
	market: "KR" | "US";
	currency: Currency;
	quantity: number;
	avgPrice: number;
	lastPrice: number;
	basePrice: number;
	purchaseAmount: number;
	evalAmount: number;
	profitLoss: number;
	returnRate: number;
	dailyPl: number;
	evalKrw: number;
	weight: number;
	lastTickAt?: string;
}
export interface PortfolioState {
	fetchedAt: string;
	mock: boolean;
	fx: { midRate: number; buyRate: number; validFrom: string } | null;
	cash: { krw: number; usd: number; totalKrw: number } | null;
	holdings: HoldingRow[];
	totals: {
		totalAssetsKrw: number;
		stocksEvalKrw: number;
		purchaseKrw: number;
		profitLossKrw: number;
		returnRate: number;
		dailyPlKrw: number;
		dailyPlRate: number;
	};
	errors: Record<string, string>;
}
export interface Tick {
	symbol: string;
	market: "kr" | "us";
	price: number;
	timestamp: string;
}
export interface TrendPoint {
	date: string;
	ts: string;
	totalAssetsKrw: number;
	stocksEvalKrw: number;
	profitLossKrw: number;
	purchaseKrw: number;
	returnRate: number;
}
