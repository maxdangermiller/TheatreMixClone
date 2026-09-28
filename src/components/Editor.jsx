import React, { useEffect, useState, useRef } from 'react'

import { is_ip_valid, ip_regex } from '../utils/ip_tools.js';
import { cue_sorter } from '../utils/sorters.js';
import { get_DCA_label } from './utils/cue_utils.js';

import { 
	HEADER_COLOR, ACTIVE_CUE_COLOR, BORDER_COLOR, 
	DEFAULT_ROW_COLOR, TEXT_COLOR,
	get_cue_color
} from './utils/colors.jsx';


const CONTAINER_STYLE = {
	height: "80vh",
	width: "100%",
	overflowX: 'auto',
	overflowY: 'auto',
	padding: "10px"
}

const TABLE_STYLE = {
	width: '100%', 
	borderCollapse: 'collapse', 
	textAlign: 'left', 
	color: TEXT_COLOR,
	position: 'sticky',
	fontFamily: 'Arial'
}

const HEADER_ITEM_STYLE = {
	padding: '6px',
	border: '2px solid ' + BORDER_COLOR,
	borderBottom: '4px solid ' + BORDER_COLOR,
	textAlign: 'center',
}

const LABEL_HEADER_STYLE = {
	...HEADER_ITEM_STYLE,
	width: '10%!important'
}


const DCA_HEADER_STYLE = {
	...HEADER_ITEM_STYLE,
	minWidth: '50px'
}

const ROW_ITEM_STYLE = {
	padding: '4px', 
	border: '1px solid ' + BORDER_COLOR,
	fontSize: 22,
	maxHeight: '100%',
	overflowX: 'auto',
	whiteSpace: 'nowrap'
}

const CUE_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
}

const DCA_ITEM_STYLE = {
	...ROW_ITEM_STYLE,
	textAlign: 'center'
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

	const [cue_index, set_index] = useState(0);

	const addCue = () => {
		
	}

	

	const fireCue = async (row_index) => {
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
		console.log("[Editor2] Firing cue: ", cue)
		console.log("[Editor2] Firing (modified) cue: ", modified_cue)

		await window.presonus.write_cue(modified_cue);
	}


	/**
	 * Go To Row
	 * @param {Integer} row_index 
	 */
	const goToRow = (row_index) => {
		const targetRow = rowRefs.current[row_index];
		if (targetRow) {

			set_index(row_index);
			fireCue(row_index);

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
		// Check for combinations like Ctrl + S
		if (event.ctrlKey && event.key === 's') {
			event.preventDefault(); // Stop native browser save popup
			console.log('Global Save Triggered');
		}
		

		if (event.ctrlKey && event.code === 'Space') {
			event.preventDefault();
			goToRow(cue_index - 1);
		}
		else if (event.code === 'Space') {
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

	useEffect(() => {

		window.addEventListener('keydown', handleGlobalKey);
		
		// Clean up listener when component unmounts
		return () => window.removeEventListener('keydown', handleGlobalKey);
	}, [cue_index]);


	return <div style={CONTAINER_STYLE}>
		<table style={TABLE_STYLE}>
		
			{/* Table Header */}
			<thead>
			<tr style={{ backgroundColor: HEADER_COLOR }}>
				<th style={HEADER_ITEM_STYLE}>#</th>
				<th style={LABEL_HEADER_STYLE}>Label</th>
				<th style={DCA_HEADER_STYLE}>DCA 1</th>
				<th style={DCA_HEADER_STYLE}>DCA 2</th>
				<th style={DCA_HEADER_STYLE}>DCA 3</th>
				<th style={DCA_HEADER_STYLE}>DCA 4</th>
				<th style={DCA_HEADER_STYLE}>DCA 5</th>
				<th style={DCA_HEADER_STYLE}>DCA 6</th>
				<th style={DCA_HEADER_STYLE}>DCA 7</th>
				<th style={DCA_HEADER_STYLE}>DCA 8</th>
			</tr>
			</thead>
			
			{/* Table Body */}
			<tbody>
			{/* 3. Loop through your data array using .map() */}
			{getCues().map((cue, index) => (
				<tr 
					key={index} 
					style={{
						backgroundColor: index === cue_index ? ACTIVE_CUE_COLOR : get_cue_color(cue.colour),
					}}
					ref={(el) => (rowRefs.current[index] = el)}
				>
					<td style={CUE_ITEM_STYLE}>{cue.number}.{cue.point}</td>
					<td style={ROW_ITEM_STYLE}>{cue.name}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 1)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 2)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 3)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 4)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 5)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 6)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 7)}</td>
					<td style={DCA_ITEM_STYLE}>{get_DCA_label(showData, cue, 8)}</td>
				</tr>
			))}
			</tbody>

		</table>
	</div>;
}

export default Editor;