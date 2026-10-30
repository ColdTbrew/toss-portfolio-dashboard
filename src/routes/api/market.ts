import { createFileRoute } from "@tanstack/react-router";

export async function GET() {
	const { getMarketService } = await import("../../server/market");
	return getMarketService().respond();
}

export const Route = createFileRoute("/api/market")({
	server: { handlers: { GET } },
});
