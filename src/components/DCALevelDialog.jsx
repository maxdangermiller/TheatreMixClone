import React, { useEffect, useRef, useState } from 'react';

import { BACKGROUND_COLOR, BORDER_COLOR, HEADER_COLOR, TEXT_COLOR, SELECTED_COLOR } from './utils/colors.jsx';
import {
	MIN_DCA_LEVEL, MAX_DCA_LEVEL, DEFAULT_DCA_LEVEL,
	clamp_dca_level, format_dca_level, level_to_fader, fader_to_level
} from '../utils/dca_levels.js';

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
	width: "420px",
	fontFamily: "Arial",
	boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
	overflow: "hidden"
}

const HEADER_STYLE = {
	backgroundColor: HEADER_COLOR,
	padding: "12px 16px",
	fontSize: 18,
	fontWeight: "bold"
}

const BODY_STYLE = {
	padding: "16px",
	display: "flex",
	flexDirection: "column",
	gap: "14px"
}

const READOUT_STYLE = {
	fontSize: 40,
	textAlign: "center",
	fontVariantNumeric: "tabular-nums"
}

const HINT_STYLE = {
	fontSize: 13,
	opacity: 0.7,
	textAlign: "center"
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

const PRIMARY_BUTTON_STYLE = {
	...BUTTON_STYLE,
	backgroundColor: SELECTED_COLOR,
	borderColor: SELECTED_COLOR
}

/**
 * @typedef {Object} DCALevelDialogProps
 * @property {String} title - e.g. "Cue 2.0 — DCA 3"
 * @property {String} label - DCA label shown under the title
 * @property {Number | null} level - current level in dB, or null if using the default
 * @property {Function} onSave - called with the new level in dB, or null to use the default
 * @property {Function} onCancel
 */

/**
 * Popup to set the level a DCA comes up at in a cue
 * @param {DCALevelDialogProps} props
 */
const DCALevelDialog = ({title, label, level, onSave, onCancel}) => {
	const [value, setValue] = useState(level ?? DEFAULT_DCA_LEVEL);
	const [text, setText] = useState(String(level ?? DEFAULT_DCA_LEVEL));
	const sliderRef = useRef(null);

	const usingDefault = level === null;

	const update = (db) => {
		const clamped = clamp_dca_level(db);
		setValue(clamped);
		setText(String(clamped));
	}

	const commitText = () => {
		const parsed = parseFloat(text);

		if (Number.isNaN(parsed)) {
			setText(String(value));
		} else {
			update(Math.round(parsed * 2) / 2);
		}
	}

	// Enter saves, Escape cancels. Capture phase + stopPropagation keeps the
	// Editor's Space / arrow shortcuts from firing cues while this is open.
	useEffect(() => {
		const handleKey = (event) => {
			if (event.key === 'Escape') {
				onCancel();
			} else if (event.key === 'Enter') {
				const parsed = parseFloat(text);
				onSave(Number.isNaN(parsed) ? value : clamp_dca_level(Math.round(parsed * 2) / 2));
			}
			event.stopPropagation();
		}

		window.addEventListener('keydown', handleKey, true);
		return () => window.removeEventListener('keydown', handleKey, true);
	}, [text, value, onSave, onCancel]);

	useEffect(() => {
		sliderRef.current?.focus();
	}, []);

	return (
		<div style={OVERLAY_STYLE} onMouseDown={onCancel}>
			<div style={DIALOG_STYLE} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
				<div style={HEADER_STYLE}>
					{title}
					{label ? <div style={{fontSize: 14, fontWeight: "normal", opacity: 0.8, marginTop: 4}}>{label}</div> : null}
				</div>

				<div style={BODY_STYLE}>
					<div style={READOUT_STYLE}>{format_dca_level(value)}</div>

					<input
						ref={sliderRef}
						type="range"
						min={0}
						max={100}
						step={0.1}
						value={level_to_fader(value)}
						onChange={(e) => update(fader_to_level(parseFloat(e.target.value)))}
						onDoubleClick={() => update(DEFAULT_DCA_LEVEL)}
						style={{width: "100%", cursor: "pointer"}}
						aria-label="DCA level"
					/>

					<label style={{display: "flex", alignItems: "center", gap: "8px", justifyContent: "center"}}>
						Level
						<input
							type="number"
							min={MIN_DCA_LEVEL}
							max={MAX_DCA_LEVEL}
							step={0.5}
							value={text}
							onChange={(e) => setText(e.target.value)}
							onBlur={commitText}
							style={{width: "80px", fontSize: 16, textAlign: "right"}}
						/>
						dB
					</label>

					<div style={HINT_STYLE}>
						{usingDefault
							? `Currently using the default (${format_dca_level(DEFAULT_DCA_LEVEL)}).`
							: `Default is ${format_dca_level(DEFAULT_DCA_LEVEL)}.`}
						<br/>
						Applied when this DCA is newly assigned in this cue.
					</div>
				</div>

				<div style={{display: "flex", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid " + BORDER_COLOR}}>
					<button style={BUTTON_STYLE} onClick={() => onSave(null)} disabled={usingDefault}>
						Use Default
					</button>
					<span style={{display: "flex", gap: "10px"}}>
						<button style={BUTTON_STYLE} onClick={onCancel}>Cancel</button>
						<button style={PRIMARY_BUTTON_STYLE} onClick={() => onSave(value)}>Save</button>
					</span>
				</div>
			</div>
		</div>
	);
}

export default DCALevelDialog;
