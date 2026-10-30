import { createFileRoute } from "@tanstack/react-router";

export async function GET({ request }: { request: Request }) {
	const { getProxy } = await import("../../server/proxy");
	const proxy = getProxy();
	if (proxy) return proxy.stream(request.signal);
	const { getPortfolioService } = await import("../../server/portfolioService");
	return getPortfolioService().openStream(request.signal);
}

export const Route = createFileRoute("/api/stream")({
	server: { handlers: { GET } },
});
