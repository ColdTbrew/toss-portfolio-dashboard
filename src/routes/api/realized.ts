import { createFileRoute } from "@tanstack/react-router";

export async function GET({ request }: { request?: Request } = {}) {
	const { realizedResponse } = await import("../../server/realizedService");
	return realizedResponse(
		request ? new URL(request.url).searchParams.get("masked") === "1" : false,
	);
}

export const Route = createFileRoute("/api/realized")({
	server: { handlers: { GET } },
});
