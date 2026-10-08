import { app, BrowserWindow, ipcMain } from 'electron';
import dgram from 'node:dgram';
import os from 'node:os';

import { Client } from '@featherbear/presonus-studiolive-api';
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

// UCNet ports. Consoles broadcast a "DA" announce packet from CONTROL_PORT to
// 255.255.255.255:DISCOVERY_PORT roughly every 2.5 seconds.
const CONTROL_PORT = 53000;
const DISCOVERY_PORT = 47809;
const DEFAULT_DISCOVERY_TIMEOUT = 10000;

// How long a single TCP attempt may take, and how long we keep retrying before giving up
const CONNECT_ATTEMPT_TIMEOUT = 5000;
const CONNECT_DEADLINE = 15000;

/** @type {Cue} */
let current_cue = null;

/** @type {Promise<{ok: boolean, error?: string}>} */
let pending_connect = null;

/** @type {Promise<{devices: Object[], error?: string}>} */
let pending_discovery = null;


/**
 * Parse a UCNet "DA" discovery announcement
 * Layout: "UC\0\x01" + 2 bytes + "DA" + 4 C-bytes + 20 bytes + null separated strings
 *         (model, device class, serial, friendly name)
 * @param {Buffer} packet
 * @returns {{model: String, serial: String, name: String} | null}
 */
const parse_discovery_packet = (packet) => {
	if (packet.length < 32 || packet.subarray(0, 4).toString('latin1') !== "UC\0\x01") return null;
	if (packet.subarray(6, 8).toString() !== "DA") return null;

	const [model, _device_class, serial, name] = packet.subarray(32).toString('utf8').split("\0");
	if (!serial) return null;

	return {model, serial, name: name || model};
}

/**
 * Handle Presonus Discovery
 * Listens for console announcements and streams each one to the renderer as it is found.
 * @param {Event} event
 * @param {Number} timeout in ms
 * @returns {Promise<{devices: Object[], error?: String}>} discovered devices
 * @async
 */
const discover = async (event, {timeout}) => {
	// Only one discovery socket at a time; extra callers share the running scan
	if (pending_discovery !== null) {
		return pending_discovery;
	}

	if (!Number.isFinite(timeout) || timeout <= 0) {
		timeout = DEFAULT_DISCOVERY_TIMEOUT;
	}

	console.log(`[SOUND:discover]: Discovering PreSonus Consoles on the Network for ${timeout}ms`);

	pending_discovery = new Promise((resolve) => {
		const devices = new Map();
		const socket = dgram.createSocket({type: 'udp4', reuseAddr: true});
		let finished = false;
		let timer = null;

		const finish = (error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			try { socket.close(); } catch {}
			pending_discovery = null;

			console.log(`[SOUND:discover]: Found ${devices.size} console(s)`, error ?? "");
			resolve({devices: [...devices.values()], error});
		}

		socket.on('error', (err) => {
			console.warn("[SOUND:discover]: Discovery socket error", err);

			if (err.code === 'EADDRINUSE') {
				finish(`Discovery port ${DISCOVERY_PORT} is in use by another app (likely Universal Control). Quit it and rescan.`);
			} else {
				finish(`Discovery failed: ${err.code ?? err.message}`);
			}
		});

		socket.on('message', (packet, rinfo) => {
			const parsed = parse_discovery_packet(packet);
			if (parsed === null) return;

			const is_new = !devices.has(parsed.serial);
			const device = {
				...parsed,
				ip: rinfo.address,
				port: CONTROL_PORT,
				timestamp: new Date().toLocaleTimeString(),
			};
			devices.set(parsed.serial, device);

			if (is_new) {
				console.log("[SOUND:discover]: Found console", device);
				if (!event.sender.isDestroyed()) {
					event.sender.send('presonus:device-found', device);
				}
			}
		});

		socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
			socket.setBroadcast(true);
		});

		timer = setTimeout(() => finish(), timeout);
	});

	return pending_discovery;
}

/**
 * Find the local IPv4 address on the same subnet as the console.
 * Binding to it stops macOS from sending link-local (169.254.x.x) traffic out of the
 * wrong interface (e.g. Wi-Fi) when the console is plugged into Ethernet.
 * @param {String} host console IP
 * @returns {String | undefined} local address
 */
const find_local_address = (host) => {
	const to_int = (ip) => ip.split(".").reduce((acc, oct) => ((acc << 8) | parseInt(oct)) >>> 0, 0);
	const host_int = to_int(host);
	const matches = [];

	for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
		for (const addr of addrs ?? []) {
			if (addr.family !== 'IPv4' || addr.internal) continue;

			const mask = to_int(addr.netmask);
			if ((to_int(addr.address) & mask) === (host_int & mask)) {
				matches.push({iface, address: addr.address});
			}
		}
	}

	if (matches.length === 0) {
		console.warn(`[SOUND:connect]: No network interface is on the same subnet as ${host}. Check the cable / IP settings.`);
		return undefined;
	}

	if (matches.length > 1) {
		console.warn(`[SOUND:connect]: Multiple interfaces are on ${host}'s subnet, using the first:`, matches);
	}

	console.log(`[SOUND:connect]: Using local interface ${matches[0].iface} (${matches[0].address})`);
	return matches[0].address;
}

