import React, { useEffect, useState, useRef } from 'react'

import { cue_sorter } from '../utils/sorters.js';
import { get_DCA_label } from './utils/cue_utils.js';
import { get_dca_level, format_dca_level } from '../utils/dca_levels.js';
import DCALevelDialog from './DCALevelDialog.jsx';

import { 
	HEADER_COLOR, ACTIVE_CUE_ACCENT, ACTIVE_CUE_TINT, BORDER_COLOR, 
	DEFAULT_ROW_COLOR, TEXT_COLOR, SELECTED_COLOR,
	get_cue_color
} from './utils/colors.jsx';
import JumpDialog from './JumpDialog.jsx';
import { format_cue_number, parse_cue_number } from '../utils/cue_number.js';


// Fills the space under the toolbar, with an even 10px margin on every side
const CONTAINER_STYLE = {
	flex: 1,
	minHeight: 0,
	display: "flex",
	padding: "10px"
}

// The bordered box the cue list scrolls inside, so both scrollbars sit within the border
const SCROLL_BOX_STYLE = {
	flex: 1,
	minWidth: 0,
	overflow: 'auto',
	backgroundColor: "#000",
	border: '1px solid ' + BORDER_COLOR,
}

// Columns: cue number (fixed), text (wider), DCAs share the rest equally.
// Below the minimum width (DCAs ~96px each) the table scrolls sideways inside the box.
const CUE_COLUMN_WIDTH = 72;
const TEXT_COLUMN_WIDTH = '20%';
const TABLE_MIN_WIDTH = 1050;

const TABLE_STYLE = {
	width: '100%', 
	minWidth: TABLE_MIN_WIDTH,
	tableLayout: 'fixed',
	borderCollapse: 'collapse', 
	textAlign: 'left', 
	color: TEXT_COLOR,
	fontFamily: 'Arial',
}

// Header stays visible while scrolling (a shadow stands in for the bottom border,
// which border-collapse doesn't keep on sticky cells)
const HEADER_ITEM_STYLE = {
	position: 'sticky',
	top: 0,
	zIndex: 1,
	backgroundColor: HEADER_COLOR,
	padding: '6px',
	border: '1px solid ' + BORDER_COLOR,
	boxShadow: `inset 0 -3px 0 ${BORDER_COLOR}`,
	textAlign: 'center',
	fontSize: 15,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap'
}

const ROW_ITEM_STYLE = {
	padding: '4px 6px', 
	border: '1px solid ' + BORDER_COLOR,
	fontSize: 22,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap'
}

const CUE_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
}

const LINE_CHECKS_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	fontStyle: 'italic'
}

const DCA_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
}

const ASSIGNED_DCA_ITEM_STYLE = {
	...DCA_ITEM_STYLE,
	cursor: 'pointer'
}

const DCA_LEVEL_STYLE = {
	fontSize: 13,
	opacity: 0.75
}

const DCA_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8];

// QLab cue number column (shown when the show recalls QLab cues)
const QLAB_COLUMN_WIDTH = 70;

// View → Row Size
const ROW_FONT_SIZES = {small: 16, medium: 22, large: 30};

// Outline for the selected cue (separate from the active cue's background)
const SELECTED_ROW_STYLE = {
	outline: `3px solid ${SELECTED_COLOR}`,
	outlineOffset: '-3px'
}

/**
 * A cue row's style. The active cue keeps its own color (so its color coding still shows) and
 * is marked with a green tint and bold text; its cue number cell gets a green bar (active_cell).
 * @param {String} color the cue's color
 * @param {boolean} active
 * @param {boolean} selected
 */
const row_style = (color, active, selected) => ({
	backgroundColor: color,
	...(active ? {backgroundImage: `linear-gradient(${ACTIVE_CUE_TINT}, ${ACTIVE_CUE_TINT})`, fontWeight: 'bold'} : {}),
	...(selected ? SELECTED_ROW_STYLE : {}),
});

// The active cue's number cell: a bar down its left edge
const active_cell = (style, active) => active
	? {...style, boxShadow: `inset 9px 0 0 ${ACTIVE_CUE_ACCENT}`}
	: style;

/**
 * Is the user typing in a text field? (Undo / Redo / Space should go to the field)
 * @param {Element} el 
 * @returns {boolean}
 */
const is_text_field = (el) => {
	if (!el) return false;
	if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
	return el.tagName === 'INPUT' && el.type !== 'range';
}

/**
 * Does a DCA have any channels assigned in this cue?
 * @param {Cue} cue 
 * @param {Number} dca 
 * @returns {boolean}
 */
