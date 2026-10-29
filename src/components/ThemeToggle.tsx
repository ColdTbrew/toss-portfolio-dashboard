import { useEffect, useState } from "react";

export function ThemeToggle() {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const query = matchMedia("(prefers-color-scheme: dark)");
		setDark(document.documentElement.classList.contains("dark"));
		function followSystem() {
			try {
				if (localStorage.getItem("tpd:theme")) return;
			} catch {
				/* Use system preference. */
			}
			document.documentElement.classList.toggle("dark", query.matches);
			setDark(query.matches);
		}
		query.addEventListener("change", followSystem);
		return () => query.removeEventListener("change", followSystem);
	}, []);
	function toggle() {
		const next = !dark;
		setDark(next);
		document.documentElement.classList.toggle("dark", next);
		try {
			localStorage.setItem("tpd:theme", next ? "dark" : "light");
		} catch {
			/* Theme still applies. */
		}
	}
	return (
		<button
			type="button"
			className="icon-button"
			aria-label={dark ? "라이트 모드" : "다크 모드"}
			onClick={toggle}
		>
			<svg
				aria-hidden="true"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				{dark ? (
					<>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
					</>
				) : (
					<path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z" />
				)}
			</svg>
		</button>
	);
}