/**
 * Human readable explanation for a socket error code
 * @param {Error} err
 * @returns {String}
 */
const describe_socket_error = (err) => {
	switch (err?.code) {
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return `${err.code}: macOS could not reach the console. Allow this app (or Terminal/VS Code when running "npm start") under System Settings → Privacy & Security → Local Network.`;
		case 'ECONNREFUSED':
			return `${err.code}: The console refused the connection. It may have too many remote clients connected.`;
		case 'ETIMEDOUT':
			return `${err.code}: No response from the console. Check the IP address and that it is on the same network.`;
		case 'EADDRNOTAVAIL':
			return `${err.code}: The local network interface went away. Check the cable.`;
		default:
			return err ? `${err.code ?? ""} ${err.message}` : "Unknown error";
	}
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
 * @returns {Promise<{ok: boolean, error?: String}>} connection result
 * @async
 */
const connect = async (_event, {host, port}) => {
	// Ignore repeat clicks while an attempt is already running
	if (pending_connect !== null) {
		console.log("[SOUND:connect]: Connection attempt already in progress");
		return pending_connect;
	}

	pending_connect = do_connect(host, Number(port) || CONTROL_PORT).finally(() => {
		pending_connect = null;
	});

	return pending_connect;
}

/**
 * Tear down the current client so it stops reconnecting in the background
 */
const disconnect = () => {
	if (presonusClient === null) return;

	console.log("[SOUND:disconnect]: Disconnecting from Sound Board.");
	presonusClient.disconnect();
	presonusClient = null;
}

/**
 * @param {String} host
 * @param {Number} port
 * @returns {Promise<{ok: boolean, error?: String}>}
 */
const do_connect = async (host, port) => {
	console.log(`[SOUND:connect]: Connecting to Sound Board at ip address: ${host} on port ${port}.`);

	// Only ever keep one client alive, otherwise old ones keep reconnecting forever
	disconnect();

	const client = new Client({host: host, port: port}, {
		autoreconnect: true,
		logLevel: "debug",
		connectTimeout: CONNECT_ATTEMPT_TIMEOUT,
		localAddress: find_local_address(host),
	});
	presonusClient = client;

	let last_error = null;

	client.on('socketError', (err) => {
		// Keep the more specific error if a timeout follows it
		if (err.code !== 'ETIMEDOUT' || last_error === null) {
			last_error = err;
		}
		console.warn(`[SOUND:connect]: ${describe_socket_error(err)}`);
	});

	client.on('connected', () => {
		console.log("Connected to the device!");

		init_channels();
	})

	client.on('reconnecting', () => {
		console.log("Reconnecting!")
	})
	client.on('closed', () => {
		console.log("Closed!");
		open_dialog(`Console disconnected!\r\nYou will need to reconnect before it will start working again`);
	})

	init_low_vol_arr();

	client.on('meter', handleMeteringData);

	let deadline_timer;
	const deadline = new Promise((resolve) => {
		deadline_timer = setTimeout(() => resolve(false), CONNECT_DEADLINE);
	});

	const connected = await Promise.race([client.connect().then(() => true), deadline]);
	clearTimeout(deadline_timer);

	// Another connect replaced this client while we were waiting
	if (presonusClient !== client) {
		return {ok: false, error: "Connection was replaced by a newer attempt."};
	}

	if (!connected) {
		const error = describe_socket_error(last_error ?? {code: 'ETIMEDOUT'});
		console.warn(`[SOUND:connect]: Giving up after ${CONNECT_DEADLINE}ms. ${error}`);
		disconnect();
		return {ok: false, error};
	}

	console.log("[SOUND:connect]: Connected to Sound Board.")
	console.log(`[SOUND:connect]: Version ${client.state.get('global.mixer_version')}`);

	// Subscribe once the TCP session exists so the console actually receives the UM packet
	try {
		await client.meterSubscribe();
		console.log("[SOUND:connect]: Connected to Metering Data.");
	} catch (error) {
		console.warn("[SOUND:connect]: Failed to subscribe to metering data", error);
	}

	return {ok: true};
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
	
	init_channels();

	current_cue = cue_object;
	
	console.log("[SOUND:write_cue]: Writing Cue")

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
			// console.log(`Assigned DCA #${i}`);
		}
	} catch (error) {
		console.log("[SOUND:write_cue]: Failed to write DCA assignments", error);
		return;
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

	console.log(CONTROLLED_LINES);
	for (let ch_num of CONTROLLED_LINES) {
		console.log(ch_num);
	}

	try {
		for (let ch_num of CONTROLLED_LINES) {
			// find default channel profile
			const profile = get_profile(ch_num);
			
			const label = profile === null ? "" : profile.label === null ? profile.name : profile.label;
	
			console.log("Sound.js --> ", line_state[`ch${ch_num}`].children.username);
	
	
			if (line_state[`ch${ch_num}`].children.username != label) {
				presonusClient.setName({type: 'LINE', channel: ch_num}, label);
			}
		}
	} catch (error) {
		console.log("[Sound.js] Error: ", error);
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

export {discover, connect, disconnect, write_cue, fire_sound_check};
