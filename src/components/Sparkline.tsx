export function Sparkline({ closes = [] }: { closes?: number[] }) {
	const values = closes.filter(Number.isFinite);
	const min = Math.min(...values);
	const max = Math.max(...values);
	const points =
		values.length < 2
			? undefined
			: values
					.map((value, index) => {
						const x = 2 + (index / (values.length - 1)) * 68;
						const y =
							max === min ? 12 : 22 - ((value - min) / (max - min)) * 20;
						return `${x.toFixed(2)},${y.toFixed(2)}`;
					})
					.join(" ");
	return (
		<svg
			className={`holding-sparkline ${values.length && values[values.length - 1] >= values[0] ? "profit" : "loss"}`}
			width="72"
			height="24"
			viewBox="0 0 72 24"
			aria-hidden="true"
			focusable="false"
		>
			{points && (
				<polyline
					points={points}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
			)}
		</svg>
	);
}
