import { createFileRoute } from "@tanstack/react-router";

// Reused by the SSR loader without an HTTP round trip.
export async function GET() {
	const { getProxy } = await import("../../server/proxy");
	const proxy = getProxy();
	if (proxy) return proxy.health();
	const { getPortfolioService } = await import("../../server/portfolioService");
	const service = getPortfolioService();
	await service.start();
	return Response.json(await service.getHealth(), {
		headers: { "Cache-Control": "no-store" },
	});
}

export const Route = createFileRoute("/api/health")({
	server: { handlers: { GET } },
});
