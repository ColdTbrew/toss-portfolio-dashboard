import { formatKrw, formatPercent } from "./format";
import { ALLOCATION_COLORS, type ShareCardModel } from "./shareCard";

export function drawShareCard(
	ctx: CanvasRenderingContext2D,
	model: ShareCardModel,
	theme: "dark" | "light",
) {
	ctx.canvas.width = 1080;
	ctx.canvas.height = 1350;
	const dark = theme === "dark";
	const text = dark ? "#edf1fa" : "#172337";
	const muted = dark ? "#99a7bc" : "#6c7b90";
	const profit = dark ? "#fb777f" : "#e74856";
	const loss = dark ? "#70a8ff" : "#2875df";
	const signColor = (value: number) =>
		value > 0 ? profit : value < 0 ? loss : text;
	ctx.fillStyle = dark ? "#101722" : "#f4f6fb";
	ctx.fillRect(0, 0, 1080, 1350);
	ctx.fillStyle = dark ? "#192332" : "#ffffff";
	ctx.beginPath();
	ctx.roundRect(40, 40, 1000, 1270, 32);
	ctx.fill();
	function label(
		value: string,
		x: number,
		y: number,
		size = 26,
		color = text,
		weight = 500,
		maxWidth = 900,
	) {
		ctx.font = `${weight} ${size}px system-ui, sans-serif`;
		ctx.fillStyle = color;
		ctx.fillText(value, x, y, maxWidth);
	}
	label(model.title, 90, 120, 40, text, 700);
	label(`${model.date.replaceAll("-", ".")} · KST`, 90, 163, 23, muted);
	label("총 수익률", 90, 238, 25, muted);
	label(
		formatPercent(model.returnRate, true),
		90,
		321,
		76,
		signColor(model.returnRate),
		750,
	);
	label(
		`오늘 ${formatPercent(model.dailyReturnRate, true)}`,
		90,
		370,
		28,
		signColor(model.dailyReturnRate),
	);
	if (model.includeAmounts) {
		label(`총자산 ${formatKrw(model.amounts.totalAssetsKrw)}`, 90, 422, 27);
		label(
			`평가손익 ${formatKrw(model.amounts.profitLossKrw, true)}`,
			550,
			422,
			27,
			signColor(model.amounts.profitLossKrw),
			500,
			440,
		);
	}
	label("자산 비중", 90, 493, 28, text, 700);
	let start = -Math.PI / 2;
	const total = model.allocation.reduce((sum, slice) => sum + slice.weight, 0);
	model.allocation.forEach((slice, index) => {
		const end = start + (total ? slice.weight / total : 0) * Math.PI * 2;
		ctx.beginPath();
		ctx.arc(280, 665, 125, start + 0.018, Math.max(start + 0.018, end - 0.018));
		ctx.strokeStyle = ALLOCATION_COLORS[index];
		ctx.lineWidth = 45;
		ctx.stroke();
		start = end;
		ctx.fillStyle = ALLOCATION_COLORS[index];
		ctx.fillRect(505, 540 + index * 40, 12, 12);
		label(slice.name, 533, 553 + index * 40, 22, text, 500, 300);
		ctx.textAlign = "right";
		label(formatPercent(slice.weight), 975, 553 + index * 40, 22, text, 600);
		ctx.textAlign = "left";
	});
	ctx.textAlign = "center";
	label(total ? "100%" : "—", 280, 672, 38, text, 700);
	label("전체 자산", 280, 707, 21, muted);
	ctx.textAlign = "left";
	label("수익률 상위 종목", 90, 876, 28, text, 700);
	model.topHoldings.forEach((row, index) => {
		const y = 938 + index * 55;
		label(String(index + 1).padStart(2, "0"), 90, y, 22, muted);
		label(row.name, 143, y, 25, text, 500, 610);
		ctx.textAlign = "right";
		label(
			formatPercent(row.returnRate, true),
			980,
			y,
			27,
			signColor(row.returnRate),
			650,
		);
		ctx.textAlign = "left";
	});
	label("toss-portfolio-dashboard", 90, 1259, 22, muted);
}
