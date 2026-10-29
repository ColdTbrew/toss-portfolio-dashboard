import { createFileRoute } from "@tanstack/react-router";

// Reused by the SSR loader without an HTTP round trip.
export async function GET() {
	const { getPortfolioService } = await import("../../server/portfolioService");
	const service = getPortfolioService();

	try {
		return Response.json(await service.getTrend(), {
			headers: { "Cache-Control": "no-store" },
		});
	} catch {
		return Response.json(
			{ error: "일별 기록을 불러오지 못했어요." },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}

export const Route = createFileRoute("/api/trend")({
	server: { handlers: { GET } },
});
