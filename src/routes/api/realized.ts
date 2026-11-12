import { createFileRoute } from "@tanstack/react-router";

export async function GET() {
	if (process.env.TOSS_MOCK !== "1" || process.env.UPSTREAM_URL)
		return new Response(null, { status: 404 });
	const { createMockRealized } = await import("../../server/mock");
	return Response.json(createMockRealized(), {
		headers: { "Cache-Control": "private, max-age=1800" },
	});
}

export const Route = createFileRoute("/api/realized")({
	server: { handlers: { GET } },
});
