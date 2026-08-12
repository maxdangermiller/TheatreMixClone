import { app, BrowserWindow, ipcMain } from 'electron';

import { Client, Discovery } from '@featherbear/presonus-studiolive-api';

import {convert_ip_to_octets, is_ip_valid} from '../utils/ip_tools';

import DCA from '../types/dca';
import Cue from '../types/cue';

const fs = require('node:fs/promises');

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
	presonusClient = new Client({host: "169.254.4.171", port: 53000}, {autoreconnect: true, logLevel: "debug"});

	presonusClient.on('connected', () => {
		console.log("Connected to the device!")
	})

	presonusClient.on('reconnecting', () => {
		console.log("Reconnecting!")
	})
	presonusClient.on('closed', () => {
		console.log("Closed!")
	})
	

	await presonusClient.connect().then(() => {
		console.log("[SOUND:connect]: Connected to Sound Board.")
		// console.dir(presonusClient.dumpState(), { depth: null })
		fs.appendFile('state.json', JSON.stringify(presonusClient.dumpState(), null, 2));


		
		// Set channel 1 fader to -6 dB over a duration of 3 seconds
		presonusClient.setChannelVolumeLogarithmic({
			type: 'LINE',
			channel: 1
		}, -6, 3000).then(() => {


			// Unmute channel 2
			presonusClient.unmute({
				type: 'LINE',
				channel: 2
			})

			presonusClient.setChannelVolumeLogarithmic({
				type: 'LINE',
				channel: 1
			}, -100, 3000)
		})

		/*
		presonusClient.sendList('presets/channel').then(j => {
  			console.log('Got channel list', j)
  		})
			*/
		

		console.log(`Version ${presonusClient.state.get('global.mixer_version')}`);
	});
}

/**
 * Set DCA on console
 * @deprecated
 * @param {Event} _event
 * @param {DCA} dca_object 
 */
const set_dca = async (_event, {dca_object}) => {

	// TODO: Remove
	// /*
	let cue1 = new Cue()
	cue1.setDCA(new DCA(1, [1], "P1", 0, "#c92222"));
	cue1.setDCA(new DCA(2, [2], "P2", -10, "#c92222"));
	cue1.setDCA(new DCA(3, [3], "P3", -20, "#c92222"));
	cue1.setDCA(new DCA(4, [4], "P4", -10, "#c92222"));
	cue1.setDCA(new DCA(5, [5], "P5", 0, "#c92222"));
	cue1.setDCA(new DCA(6, [6], "P6", -10, "#c92222"));
	cue1.setDCA(new DCA(7, [7], "P7", -20, "#c92222"));
	cue1.setDCA(new DCA(8, [8], "P8", -10, "#c92222"));

	dca_object = cue1.getDCA(1);
	
	console.log("[SOUND:set_dca]: DCA Info: ", dca_object)
	console.log("[SOUND:set_dca]: Setting DCA #", dca_object.number);
	
	if (presonusClient === null) {
		throw new Error("Client has not yet been connected!");
		return;
	}
	
	console.log("[SOUND:set_dca]: DCA Info: ", typeof(dca_object))
	const selector = dca_object.get_selector();
	console.log(dca_object.get_selector());

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


/**
 * Write Cue - NEW
 * @param {Event} _event 
 * @param {*} cue_object 
 */
const write_cue = async (_event, {cue_object}) => {
	// filtergroup/ch1/name - string
	// filtergroup/ch1/mute - true or false
	// filtergroup/ch1/volume - 0.0 - 1.0
	// filtergroup/ch1/mute_aux* - 0 or 1
	// filtergroup/ch1/aux* - volume 0.0 - 1.0
	// filtergroup/ch1/line* - 0 or 1

	console.log("[SOUND:write_cue]: Writing Cue: ", cue_object)



}

export {discover, connect, set_dca, write_cue};
