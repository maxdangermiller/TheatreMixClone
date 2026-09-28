import React, { useEffect, useState } from 'react'

import { is_ip_valid, ip_regex } from '../utils/ip_tools';

import FileDialogue from './FileDialogue';
import ShowFile from '../models/ShowFile';

/**
 * @typedef {Object} ClientManagerProps
 * @property {ShowFile} showData
 * @property {Function} setShowData
 */

/**
 * Client Manager
 * @param {ClientManagerProps} params 
 */
const ClientManager = ({showData, setShowData}) => {

	const [ consoleIP, setConsoleIP ] = useState("169.254.4.171");
	const [ valid, setValid ] = useState(false);
	const [ options, setOptions] = useState([]);
	

	/**
	 * 
	 * @param {Event} event 
	 */
	const handle_ip_change = (event) => {
		const value = event.target.value;

		if (ip_regex(value)) {
			setConsoleIP(value);
		}

		if (is_ip_valid(value) !== valid) {
			setValid(is_ip_valid(value));
		}
	}

	const connect = async () => {
		if (!is_ip_valid(consoleIP)) {
			setValid(false);
		}
		else {
			console.log("Connecting to console at '" + consoleIP + "'.")

			try {
				console.log('Connecting...');

				const result = await window.presonus.connect(
					consoleIP,
					53000
				);

				console.log('Connection result:', result);
			} catch (error) {
				console.error('Connection failed:', error);
			}
		}
	}


	return <>
		<label style={{outlineColor: valid ? "black" : "red"}}>
			IP Address: 
			<input value={consoleIP} onChange={handle_ip_change} style={{outlineColor: valid ? "black" : "red"}}/>
		</label>
		<button onClick={connect}>Connect</button>
		<br/>

		{
			options.map((option, index) => (
				<h2 key={index}>{option}</h2>
			))
		}
	</>;
}

export default ClientManager;