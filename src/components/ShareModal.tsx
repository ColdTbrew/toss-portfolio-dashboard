import { useEffect, useRef, useState } from "react";
import { buildShareCardModel } from "../lib/shareCard";
import { drawShareCard } from "../lib/shareCardCanvas";
import type { PortfolioState } from "../lib/types";

export function ShareModal({
	state,
	onClose,
}: {
	state: PortfolioState;
	onClose: () => void;
}) {
	// Freeze the snapshot on opening; every new mount starts without amounts.
	const [snapshot] = useState(state);
	const [now] = useState(Date.now);
	const [includeAmounts, setIncludeAmounts] = useState(false);
	const [preview, setPreview] = useState<{
		url: string;
		blob: Blob;
		filename: string;
		includeAmounts: boolean;
	} | null>(null);
	const [message, setMessage] = useState("");
	const dialog = useRef<HTMLDialogElement>(null);
	const current = preview?.includeAmounts === includeAmounts ? preview : null;
	const canCopy =
		typeof navigator !== "undefined" &&
		!!navigator.clipboard?.write &&
		typeof ClipboardItem !== "undefined";
	useEffect(() => {
		const element = dialog.current;
		const previous = document.activeElement;
		element?.showModal();
		return () => {
			element?.close();
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, []);
	useEffect(() => {
		let cancelled = false;
		let url: string | undefined;
		setMessage("");
		async function render() {
			try {
				await document.fonts.ready;
				if (cancelled) return;
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("Canvas unavailable");
				const model = buildShareCardModel(snapshot, { includeAmounts, now });
				drawShareCard(
					ctx,
					model,
					document.documentElement.classList.contains("dark")
						? "dark"
						: "light",
				);
				canvas.toBlob((blob) => {
					if (cancelled) return;
					if (!blob) {
						setMessage("이미지를 만들지 못했어요. 다시 시도해 주세요.");
						return;
					}
					url = URL.createObjectURL(blob);
					setPreview({
						url,
						blob,
						filename: `portfolio-${model.date.replaceAll("-", "")}.png`,
						includeAmounts,
					});
				}, "image/png");
			} catch {
				if (!cancelled)
					setMessage("이미지를 만들지 못했어요. 다시 시도해 주세요.");
			}
		}
		void render();
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [snapshot, includeAmounts, now]);
	function save() {
		if (!current) return;
		const link = document.createElement("a");
		link.href = current.url;
		link.download = current.filename;
		link.click();
	}
	async function copy() {
		if (!current) return;
		try {
			await navigator.clipboard.write([
				new ClipboardItem({ "image/png": current.blob }),
			]);
			setMessage("클립보드에 복사했어요.");
		} catch {
			setMessage("복사할 수 없어요. PNG 저장을 이용해 주세요.");
		}
	}
	return (
		<dialog
			ref={dialog}
			className="share-modal"
			aria-labelledby="share-heading"
			onCancel={onClose}
		>
			<div className="modal-heading">
				<div>
					<h2 id="share-heading">포트폴리오 추출</h2>
				</div>
				<button
					type="button"
					className="icon-button"
					aria-label="닫기"
					onClick={onClose}
				>
					<svg
						aria-hidden="true"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="m6 6 12 12M6 18 18 6" />
					</svg>
				</button>
			</div>
			<div className="share-preview">
				{current ? (
					<img
						src={current.url}
						alt="포트폴리오 공유 이미지 미리보기"
						width={1080}
						height={1350}
					/>
				) : (
					<p>이미지를 준비하고 있어요…</p>
				)}
			</div>
			<label className="share-option">
				<input
					type="checkbox"
					checked={includeAmounts}
					onChange={(event) => setIncludeAmounts(event.target.checked)}
				/>
				금액 포함<span className="subtle">총자산 · 평가손익</span>
			</label>
			<div className="modal-actions">
				<button
					type="button"
					className="button primary-button"
					disabled={!current}
					onClick={save}
				>
					PNG 저장
				</button>
				{canCopy && (
					<button
						type="button"
						className="button"
						disabled={!current}
						onClick={() => void copy()}
					>
						클립보드 복사
					</button>
				)}
			</div>
			<output className="status-message">{message}</output>
		</dialog>
	);
}
