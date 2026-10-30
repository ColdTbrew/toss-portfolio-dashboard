import type { ReactNode } from "react";

export function AnalyticsPanel({
	id,
	eyebrow,
	title,
	info,
	children,
}: {
	id: string;
	eyebrow: string;
	title: string;
	info?: string;
	children: ReactNode;
}) {
	return (
		<section className="panel analytics-panel" aria-labelledby={id}>
			<div className="panel-heading">
				<div>
					<p className="eyebrow">{eyebrow}</p>
					<h2 id={id}>{title}</h2>
				</div>
				{info && (
					<details className="analytics-info">
						<summary>계산 방법</summary>
						<p>{info}</p>
					</details>
				)}
			</div>
			{children}
		</section>
	);
}
export function AnalyticsPeriods<T extends string | number>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: readonly (readonly [T, string])[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="analytics-controls">
			<fieldset className="segmented" aria-label={label}>
				{options.map(([key, text]) => (
					<button
						key={key}
						type="button"
						aria-pressed={value === key}
						onClick={() => onChange(key)}
					>
						{text}
					</button>
				))}
			</fieldset>
		</div>
	);
}
export function AnalyticsEmpty({
	loading = false,
	children,
}: {
	loading?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			className={`empty-state analytics-empty${loading ? " analytics-loading" : ""}`}
			aria-busy={loading}
		>
			{loading
				? "분석 데이터를 불러오는 중입니다."
				: (children ?? "분석에 필요한 데이터가 없습니다.")}
		</div>
	);
}
