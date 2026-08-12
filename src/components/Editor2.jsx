import React, { useEffect, useState, useRef } from 'react'

import { is_ip_valid, ip_regex } from '../utils/ip_tools';
import { cue_sorter } from '../utils/sorters.js';

import Cue from '../models/Cue.js';


// const mixers = await window.presonus.discover();

// console.log(mixers);

let counter = 1;

const show = await window.showApi.loadShow('./LionKingKidsV2.db');
const sorted_cues = show.cues.sort((a,b) => cue_sorter(a,b));

const HEADER_COLOR = "#f2f2f2"
const BORDER_COLOR = "#dddddd"
const ACTIVE_CUE_COLOR = "#626198"
const REG_CUE_COLOR = "#ffffff"


const Editor = (params) => {

	const rowRefs = useRef({});

	const [cue_index, set_index] = useState(0);

	const addCue = () => {
		
	}

	/**
	 * Get DCA Label
	 * @param {Cue} cue 
	 * @param {Integer} dca_number 
	 * @returns 
	 */
	const get_DCA_label = (cue, dca_number) => {
		let prefix = "dca";

		if (dca_number < 10) {
			prefix += "0";
		}
		
		const channels = cue[`${prefix}${dca_number}Channels`].replace(" ", "").split(",");
		const label = cue[`${prefix}${dca_number}Label`];

		if (label !== null && typeof(label) === String && label !== "") {
			// Use specified label
			return label;
		}

		// Find default label
		if (channels.length === 0) {
			return "~";
		}

		const def_chan = parseInt(channels[0]);

		if (def_chan === NaN) {
			return "~";
		}

		for (const profile of show.profiles) {
			if (profile.channel === def_chan) {
				if (profile.label !== null) {
					return profile.label;
				}

				return profile.name;
			}
		}

		return "-"
	}


	const fireCue = async (row_index) => {
		const cue = sorted_cues[row_index];

		
		const modified_cue = {
			...cue, 
			dca01Label: get_DCA_label(cue, 1),
			dca02Label: get_DCA_label(cue, 2),
			dca03Label: get_DCA_label(cue, 3),
			dca04Label: get_DCA_label(cue, 4),
			dca05Label: get_DCA_label(cue, 5),
			dca06Label: get_DCA_label(cue, 6),
			dca07Label: get_DCA_label(cue, 7),
			dca08Label: get_DCA_label(cue, 8),
			dca09Label: get_DCA_label(cue, 9),
			dca10Label: get_DCA_label(cue, 10),
			dca11Label: get_DCA_label(cue, 11),
			dca12Label: get_DCA_label(cue, 12),
		}
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

	useEffect(() => {
		console.log(show);
	}, [])

	useEffect(() => {

		window.addEventListener('keydown', handleGlobalKey);
		
		// Clean up listener when component unmounts
		return () => window.removeEventListener('keydown', handleGlobalKey);
	}, [cue_index]);


	return <>
		<table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
		
			{/* Table Header */}
			<thead>
			<tr style={{ backgroundColor: HEADER_COLOR }}>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>#</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>Label</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 1</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 2</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 3</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 4</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 5</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 6</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 7</th>
				<th style={{ padding: '10px', borderBottom: '2px solid ' + BORDER_COLOR }}>DCA 8</th>
			</tr>
			</thead>
			
			{/* Table Body */}
			<tbody>
			{/* 3. Loop through your data array using .map() */}
			{sorted_cues.map((cue, index) => (
				<tr 
					key={index} 
					style={{backgroundColor: index === cue_index ? ACTIVE_CUE_COLOR : REG_CUE_COLOR}}
					ref={(el) => (rowRefs.current[index] = el)}
				>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{cue.number}.{cue.point}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{cue.name}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 1)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 2)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 3)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 4)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 5)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 6)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 7)}</td>
					<td style={{ padding: '10px', borderBottom: '1px solid ' + BORDER_COLOR }}>{get_DCA_label(cue, 8)}</td>
				</tr>
			))}
			</tbody>

		</table>
		<button onClick={addCue}>Add</button>
	</>;
}

export default Editor;