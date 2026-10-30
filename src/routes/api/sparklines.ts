import { createFileRoute } from "@tanstack/react-router";

export async function GET() {
	const { sparklinesResponse } = await import("../../server/sparklines");
	return sparklinesResponse();
}

export const Route = createFileRoute("/api/sparklines")({
	server: { handlers: { GET } },
});
