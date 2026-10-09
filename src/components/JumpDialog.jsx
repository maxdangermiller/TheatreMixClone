import React, { useEffect, useRef, useState } from 'react';

import { BACKGROUND_COLOR, BORDER_COLOR, HEADER_COLOR, TEXT_COLOR, SELECTED_COLOR } from './utils/colors.jsx';

const OVERLAY_STYLE = {
	position: "fixed",
	inset: 0,
	backgroundColor: "rgba(0, 0, 0, 0.6)",
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	zIndex: 100
}

const DIALOG_STYLE = {
	backgroundColor: BACKGROUND_COLOR,
	color: TEXT_COLOR,
	border: "2px solid " + BORDER_COLOR,
	borderRadius: "8px",
	width: "320px",
	fontFamily: "Arial",
	boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
	overflow: "hidden"
}

const BUTTON_STYLE = {
	fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
	fontSize: "1rem",
	color: TEXT_COLOR,
	backgroundColor: "transparent",
	border: "1px solid #6c757d",
	borderRadius: "0.375rem",
	padding: "0.375rem 0.75rem",
	cursor: "pointer"
}

/**
 * @typedef {Object} JumpDialogProps
 * @property {Function} onJump - called with the typed cue number; returns an error string if it isn't found
 * @property {Function} onCancel
 */

/**
 * Popup to jump to a cue by number (Action → Jump...)
 * @param {JumpDialogProps} props
 */
const JumpDialog = ({onJump, onCancel}) => {
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const inputRef = useRef(null);

	const submit = () => {
		const result = onJump(text.trim());
		if (result) setError(result);
	}

	// Enter jumps, Escape cancels. Capture + stopPropagation keeps the cue list's
	// Space shortcut from firing cues while typing.
	useEffect(() => {
		const handleKey = (event) => {
			if (event.key === 'Escape') {
				onCancel();
			} else if (event.key === 'Enter') {
				submit();
			}
			event.stopPropagation();
		}

		window.addEventListener('keydown', handleKey, true);
		return () => window.removeEventListener('keydown', handleKey, true);
	}, [text, onJump, onCancel]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	return (
		<div style={OVERLAY_STYLE} onMouseDown={onCancel}>
			<div style={DIALOG_STYLE} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Jump to Cue">
				<div style={{backgroundColor: HEADER_COLOR, padding: "12px 16px", fontSize: 18, fontWeight: "bold"}}>
					Jump to Cue
				</div>

				<div style={{padding: "16px", display: "flex", flexDirection: "column", gap: "8px"}}>
					<input
						ref={inputRef}
						value={text}
						onChange={(e) => { setText(e.target.value); setError(""); }}
						placeholder="Cue number, e.g. 12 or 12.5"
						style={{fontSize: 18, padding: "6px"}}
						aria-label="Cue number"
					/>
					<div style={{minHeight: "1.2em", fontSize: 13, color: "#ff8a8a"}}>{error}</div>
				</div>

				<div style={{display: "flex", justifyContent: "flex-end", gap: "10px", padding: "12px 16px", borderTop: "1px solid " + BORDER_COLOR}}>
					<button style={BUTTON_STYLE} onClick={onCancel}>Cancel</button>
					<button style={{...BUTTON_STYLE, backgroundColor: SELECTED_COLOR, borderColor: SELECTED_COLOR}} onClick={submit}>Jump</button>
				</div>
			</div>
		</div>
	);
}

export default JumpDialog;
