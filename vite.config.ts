import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig(({ command }) => ({
	resolve: { tsconfigPaths: true },
	plugins: [
		command === "serve" && devtools(),
		nitro({
			plugins: [
				"./src/server/plugins/bindHost.ts",
				"./src/server/plugins/shutdown.ts",
			],
			rollupConfig: { external: [/^@sentry\//] },
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
}));

export default config;
