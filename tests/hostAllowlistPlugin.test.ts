import { HookableCore } from "hookable";
import { afterEach, describe, expect, it, vi } from "vitest";
import hostAllowlistPlugin from "../src/server/plugins/hostAllowlist";

afterEach(() => vi.unstubAllEnvs());

function guardedApp() {
	const handler = vi.fn((_request: Request) => new Response("Handler ran"));
	const app: Parameters<typeof hostAllowlistPlugin>[0] = {
		fetch: handler,
		hooks: new HookableCore(),
	};
	hostAllowlistPlugin(app);
	return { app, handler };
}

describe.each(["production", "development", "test"])("%s guard", (mode) => {
	it.each([
		"/",
		"/api/portfolio",
		"/api/health",
		"/api/stream",
		"/asset.js",
	])("rejects foreign and missing Host before the handler for %s", async (path) => {
		vi.stubEnv("NODE_ENV", mode);
		vi.stubEnv("HOST", undefined);
		vi.stubEnv("ALLOWED_HOSTS", undefined);
		const { app, handler } = guardedApp();
		for (const host of ["evil.example", "evil.example:8790", "", undefined]) {
			const headers = new Headers({
				"X-Forwarded-Host": "localhost",
				Forwarded: "host=localhost",
			});
			if (host !== undefined) headers.set("Host", host);
			const response = await app.fetch(
				new Request(`http://localhost${path}`, { headers }),
			);
			expect(response.status).toBe(421);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(response.headers.get("Content-Type")).toContain("text/plain");
			expect(await response.text()).toBe("Misdirected Request");
		}
		expect(handler).not.toHaveBeenCalled();
	});

	it.each([
		"/",
		"/api/portfolio",
		"/api/stream",
	])("passes allowed Host and the original request/response through for %s", async (path) => {
		vi.stubEnv("NODE_ENV", mode);
		vi.stubEnv("HOST", "bind.example.invalid");
		vi.stubEnv("ALLOWED_HOSTS", " Example.Invalid, ,");
		const { app, handler } = guardedApp();
		for (const host of [
			"localhost:8790",
			"127.0.0.1",
			"[::1]:8790",
			"bind.example.invalid",
			"EXAMPLE.INVALID:8790",
		]) {
			const request = new Request(`http://localhost${path}`, {
				headers: {
					Host: host,
					"X-Forwarded-Host": "evil.example",
					Forwarded: "host=evil.example",
				},
			});
			const response = await app.fetch(request);
			expect(handler).toHaveBeenLastCalledWith(request);
			expect(response).toBe(handler.mock.results.at(-1)?.value);
			expect(response.status).toBe(200);
		}
	});
});

it("blocks a rebinding PUT even when Origin and Sec-Fetch-Site appear same-origin", async () => {
	vi.stubEnv("HOST", "localhost");
	vi.stubEnv("ALLOWED_HOSTS", undefined);
	const { app, handler } = guardedApp();
	const response = await app.fetch(
		new Request("http://evil.example/api/targets", {
			method: "PUT",
			headers: {
				Host: "evil.example",
				Origin: "http://evil.example",
				"Sec-Fetch-Site": "same-origin",
				"Content-Type": "application/json",
			},
			body: '{"targets":{}}',
		}),
	);
	expect(response.status).toBe(421);
	expect(handler).not.toHaveBeenCalled();
});
