export const TOSS_REST_BASE = "https://openapi.tossinvest.com";
export const TOSS_WS_URL = "wss://openapi-ws.tossinvest.com/ws/v1";
export const ALLOWED_ENDPOINTS = {
	token: "/oauth2/token",
	accounts: "/api/v1/accounts",
	holdings: "/api/v1/holdings",
	buyingPower: "/api/v1/buying-power",
	exchangeRate: "/api/v1/exchange-rate",
} as const;
