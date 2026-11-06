import { createFileRoute } from "@tanstack/react-router";

export async function GET({ request }: { request: Request }) {
	const { intradayResponse } = await import("../../server/intraday");
	return intradayResponse(
		new URL(request.url).searchParams.get("symbol") ?? "",
	);
}

export const Route = createFileRoute("/api/intraday")({
	server: { handlers: { GET } },
});
