import { createFileRoute } from "@tanstack/react-router";

// Reused by the SSR loader without an HTTP round trip.
export async function GET() {
	const { getProxy } = await import("../../server/proxy");
	const proxy = getProxy();
	if (proxy) return proxy.json("/api/portfolio");
	const { getPortfolioService } = await import("../../server/portfolioService");
	const service = getPortfolioService();

	return Response.json(await service.getPortfolio(), {
		headers: { "Cache-Control": "no-store" },
	});
}

export const Route = createFileRoute("/api/portfolio")({
	server: { handlers: { GET } },
});
