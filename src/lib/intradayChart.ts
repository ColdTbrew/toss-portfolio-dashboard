import type { TimedClose } from "./types";

export interface ChartPoint {
	t: string;
	close: number;
}

/** Collapses 1m closes into N-minute buckets (last close, bucket-start time). */
export function bucketCloses(points: TimedClose[], minutes = 5): ChartPoint[] {
	const size = minutes * 60_000;
	const out: ChartPoint[] = [];
	let currentBucket = Number.NaN;
	for (const point of points) {
		const time = Date.parse(point.t);
		if (!Number.isFinite(time) || !Number.isFinite(point.close)) continue;
		const bucket = Math.floor(time / size);
		const t = new Date(bucket * size).toISOString();
		if (bucket === currentBucket)
			out[out.length - 1] = { t, close: point.close };
		else {
			out.push({ t, close: point.close });
			currentBucket = bucket;
		}
	}
	return out;
}

/** Only aggregate when the raw 1m series is long enough to look noisy. */
export function chartSeries(points: TimedClose[]): ChartPoint[] {
	return points.length > 90 ? bucketCloses(points, 5) : points;
}

const STEPS = [15, 30, 60, 90, 120, 180];

/**
 * Picks x-axis ticks on round clock times so at most `max` labels show.
 * `minuteOfDay` maps a point timestamp to minutes since local midnight.
 */
export function roundTicks(
	points: ChartPoint[],
	max: number,
	minuteOfDay: (iso: string) => number,
): string[] {
	if (points.length < 2) return points.map((point) => point.t);
	const minutes = points.map((point) => minuteOfDay(point.t));
	const span = (minutes.at(-1) ?? 0) - (minutes[0] ?? 0);
	const step =
		STEPS.find((candidate) => Math.floor(span / candidate) + 1 <= max) ??
		Math.ceil(span / Math.max(1, max - 1));
	const ticks: string[] = [];
	let target = Math.ceil((minutes[0] ?? 0) / step) * step;
	points.forEach((point, index) => {
		const minute = minutes[index] ?? 0;
		if (minute < target) return;
		ticks.push(point.t);
		target = (Math.floor(minute / step) + 1) * step;
	});
	if (ticks.length >= 2) return ticks.slice(0, max);
	// Fallback for sparse/irregular data: evenly spaced indices.
	const count = Math.min(max, points.length);
	return Array.from(
		{ length: count },
		(_, i) =>
			points[Math.round((i * (points.length - 1)) / (count - 1))]?.t ?? "",
	);
}

export function dayRange(points: TimedClose[]) {
	const closes = points.map((point) => point.close).filter(Number.isFinite);
	if (!closes.length) return null;
	return { high: Math.max(...closes), low: Math.min(...closes) };
}
