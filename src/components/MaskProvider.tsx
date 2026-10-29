import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

const MaskContext = createContext({ masked: true, toggle: () => {} });

export function MaskProvider({
	children,
	initialMasked = true,
}: {
	children: ReactNode;
	initialMasked?: boolean;
}) {
	const [masked, setMasked] = useState(initialMasked);
	useEffect(() => {
		try {
			setMasked(localStorage.getItem("tpd:maskAmounts") === "true");
		} catch {
			/* Keep the private default when storage is unavailable. */
		}
	}, []);
	function toggle() {
		const next = !masked;
		setMasked(next);
		try {
			localStorage.setItem("tpd:maskAmounts", String(next));
		} catch {
			/* The toggle still works without persistence. */
		}
	}
	return (
		<MaskContext.Provider value={{ masked, toggle }}>
			{children}
		</MaskContext.Provider>
	);
}

export const useMask = () => useContext(MaskContext);
