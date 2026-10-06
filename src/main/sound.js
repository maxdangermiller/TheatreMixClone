import { app, BrowserWindow, ipcMain } from 'electron';

import { Client, Discovery } from '@featherbear/presonus-studiolive-api';
import {getShow} from './showManager.js';

import {convert_ip_to_octets, is_ip_valid} from '../utils/ip_tools';
import open_dialog from './dialog.js';
import Actor from '../models/Actor.js';
import Profile from '../models/Profile.js';

const INACTIVE_LEVEL = 20;
const INACTIVE_MIN_TIME = 100;
const CLIPPING_LEVEL = 9;
const INACTIVE_COLOR = "#121f75";
const ACTIVE_COLOR = "#ffffff";
const CLIPPING_COLOR = "#850707";
const LIVE_COLOR = "#b08e07";


let low_volume_channels = {};

// Global Presonus Client Object
/** @type {Client} */
let presonusClient = null; 

const CONTROLLED_LINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

/** @type {Cue} */
let current_cue = null;


/**
 * Handle Presonus Discovery
 * @param {Number} timeout in ms
 * @returns {Promise} discovery Info
 * @async
 */
const discover = async (timeout) => {
	const discovery = new Discovery();
	const devices = [];

	console.log("[SOUND:discover]: Discovering PreSonous Consoles on the Network!")

	/*
	return [
		{
			name: "StudioLive 32 Hayden",
			serial: "SD3E19010055",
			ip: "169.254.4.171",
			port: "53000",
			timestamp: "Right now"
		}
	]
	*/

	return new Promise((resolve) => {
		discovery.on('discover', (device) => {
			devices.push(device);
		});

		discovery.start(timeout);

		setTimeout(() => {
			resolve(devices);
		}, timeout + 500);
	});
}

/**
 * Initialize Low Volume Array
 */
const init_low_vol_arr = () => {
	for (let i of CONTROLLED_LINES) {
		low_volume_channels[i] = 0;
	}
}


/**
 * Connect to Console
 * @param {Event} _event 
 * @param {String} host 
 * @param {int} port
 * @async
 */
const connect = async (_event, {host, port}) => {
	console.log(`[SOUND:connect]: Connecting to Sound Board at ip address: ${host} on port ${port}.`);

	presonusClient = new Client({host: host, port: port}, {autoreconnect: true, logLevel: "debug"});

	presonusClient.on('connected', () => {
		console.log("Connected to the device!");

		init_channels();
	})

	presonusClient.on('reconnecting', () => {
		console.log("Reconnecting!")
	})
	presonusClient.on('closed', () => {
		console.log("Closed!");
		open_dialog(`Console disconnected!\r\nYou will need to reconnect before it will start working again`);
	})

	init_low_vol_arr();

	presonusClient.on('meter', handleMeteringData);
	presonusClient.meterSubscribe()
	
	
	await presonusClient.connect().then(() => {
		console.log("[SOUND:connect]: Connected to Sound Board.")
		console.log(`[SOUND:connect]: Version ${presonusClient.state.get('global.mixer_version')}`);
		
		// presonusClient.meterSubscribe()
		console.log("[SOUND:connect]: Connected to Metering Data.");
	});
}


// #region Metering Type Definitions
/**
 * @typedef ChannelStrip
 * @property {number[]} stripA
 * @property {number[]} stripB
 * @property {number[]} stripC
 * @property {number[]} stripD
 * @property {number[]} stripE
 */

/**
 * @typedef AuxStrip
 * @property {number[]} stripA
 * @property {number[]} stripB
 * @property {number[]} stripC
 * @property {number[]} stripD
 */

/**
 * @typedef MainChannelStrip
 * @property {number[]} stageA
 * @property {number[]} stageB
 * @property {number[]} stageC
 * @property {number[]} stageD
 */

/**
 * @typedef FXReturnStrip
 * @property {number[]} input
 * @property {number[]} stripA
 * @property {number[]} stripB
 * @property {number[]} stripC
 */

