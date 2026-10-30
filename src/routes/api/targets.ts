import { createFileRoute } from "@tanstack/react-router";

export function methodNotAllowed() {
	return new Response(null, {
		status: 405,
		headers: { Allow: "GET, PUT", "Cache-Control": "no-store" },
	});
}

export async function GET({ request }: { request?: Request } = {}) {
	// The router otherwise falls back from HEAD to GET automatically.
	if (request && request.method !== "GET") return methodNotAllowed();
	const { targetsGet } = await import("../../server/targets");
	return targetsGet();
}
export async function PUT({ request }: { request: Request }) {
	const { targetsPut } = await import("../../server/targets");
	return targetsPut(request);
}
export const Route = createFileRoute("/api/targets")({
	// Without a fallback the router renders the HTML page for other methods.
	server: { handlers: { GET, PUT, ANY: methodNotAllowed } },
});
