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
			<span aria-hidden="true">{dark ? "☀" : "☾"}</span>
		</button>
	);
}
