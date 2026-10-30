import type { Currency } from "./types";

function format(value: number, digits: number, signed: boolean): string {
	if (!Number.isFinite(value)) return "—";
	return new Intl.NumberFormat("ko-KR", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
		signDisplay: signed ? "exceptZero" : "auto",
	}).format(Object.is(value, -0) ? 0 : value);
}

export function formatKrw(value: number, signed = false): string {
	return `${format(value, 0, signed)}원`;
}
export function formatKrwManwon(value: number): string {
	return Number.isFinite(value)
		? `${format(value / 10000, 0, false)}만원`
		: "—";
}
export function formatUsd(value: number, signed = false): string {
	const formatted = format(value, 2, signed);
	return formatted.replace(/^([+-]?)(.*)$/, "$1$$$2");
}
export function formatPercent(value: number, signed = false): string {
	return `${format(value * 100, 2, signed)}%`;
}
export function formatMoney(
	value: number,
	currency: Currency,
	signed = false,
): string {
	return currency === "KRW"
		? formatKrw(value, signed)
		: formatUsd(value, signed);
}
