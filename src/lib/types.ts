export type Money = string;
export type Currency = "KRW" | "USD";
export type Sparklines = Record<string, number[]>;
export interface DatedClose {
	date: string;
	close: number;
}
export type BenchmarkSymbol = "^KS11" | "^GSPC" | "^IXIC";
/** One intraday sample: epoch milliseconds and the value at that time. */
export interface IntradayPoint {
	t: number;
	v: number;
}
/** Holding 1m bar; `t` is an ISO timestamp (exchange-local offset when present). */
export interface TimedClose {
	t: string;
	close: number;
}
export interface IntradayData {
	previousClose: number | null;
	points: TimedClose[];
}
export interface AnalyticsData {
	fetchedAt: string;
	candles: Record<string, DatedClose[]>;
	benchmarks: Partial<Record<BenchmarkSymbol, DatedClose[]>>;
	usdkrw: DatedClose[];
}
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
	/** Today's session samples for the mini chart, capped server-side. */
	intraday?: IntradayPoint[];
	/** Prior session close used as the intraday baseline, when known. */
	previousClose?: number | null;
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

export type RealizedPeriod = "day" | "week" | "month" | "year";

export interface RealizedTotal {
	pending: boolean;
	realizedKrw: number;
	rate: number;
	sellCount: number;
	pendingKrw: number;
	/** Native currency P/L, before KRW conversion. */
	byCcy: { KRW: number; USD: number };
	estimated: boolean;
}

export interface RealizedBucket {
	key: string;
	label: string;
	realizedKrw: number;
	rate: number;
	estimated: boolean;
}

export interface RealizedSymbol {
	estimated: boolean;
	symbol: string;
	name: string;
	market: "KR" | "US";
	currency: "KRW" | "USD";
	quantity: number;
	/** Native currency P/L. */
	realized: number;
	realizedKrw: number;
	rate: number;
	/** Null for KRW, mixed FX rates, or estimated FX. */
	fxRate: number | null;
	fxEstimated: boolean;
	pending: boolean;
	lastSellDate: string;
	sellCount: number;
	/** Only the pending sells within this symbol group. */
	pendingKrw: number;
}

export interface RealizedData {
	masked?: false;
	asOf: string;
	/** KST settlement date; today's unsettled sells are included as pending. */
	basis: "settlement";
	totals: Record<RealizedPeriod, RealizedTotal>;
	buckets: Record<RealizedPeriod, RealizedBucket[]>;
	bySymbol: Record<RealizedPeriod, RealizedSymbol[]>;
}

export type MaskedRealizedData = Omit<
	RealizedData,
	"totals" | "buckets" | "bySymbol" | "masked"
> & {
	masked: true;
	totals: Record<
		RealizedPeriod,
		Omit<RealizedTotal, "realizedKrw" | "pendingKrw" | "byCcy"> & {
			realizedKrw: null;
			pendingKrw: null;
			byCcy: null;
		}
	>;
	buckets: Record<
		RealizedPeriod,
		(Omit<RealizedBucket, "realizedKrw"> & { realizedKrw: null })[]
	>;
	bySymbol: Record<
		RealizedPeriod,
		(Omit<
			RealizedSymbol,
			"quantity" | "realized" | "realizedKrw" | "pendingKrw"
		> & {
			quantity: null;
			realized: null;
			realizedKrw: null;
			pendingKrw: null;
		})[]
	>;
};
