import { definePlugin } from "nitro";
import { buildHostAllowlist, isHostAllowed } from "../hostAllowlist";

export default definePlugin((app) => {
	const allowed = buildHostAllowlist(process.env);
	const next = app.fetch;
	// Nitro's request hook cannot short-circuit. Wrap fetch before any routing.
	app.fetch = (request) => {
		if (!isHostAllowed(request.headers.get("host"), allowed)) {
			return new Response("Misdirected Request", {
				status: 421,
				headers: { "Cache-Control": "no-store" },
			});
		}
		return next(request);
	};
});