/**
 * @typedef MeterData
 * @property {number[]} input
 * @property {number[]} mainMixFaders
 * @property {number} main
 * @property {ChannelStrip} channelStrip
 * @property {AuxStrip} aux_chstrip
 * @property {MainChannelStrip} main_chstrip
 * @property {AuxStrip} fx_chstrip
 * @property {FXReturnStrip} fxreturn_strip
 */

// #endregion

/**
 * Get Cue Channels
 * @return {Number[]} channels in cue
 */
const get_cue_channels = () => {
	if (current_cue === null) { 
		return [];
	}

	let arr = [];

	arr.push(current_cue['dca01Channels'].split(","));
	arr.push(current_cue['dca02Channels'].split(","));
	arr.push(current_cue['dca03Channels'].split(","));
	arr.push(current_cue['dca04Channels'].split(","));
	arr.push(current_cue['dca05Channels'].split(","));
	arr.push(current_cue['dca06Channels'].split(","));
	arr.push(current_cue['dca07Channels'].split(","));
	arr.push(current_cue['dca08Channels'].split(","));

	return arr;
}

/**
 * Handle Metering Data
 * @param {MeterData} metering 
 * @async
 */
const handleMeteringData = async (metering) => {
	// Loop through all inputs and read volume
	for (let i of CONTROLLED_LINES) {
		let lvl = metering.input[i - 1];

		if (lvl <= INACTIVE_LEVEL) {	
			if (low_volume_channels[i - 1] >= INACTIVE_MIN_TIME) {
				presonusClient.setColor({type: "LINE", channel: i}, INACTIVE_COLOR);
			} else {
				low_volume_channels[i - 1]++;
			}
			continue;
		}

		// Clear the low volume count
		low_volume_channels[i - 1] = 0;

		// If the channel is used in the current cue, set to live color
		if (i in get_cue_channels()) {
			presonusClient.setColor({type: "LINE", channel: i}, LIVE_COLOR);
			continue;
		}

		// Otherwise set it to the active color
		presonusClient.setColor({type: "LINE", channel: i}, ACTIVE_COLOR);
	}
}

/**
 * Write Cue - NEW
 * @param {Event} _event 
 * @param {Cue} cue_object 
 * @async
 */
