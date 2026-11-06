import type { IntradayPoint } from "../lib/types";

const WIDTH = 76;
const HEIGHT = 24;
const PAD_X = 2;
const PAD_Y = 2;

export function IntradaySpark({
	points,
	previousClose,
	tone,
}: {
	points?: IntradayPoint[];
	previousClose?: number | null;
	tone: "profit" | "loss" | "neutral";
}) {
	const values = (points ?? []).filter(
		(point) =>
			Number.isFinite(point.t) &&
			Number.isFinite(point.v) &&
			point.t >= 0 &&
			point.v > 0,
	);
	const closes = values.map((point) => point.v);
	const min = Math.min(...closes);
	const max = Math.max(...closes);
	const x = (index: number) =>
		PAD_X + (index / (values.length - 1)) * (WIDTH - PAD_X * 2);
	const y = (value: number) =>
		max === min
			? HEIGHT / 2
			: HEIGHT - PAD_Y - ((value - min) / (max - min)) * (HEIGHT - PAD_Y * 2);
	const line =
		values.length < 2
			? undefined
			: values
					.map(
						(point, index) => `${x(index).toFixed(2)},${y(point.v).toFixed(2)}`,
					)
					.join(" ");
	const baseline =
		previousClose !== null &&
		previousClose !== undefined &&
		Number.isFinite(previousClose) &&
		previousClose >= min &&
		previousClose <= max
			? y(previousClose)
			: null;
	return (
		<svg
			className={`market-intraday ${tone}`}
			width={WIDTH}
			height={HEIGHT}
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
			aria-hidden="true"
			focusable="false"
		>
			{baseline !== null && (
				<line
					x1={PAD_X}
					y1={baseline.toFixed(2)}
					x2={WIDTH - PAD_X}
					y2={baseline.toFixed(2)}
					strokeWidth="1"
					strokeDasharray="3 2"
				/>
			)}
			{line && (
				<polyline
					points={line}
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