const has_channels = (cue, dca) => {
	const value = cue[`dca${String(dca).padStart(2, "0")}Channels`];

	return String(value ?? "").split(",").some((ch) => ch.trim() !== "");
}


/**
 * @typedef {Object} EditorProps
 * @property {Object} showData - all the data of a show database
 * @property {function} setShowData - function that sets the show data
 */


/**
 * 
 * @param {EditorProps} props 
 * @returns 
 */
const Editor = ({showData, setShowData}) => {

	const rowRefs = useRef({});

	const [cue_index, set_index] = useState(-1);

	// Cue selected by clicking (Jump to Selected Cue); the active cue is cue_index
	const [selected_index, set_selected_index] = useState(null);

	/** @type {[{cue: Cue, dca: Number} | null, Function]} DCA whose level is being edited */
	const [level_dialog, set_level_dialog] = useState(null);

	const [jump_dialog_open, set_jump_dialog_open] = useState(false);

	// View menu preferences
	const [view, set_view] = useState({rowSize: 'medium', lockEditing: false});

	const dialog_open = level_dialog !== null || jump_dialog_open;

	// TheatreMix: Show Setup → QLab → "Recall QLab cues" adds a QLab column
	const show_qlab = showData?.config?.qLabCues === "1";

	/**
	 * Apply the current row size to a cell style
	 * @param {Object} style 
	 */
	const sized = (style) => ({...style, fontSize: ROW_FONT_SIZES[view.rowSize] ?? ROW_FONT_SIZES.medium});

	
	/**
	 * Fire Cue
	 * @param {Int} row_index 
	 * @param {{back?: boolean}} options back: fired by the Back button
	 */
	const fireCue = async (row_index, {back = false} = {}) => {
		if (row_index == -1) {
			fireSoundCheck();
			return;
		}

		const cue = getCues()[row_index];

		
		const modified_cue = {
			...cue, 
			dca01Label: get_DCA_label(showData, cue, 1),
			dca02Label: get_DCA_label(showData, cue, 2),
			dca03Label: get_DCA_label(showData, cue, 3),
			dca04Label: get_DCA_label(showData, cue, 4),
			dca05Label: get_DCA_label(showData, cue, 5),
			dca06Label: get_DCA_label(showData, cue, 6),
			dca07Label: get_DCA_label(showData, cue, 7),
			dca08Label: get_DCA_label(showData, cue, 8),
			dca09Label: get_DCA_label(showData, cue, 9),
			dca10Label: get_DCA_label(showData, cue, 10),
			dca11Label: get_DCA_label(showData, cue, 11),
			dca12Label: get_DCA_label(showData, cue, 12),
		}
		console.log("[Editor] Firing cue: ", modified_cue)

		await window.presonus.write_cue(modified_cue, {back});
	}


	/**
	 * Fire Sound Check Cue
	 */
	const fireSoundCheck = async () => {
		console.log("[Editor] Firing SOUND CHECK CUE!");

		await window.presonus.fire_sound_check();
	}


	/**
	 * Go To Row
	 * @param {Integer} row_index 
	 * @param {{back?: boolean}} options back: fired by the Back button
	 */
	const goToRow = (row_index, options = {}) => {
		const targetRow = rowRefs.current[row_index + 1];
		if (targetRow ) {

			set_index(row_index);
			fireCue(row_index, options);

			// Trigger the native smooth scroll function
			targetRow.scrollIntoView({
				behavior: 'smooth',
				block: 'center', // Options: 'start', 'center', 'end', 'nearest'
			});
		}
	};


	/**
	 * Handle Global Key Press
	 * @param {Event} event 
	 * @fires goToRow()
	 */
	const handleGlobalKey = (event) => {
		event.preventDefault();
		// Don't fire cues while a popup is open or while typing
		if (dialog_open || is_text_field(event.target)) {
			return;
		}

		console.log(event.code);


		if ((event.ctrlKey && event.code === 'Space') || event.code == 'ArrowUp') {
			event.preventDefault();
			goToRow(cue_index - 1, {back: true});
		}
		else if (event.code === 'Space' || event.code == 'ArrowDown') {
			event.preventDefault();
			goToRow(cue_index + 1);
		}

	};

	/**
	 * 
	 * @returns 
	 */
	const getCues = () => {
		if (showData == null || showData.cues === undefined || showData.cues === null) {
			return [];
		}
		return showData.cues.sort((a,b) => cue_sorter(a,b));

	}

	/**
	 * Save the level from the popup
	 * @param {Number | null} level dB, or null to keep the level (follow the people on the DCA)
	 */
	const saveDcaLevel = async (level) => {
		const {cue, dca} = level_dialog;
		set_level_dialog(null);

		const dcaLevels = await window.showApi.setDcaLevel(cue.number, cue.point, dca, level);

		setShowData((prev) => ({...prev, dcaLevels}));
	}

	/**
	 * Action → Jump...: fire a cue by its number ("12", "12.5", or "0" for line checks)
	 * @param {String} text 
	 * @returns {String | undefined} error message if the cue doesn't exist
	 */
	const jumpToCueNumber = (text) => {
		const parsed = parse_cue_number(text);
		if (!parsed) return "Enter a cue number like 12 or 12.5";

		const {number, point} = parsed;
		const is_line_checks = number === 0 && point === 0;

		const index = is_line_checks
			? -1
			: getCues().findIndex((cue) => Number(cue.number) === number && Number(cue.point) === point);

		if (index === -1 && !is_line_checks) return `There is no cue ${format_cue_number(number, point)}`;

		set_jump_dialog_open(false);
		goToRow(index);
	}

	/**
	 * Action → Test QLab Recall: start the selected (or current) cue's QLab cue
	 * without firing the cue
	 */
	const testQLabRecall = async () => {
		const row = selected_index ?? cue_index;
		const cue = row >= 0 ? getCues()[row] : null;

		if (!cue?.qLabCue) {
			console.log("[Editor] Test QLab Recall: the selected cue has no QLab cue");
			return;
		}

		const result = await window.qlabApi.recall(cue.qLabCue);
		if (!result.ok) {
			console.warn(`[Editor] Test QLab Recall failed: ${result.error}`);
		}
	}

	/**
	 * OSC /select: move the selection up, down, or to the current cue
	 * @param {'up' | 'down' | 'current'} direction 
	 */
	const moveSelection = (direction) => {
		const last = getCues().length - 1;
		const from = selected_index ?? cue_index;

		const next = direction === 'current' ? cue_index
			: direction === 'up' ? Math.max(-1, from - 1)
			: Math.min(last, from + 1);

		set_selected_index(next);
		rowRefs.current[next + 1]?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
	}

	/**
	 * Edit → Undo / Redo: text fields get a normal undo, otherwise undo DCA level edits
	 * @param {'undo' | 'redo'} action 
	 */
	const undoRedo = async (action) => {
		if (is_text_field(document.activeElement)) {
			document.execCommand(action);
			return;
		}

		if (showData === null || view.lockEditing) return;

		const dcaLevels = action === 'undo'
			? await window.showApi.undoDcaLevel()
			: await window.showApi.redoDcaLevel();

		if (dcaLevels !== null) {
			setShowData((prev) => ({...prev, dcaLevels}));
		}
	}

	/**
	 * Commands from the app menu, toolbar and OSC
	 * @param {String | {action: String, arg?: any, remote?: boolean}} message 
	 */
	const handleMenuAction = (message) => {
		const {action, arg, remote = false} = typeof message === 'string' ? {action: message} : message;

		if (action === 'undo' || action === 'redo') {
			undoRedo(action);
			return;
		}

		// Menu shortcuts are ignored while a popup is open; OSC commands still run
		if ((dialog_open && !remote) || showData === null) return;

		switch (action) {
			case 'go':
				goToRow(cue_index + 1);
				break;
			case 'back':
				goToRow(cue_index - 1, {back: true});
				break;
			case 'jump-to':
				jumpToCueNumber(String(arg));
				break;
			case 'select':
				moveSelection(arg);
				break;
			case 'test-qlab':
				testQLabRecall();
				break;
			case 'jump':
				set_jump_dialog_open(true);
				break;
			case 'jump-selected':
				if (selected_index !== null) goToRow(selected_index);
				break;
		}
	}

	// The subscription is made once, so always call the latest handler
	const menuHandlerRef = useRef(handleMenuAction);
	menuHandlerRef.current = handleMenuAction;

	useEffect(() => {
		const unsubscribeMenu = window.menuApi.onMenuAction((action) => menuHandlerRef.current(action));
		const unsubscribeView = window.menuApi.onViewSettings(set_view);

		window.menuApi.getViewSettings().then(set_view);

		return () => {
			unsubscribeMenu();
			unsubscribeView();
		};
	}, []);

	// Show closed: clear the active / selected cue
	useEffect(() => {
		if (showData === null) {
			set_index(-1);
			set_selected_index(null);
		}
	}, [showData]);

	useEffect(() => {

		window.addEventListener('keydown', handleGlobalKey);
		
		// Clean up listener when component unmounts
		return () => window.removeEventListener('keydown', handleGlobalKey);
	}, [cue_index, dialog_open]);

	/**
	 * Double click a cue number / label to jump to it. Like TheatreMix, when editing
	 * is unlocked you need to hold ⌘/Ctrl so a stray double click doesn't fire a cue.
	 * @param {Event} event 
	 * @param {Number} row_index 
	 */
	const handleCueDoubleClick = (event, row_index) => {
		if (view.lockEditing || event.metaKey || event.ctrlKey) {
			goToRow(row_index);
		}
	}


	return <div style={CONTAINER_STYLE}>
		<div style={SCROLL_BOX_STYLE}>
		<table style={TABLE_STYLE}>
			<colgroup>
				<col style={{width: CUE_COLUMN_WIDTH}}/>
				<col style={{width: TEXT_COLUMN_WIDTH}}/>
				{show_qlab && <col style={{width: QLAB_COLUMN_WIDTH}}/>}
				{DCA_NUMBERS.map((dca) => <col key={dca}/>)}
			</colgroup>
		
			{/* Table Header */}
			<thead>
			<tr>
				<th style={HEADER_ITEM_STYLE}>Cue</th>
				<th style={HEADER_ITEM_STYLE}>Text</th>
				{show_qlab && <th style={HEADER_ITEM_STYLE}>QLab</th>}
				{DCA_NUMBERS.map((dca) => <th key={dca} style={HEADER_ITEM_STYLE}>DCA {dca}</th>)}
			</tr>
			</thead>
			
			{/* Table Body */}
			<tbody>
				<tr 
					key={-1} 
					style={row_style(get_cue_color(-1), -1 === cue_index, selected_index === -1)}
					aria-current={-1 === cue_index ? "true" : undefined}
					ref={(el) => (rowRefs.current[0] = el)}
					onClick={() => set_selected_index(-1)}
				>
					<td style={active_cell(sized(CUE_ITEM_STYLE), -1 === cue_index)} onDoubleClick={(e) => handleCueDoubleClick(e, -1)}>0</td>
					<td style={sized(LINE_CHECKS_ITEM_STYLE)} onDoubleClick={(e) => handleCueDoubleClick(e, -1)}>Line Checks</td>
					{show_qlab && <td style={sized(CUE_ITEM_STYLE)}></td>}
					{DCA_NUMBERS.map((dca) => <td key={dca} style={sized(DCA_ITEM_STYLE)}></td>)}
				</tr>
				{/* 3. Loop through your data array using .map() */}
				{getCues().map((cue, index) => (
					<tr 
						key={index} 
						style={row_style(get_cue_color(cue.colour), index === cue_index, selected_index === index)}
						aria-current={index === cue_index ? "true" : undefined}
						ref={(el) => (rowRefs.current[index + 1] = el)}
						onClick={() => set_selected_index(index)}
					>
						<td style={active_cell(sized(CUE_ITEM_STYLE), index === cue_index)} onDoubleClick={(e) => handleCueDoubleClick(e, index)}>{format_cue_number(cue.number, cue.point)}</td>
						<td style={sized(ROW_ITEM_STYLE)} onDoubleClick={(e) => handleCueDoubleClick(e, index)} title={cue.name}>{cue.name}</td>
						{show_qlab && <td style={sized(CUE_ITEM_STYLE)} title={cue.qLabCue ? `QLab cue ${cue.qLabCue}` : undefined}>{cue.qLabCue}</td>}
						{DCA_NUMBERS.map((dca) => {
							const assigned = has_channels(cue, dca);
							const editable = assigned && !view.lockEditing;
							const level = get_dca_level(showData.dcaLevels, cue, dca);

							return (
								<td
									key={dca}
									style={sized(editable ? ASSIGNED_DCA_ITEM_STYLE : DCA_ITEM_STYLE)}
									onClick={editable ? () => set_level_dialog({cue, dca}) : undefined}
									title={editable ? "Click to set the level this DCA comes up at" : undefined}
								>
									{get_DCA_label(showData, cue, dca)}
									{assigned && level !== null
										? <div style={DCA_LEVEL_STYLE}>{format_dca_level(level)}</div>
										: null}
								</td>
							);
						})}
					</tr>
				))}
			</tbody>

		</table>
		</div>

		{level_dialog !== null && (
			<DCALevelDialog
				title={`Cue ${level_dialog.cue.number}.${level_dialog.cue.point} — DCA ${level_dialog.dca}`}
				label={get_DCA_label(showData, level_dialog.cue, level_dialog.dca)}
				level={get_dca_level(showData.dcaLevels, level_dialog.cue, level_dialog.dca)}
				onSave={saveDcaLevel}
				onCancel={() => set_level_dialog(null)}
			/>
		)}

		{jump_dialog_open && (
			<JumpDialog
				onJump={jumpToCueNumber}
				onCancel={() => set_jump_dialog_open(false)}
			/>
		)}
	</div>;
}

export default Editor;