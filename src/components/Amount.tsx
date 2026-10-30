import { formatMoney } from "../lib/format";
import type { Currency } from "../lib/types";
import { useMask } from "./MaskProvider";

export function formatAmount(
	value: number,
	{
		masked,
		currency = "KRW",
		signed = false,
		quantity = false,
	}: {
		masked: boolean;
		currency?: Currency;
		signed?: boolean;
		quantity?: boolean;
	},
) {
	if (masked) return "•••••";
	return quantity
		? `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 }).format(value)}주`
		: formatMoney(value, currency, signed);
}

export function Amount({
	value,
	currency = "KRW",
	signed = false,
	quantity = false,
}: {
	value: number;
	currency?: Currency;
	signed?: boolean;
	quantity?: boolean;
}) {
	const { masked } = useMask();
	return (
		<span className="amount">
			{formatAmount(value, { masked, currency, signed, quantity })}
		</span>
	);
}
