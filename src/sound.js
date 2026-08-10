import { app, BrowserWindow, ipcMain } from 'electron';

import { Client, Discovery } from '@featherbear/presonus-studiolive-api';

import {convert_ip_to_octets, is_ip_valid} from './utils/ip_tools';

import DCA from './types/dca';

// Global Presonus Client Object
let presonusClient = null;

const CONTROLLED_LINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]


/**
 * Handle Presonus Discovery
 * @returns {Promise} discovery Info
 */
const discover = async () => {
	const discovery = new Discovery();
	const devices = [];

	console.log("[SOUND:discover]: Discovering PreSonous Consoles on the Network!")

	return new Promise((resolve) => {
		discovery.on('discover', (device) => {
			devices.push(device);
		});

		discovery.start(3000);

		setTimeout(() => {
			resolve(devices);
		}, 3500);
	});
}


/**
 * Connect to Console
 * @param {Event} _event 
 * @param {String} host 
 * @param {int} port 
 */
const connect = async (_event, {host, port}) => {
	console.log("[SOUND:connect]: Connecting to Sound Board at ip address: " + host + " on port " + port + ".")
	presonusClient = new Client({ host, port });

	await presonusClient.connect({
		clientDescription: 'Theatre Mix Board',
	}).then(() => {

		// Set channel 1 fader to -6 dB over a duration of 3 seconds
		client.setChannelVolumeLogarithmic({
			type: 'LINE',
			channel: 1
		}, -6, 3000).then(() => {

			// Unmute channel 2
			client.unmute({
				type: 'LINE',
				channel: 2
			})
		})

		console.log(`Version ${client.state.get('global.mixer_version')}`);
	});
}

/**
 * Set DCA on console
 * @param {Event} _event
 * @param {DCA} dca_object 
 */
const set_dta = async (_event, dca_object) => {
	console.log("[SOUND:set_dca]: Setting DCA #" + dca_object.number);

	if (typeof(presonusClient) !== Client) {
		throw new Error("Client has not yet been connected!");
		return;
	}

	const selector = dca_object.get_selector();

	presonusClient.setColor(selector, dca_object.color, 100)
	presonusClient.setChannelVolumeLogarithmic(selector, dca_object.level, 0);
	presonusClient.setName(selector, dca_object.name);

	for (const line in CONTROLLED_LINES) {
		const line_sel = {
			type: 'LINE',
			channel: line,
			mixType: 'DCA',
			mixNumber: dca_object.number
		}
		
		if (line in dca_object.channels) {
			presonusClient.unmute(line_sel);
			// TODO: Make the volume on each DCA adjustable?
			// Set the volume to unity
			presonusClient.setChannelVolumeLogarithmic(line_sel, 0);
		}
		else {
			presonusClient.mute();
		}
	}
}

// Subscribe all the functions
ipcMain.handle('presonus:discover', discover);
ipcMain.handle('presonus:connect', connect);
ipcMain.handle('presonus:set_dca', set_dta);