const write_cue = async (_event, {cue_object}) => {

	/*
	cue_object = {
		number: 0,
		point: 60,
		name: 'Preshow Speech',
		dca01Channels: '16',
		dca02Channels: '9',
		dca03Channels: '',
		dca04Channels: '',
		dca05Channels: '',
		dca06Channels: '',
		dca07Channels: '',
		dca08Channels: '',
		dca01Label: 'Stage 1',
		dca02Label: 'Pumbaa',
		dca03Label: '-',
		dca04Label: '-',
		dca05Label: '-',
		dca06Label: '-',
		dca07Label: '-',
		dca08Label: '-',
		channelPositions: '',
		channelProfiles: '',
		fxMutes: '',
		channelFX: '',
		snippets: '',
		qLabCue: '0.6',
		channelLevels: '',
		scenes: '',
		colour: 1,
		scenePoints: '',
		dca09Channels: '',
		dca09Label: '-',
		dca10Channels: '',
		dca10Label: '-',
		dca11Channels: '',
		dca11Label: '-',
		dca12Channels: '',
		dca12Label: '-',
		skip: 0
	}
	*/
	
	current_cue = cue_object;
	
	console.log("[SOUND:write_cue]: Writing Cue: ", cue_object)

	if (presonusClient === null) {
		console.warn("Client is not yet connected!")
		return;
	}
	
	// Write assignments
	// filtergroup/ch1/line* - 0 or 1
	try {
		for (let i = 1; i <= 8; i++) {
			presonusClient.assign_dca(
				{type: 'DCA', channel: i}, 
				cue_object[`dca0${i}Channels`].split(",").map(Number),
				CONTROLLED_LINES
			);
			console.log(`Assigned DCA #${i}`);
		}
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to write DCA assignments", error);
	}

	
	// Write mutes
	// filtergroup/ch?/mute - true or false
	try {
		for (let i = 1; i <= 8; i++) {

			if (cue_object[`dca0${i}Channels`] === '') 
			{
				presonusClient.mute({type: 'DCA', channel: i});
			} 
			
			else 
			{
				presonusClient.unmute({type: 'DCA', channel: i});
			}
		}
		
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to set DCA Mutes", error);
	}
	
	
	// Write volume
	// filtergroup/ch1/volume - 0.0 - 1.0
	try {
		for (let i = 1; i <= 8; i++) {

			if (cue_object[`dca0${i}Channels`] === '') 
			{
				presonusClient.setChannelVolumeLogarithmic({type: 'DCA', channel: i}, -84);
			} 
			
			else 
			{
				presonusClient.setChannelVolumeLogarithmic({type: 'DCA', channel: i}, -20);
			}
		}
		
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to set DCA Volumes", error);
	}
	
	
	
	// Write name
	// filtergroup/ch1/name - string
	try {
		for (let i = 1; i <= 8; i++) {
			presonusClient.setName({type: 'DCA', channel: i}, cue_object[`dca0${i}Label`]);
		}
		
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to set DCA Labels", error);
	}


	// Write Colors
	try {
		for (let i = 1; i <= 8; i++) {
			if (cue_object[`dca0${i}Channels`] === '') 
			{
				presonusClient.setColor({type: 'DCA', channel: i}, "#000000");
			} 
			
			else 
			{
				presonusClient.unmute({type: 'DCA', channel: i}, "#0c0076");
			}
		}
		
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to set DCA Colors", error);
	}

	

	// TODO: Write AUX assignments?
	// filtergroup/ch1/mute_aux* - 0 or 1
	// filtergroup/ch1/aux* - volume 0.0 - 1.0
	
	
}

/**
 * Fire Sound Check Cue
 * @param {Event} _event 
 */
const fire_sound_check = async (_event) => {
	set_soundcheck_labels();
}

/**
 * Get Profile in Show by channel number
 * @param {Number} ch channel number
 * @returns {Profile} TheatreMix Profile
 */
const get_profile = (ch) => {
	const show = getShow();

	for (let profile of show.profiles) {
		if (profile.channel === ch && profile.default) {
			return profile;
		}
	}
	return null;
}

/**
 * Get Actor by channel number
 * @param {Number} ch channel number
 * @returns {Actor} TheatreMix Actor
 */
const get_actor = (ch) => {
	const show = getShow();

	for (let actor of show.actors) {
		if (actor.channel === ch && actor.active) {
			return actor;
		}
	}
	return null;
}

/**
 * Initialize Channel Labels
 */
const init_channels = async () => {
	const board_state = presonusClient.dumpState().internal.children;
	const line_state = board_state.line.children;

	for (let ch of CONTROLLED_LINES) {
		// find default channel profile
		const profile = get_profile(ch);

		const label = profile.label === null ? profile.name : profile.label;

		if (line_state[`ch${ch["channel"]}`].username != label) {
			presonusClient.setName({type: 'LINE', channel: ch}, label);
		}
	}
}

const set_soundcheck_labels = async () => {
	if (presonusClient == null) {
		console.warn("Console is not yet connected!");
		return;
	}

	const board_state = presonusClient.dumpState().internal.children;
	const line_state = board_state.line.children;

	for (let ch of CONTROLLED_LINES) {
		// Find default channel actor
		const actor = get_actor(ch);

		if (line_state[`ch${ch["channel"]}`].username != actor.name) {
			presonusClient.setName({type: 'LINE', channel: ch["channel"]}, actor.name);
		}
	}
}

export {discover, connect, write_cue, fire_sound_check};
