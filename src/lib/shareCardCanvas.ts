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
	const text = dark ? "#ffffff" : "#0a0a0a";
	const muted = dark ? "#b4b4b4" : "#5f6670";
	const profit = dark ? "#ff5a5f" : "#d22030";
	const loss = dark ? "#5c9dff" : "#1f5fd1";
	const allocationColors = dark
		? [
				"#f5f5f5",
				"#d4d4d4",
				"#b4b4b4",
				"#929292",
				"#747474",
				"#565656",
				"#3a3a3a",
			]
		: ALLOCATION_COLORS;
	const signColor = (value: number) =>
		value > 0 ? profit : value < 0 ? loss : text;
	ctx.fillStyle = dark ? "#000000" : "#f2f4f6";
	ctx.fillRect(0, 0, 1080, 1350);
	ctx.fillStyle = dark ? "#111111" : "#ffffff";
	ctx.beginPath();
	ctx.roundRect(40, 40, 1000, 1270, 20);
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
		ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Segoe UI", system-ui, sans-serif`;
		ctx.fillStyle = color;
		ctx.fillText(value, x, y, maxWidth);
	}
	label(model.title, 90, 120, 40, text, 500);
	label(`${model.date.replaceAll("-", ".")} · KST`, 90, 163, 23, muted);
	label("총 수익률", 90, 238, 25, muted);
	label(
		formatPercent(model.returnRate, true),
		90,
		321,
		76,
		signColor(model.returnRate),
		500,
	);
	label("오늘", 90, 370, 28, muted);
	label(
		formatPercent(model.dailyReturnRate, true),
		156,
		370,
		28,
		signColor(model.dailyReturnRate),
	);
	if (model.includeAmounts) {
		label("총자산", 90, 422, 27, muted);
		label(
			formatKrw(model.amounts.totalAssetsKrw),
			184,
			422,
			27,
			text,
			700,
			340,
		);
		label("평가손익", 550, 422, 27, muted);
		label(
			formatKrw(model.amounts.profitLossKrw, true),
			674,
			422,
			27,
			signColor(model.amounts.profitLossKrw),
			700,
			316,
		);
	}
	label("자산 비중", 90, 493, 28, text, 500);
	let start = -Math.PI / 2;
	const total = model.allocation.reduce((sum, slice) => sum + slice.weight, 0);
	model.allocation.forEach((slice, index) => {
		const end = start + (total ? slice.weight / total : 0) * Math.PI * 2;
		ctx.beginPath();
		ctx.arc(280, 665, 125, start + 0.018, Math.max(start + 0.018, end - 0.018));
		ctx.strokeStyle = allocationColors[index];
		ctx.lineWidth = 28;
		ctx.stroke();
		start = end;
		ctx.fillStyle = allocationColors[index];
		ctx.fillRect(505, 540 + index * 40, 12, 12);
		label(slice.name, 533, 553 + index * 40, 22, text, 500, 300);
		ctx.textAlign = "right";
		label(formatPercent(slice.weight), 975, 553 + index * 40, 22, text, 500);
		ctx.textAlign = "left";
	});
	ctx.textAlign = "center";
	label(total ? "100%" : "—", 280, 672, 26, text, 500);
	label("전체 자산", 280, 707, 21, muted);
	ctx.textAlign = "left";
	label("수익률 상위 종목", 90, 876, 28, text, 500);
	model.topHoldings.forEach((row, index) => {
		const y = 938 + index * 55;
		label(String(index + 1), 90, y, 22, muted);
		label(row.name, 143, y, 25, text, 500, 610);
		ctx.textAlign = "right";
		label(
			formatPercent(row.returnRate, true),
			980,
			y,
			27,
			signColor(row.returnRate),
			500,
		);
		ctx.textAlign = "left";
	});
	label("toss-portfolio-dashboard", 90, 1259, 22, muted);
}
