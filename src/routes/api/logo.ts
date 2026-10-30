import { createFileRoute } from "@tanstack/react-router";

export async function GET({ request }: { request: Request }) {
	const { getLogoService } = await import("../../server/logos");
	return getLogoService().respond(
		new URL(request.url).searchParams.get("symbol") ?? "",
	);
}

export const Route = createFileRoute("/api/logo")({
	server: { handlers: { GET } },
});
