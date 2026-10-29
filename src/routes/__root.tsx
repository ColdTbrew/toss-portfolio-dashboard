import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { MaskProvider } from "../components/MaskProvider";
import appCss from "../styles.css?url";

const Devtools = import.meta.env.DEV
	? lazy(async () => {
			const [{ TanStackDevtools }, { TanStackRouterDevtoolsPanel }] =
				await Promise.all([
					import("@tanstack/react-devtools"),
					import("@tanstack/react-router-devtools"),
				]);
			return {
				default: () => (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "TanStack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				),
			};
		})
	: null;

const themeScript = `(function(){var t;try{t=localStorage.getItem('tpd:theme')}catch(e){}var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)})()`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "내 포트폴리오" },
			{
				name: "description",
				content: "내 자산과 수익률을 한눈에 보는 조회 전용 포트폴리오",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="ko" suppressHydrationWarning>
			<head>
				<script>{themeScript}</script>
				<HeadContent />
			</head>
			<body>
				<MaskProvider>{children}</MaskProvider>
				{Devtools && (
					<Suspense fallback={null}>
						<Devtools />
					</Suspense>
				)}
				<Scripts />
			</body>
		</html>
	);
}
