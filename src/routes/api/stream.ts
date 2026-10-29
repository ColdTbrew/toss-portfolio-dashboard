import { createFileRoute } from "@tanstack/react-router";

export async function GET({ request }: { request: Request }) {
	const { getPortfolioService } = await import("../../server/portfolioService");
	return getPortfolioService().openStream(request.signal);
}

export const Route = createFileRoute("/api/stream")({
	server: { handlers: { GET } },
});
