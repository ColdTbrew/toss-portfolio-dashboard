import { createFileRoute } from "@tanstack/react-router";

export async function GET() {
	const { analyticsResponse } = await import("../../server/analytics");
	return analyticsResponse();
}
export const Route = createFileRoute("/api/analytics")({
	server: { handlers: { GET } },
});
