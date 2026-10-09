import { app, BrowserWindow, ipcMain } from 'electron';
import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';

import { Client } from '@featherbear/presonus-studiolive-api';
import {getShow} from './showManager.js';
import {DEFAULT_DCA_LEVEL, MIN_DCA_LEVEL, get_dca_level} from '../utils/dca_levels.js';

import {convert_ip_to_octets, is_ip_valid} from '../utils/ip_tools';
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

/**
 * Console connection status (shown on the toolbar's Console Setup icon)
 * @typedef {Object} ConsoleStatus
 * @property {'disconnected' | 'connecting' | 'connected'} state
 * @property {String} [host]
 * @property {String} [name] console name from discovery
 * @property {String} [message] e.g. why it disconnected
 */

/** @type {ConsoleStatus} */
let console_status = {state: 'disconnected'};

const consoleEvents = new EventEmitter();

/**
 * Update the connection status and tell every window
 * @param {ConsoleStatus} status 
 */
const set_console_status = (status) => {
	console_status = status;
	consoleEvents.emit('status', status);

	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) window.webContents.send('console-status', status);
	}
}

const get_console_status = () => console_status;

/** @type {Promise<{devices: Object[], error?: string}>} */
let pending_discovery = null;

/**
 * What was last written to each DCA, so unchanged DCAs aren't touched
 * @type {Object<number, {channels: String, label: String}>}
 */
let applied_dcas = {};

/**
 * Line usernames last written to the console, so unchanged names aren't resent
 * @type {Object<number, String>}
 */
let line_names = {};


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
const connect = async (_event, {host, port, name}) => {
	// Ignore repeat clicks while an attempt is already running
	if (pending_connect !== null) {
		console.log("[SOUND:connect]: Connection attempt already in progress");
		return pending_connect;
	}

	pending_connect = do_connect(host, Number(port) || CONTROL_PORT, name).finally(() => {
		pending_connect = null;
	});

	return pending_connect;
}

/**
 * Tear down the current client so it stops reconnecting in the background
 */
const disconnect = (message) => {
	if (presonusClient === null) return;

	console.log("[SOUND:disconnect]: Disconnecting from Sound Board.");
	presonusClient.disconnect();
	presonusClient = null;

	set_console_status({state: 'disconnected', ...(typeof message === 'string' ? {message} : {})});
}

/**
 * @param {String} host
 * @param {Number} port
 * @param {String} [name] console name, for the status tooltip
 * @returns {Promise<{ok: boolean, error?: String}>}
 */
const do_connect = async (host, port, name) => {
	console.log(`[SOUND:connect]: Connecting to Sound Board at ip address: ${host} on port ${port}.`);

	// Only ever keep one client alive, otherwise old ones keep reconnecting forever
	disconnect();

	set_console_status({state: 'connecting', host, name});

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
		set_console_status({state: 'connected', host, name});

		init_channels();
	})

	client.on('reconnecting', () => {
		console.log("Reconnecting!")
		set_console_status({state: 'connecting', host, name, message: "Connection lost, reconnecting"});
	})
	// Connection dropped: the client reconnects by itself, and the toolbar's Console
	// Setup icon turns amber until it's back. (No modal dialog: a blocking error box
	// froze the whole app, including the reconnect, until someone clicked OK.)
	client.on('closed', () => {
		console.warn("[SOUND:connect]: Lost connection to the console, reconnecting");
		set_console_status({state: 'connecting', host, name, message: "Connection lost, reconnecting"});
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
		disconnect(error);
		return {ok: false, error};
	}

	// Fresh connection: the next cue rewrites every DCA
	reset_console_state();

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
 * Set a channel's color on the console
 * The API decodes the color with Buffer.from(hex, "hex"), which returns an empty
 * buffer if the string starts with "#", so strip it first.
 * @param {import("@featherbear/presonus-studiolive-api").ChannelSelector} selector
 * @param {String} color e.g. "#ffffff"
 */
const set_color = (selector, color) => {
	presonusClient.setColor(selector, color.replace(/^#/, ""));
}

/**
 * Set a channel's fader level in dB
 * The API call is async, so catch its errors here instead of leaving an unhandled rejection
 * @param {import("@featherbear/presonus-studiolive-api").ChannelSelector} selector 
 * @param {Number} level dB
 */
const set_level = (selector, level) => {
	presonusClient.setChannelVolumeLogarithmic(selector, level).catch((error) => {
		console.log(`[SOUND]: Failed to set ${selector.type} #${selector.channel} level`, error);
	});
}

/**
 * Get the channels assigned to a DCA in a cue
 * Tolerates missing fields and numeric values (e.g. a cue with only labels)
 * @param {Cue} cue
 * @param {Number} dca DCA number (1-12)
 * @return {Number[]} channel numbers
 */
const get_dca_channels = (cue, dca) => {
	const value = cue?.[`dca${String(dca).padStart(2, "0")}Channels`];

	return String(value ?? "")
		.split(",")
		.map(Number)
		.filter((ch) => Number.isInteger(ch) && ch > 0);
}

/**
 * Get Cue Channels
 * @return {Number[]} channels in cue
 */
const get_cue_channels = () => {
	if (current_cue === null) {
		return [];
	}

	let arr = [];

	for (let i = 1; i <= 8; i++) {
		arr.push(...get_dca_channels(current_cue, i));
	}

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
				set_color({type: "LINE", channel: i}, INACTIVE_COLOR);
			} else {
				low_volume_channels[i - 1]++;
			}
			continue;
		}

		// Clear the low volume count
		low_volume_channels[i - 1] = 0;

		// If the channel is used in the current cue, set to live color
		if (get_cue_channels().includes(i)) {
			set_color({type: "LINE", channel: i}, LIVE_COLOR);
			continue;
		}

		// Otherwise set it to the active color
		set_color({type: "LINE", channel: i}, ACTIVE_COLOR);
	}
}

/**
 * Forget what has been written to the console so the next cue rewrites everything
 * (DCA assignments, levels, mutes, names, colors and line names).
 * Called on connect and show load.
 */
const reset_console_state = () => {
	applied_dcas = {};
	line_names = {};
}

/**
 * Write a single DCA for a cue
 *
 * The fader level, mute and color are only sent when the DCA's channel assignment
 * changes (first assignment, or reassigned to different channels). If a DCA keeps
 * the same channels from one cue to the next it's left alone, so live fader moves
 * aren't stomped on.
 * @param {Cue} cue_object 
 * @param {Number} dca DCA number
 */
const write_dca = (cue_object, dca) => {
	const selector = {type: 'DCA', channel: dca};
	const channels = get_dca_channels(cue_object, dca);
	const channels_key = [...channels].sort((a, b) => a - b).join(",");
	const label = cue_object[`dca${String(dca).padStart(2, "0")}Label`] ?? "";
	const previous = applied_dcas[dca];

	if (previous?.channels !== channels_key) {
		if (channels.length === 0) {
			// Being cleared: silence it before removing the channels
			presonusClient.mute(selector);
			presonusClient.assign_dca(selector, channels, CONTROLLED_LINES);
			set_level(selector, MIN_DCA_LEVEL);
			set_color(selector, "#000000");
		} else {
			// Coming up: set the level before the new channels land on it
			const level = get_dca_level(getShow()?.dcaLevels, cue_object, dca) ?? DEFAULT_DCA_LEVEL;

			console.log(`[SOUND:write_cue]: DCA #${dca} -> channels ${channels_key} at ${level} dB`);

			set_level(selector, level);
			presonusClient.assign_dca(selector, channels, CONTROLLED_LINES);
			presonusClient.unmute(selector);
			set_color(selector, ACTIVE_COLOR);
		}
	}

	if (previous?.label !== label) {
		presonusClient.setName(selector, label);
	}

	applied_dcas[dca] = {channels: channels_key, label};
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
	
	console.log("[SOUND:write_cue]: Writing Cue")

	if (presonusClient === null) {
		console.warn("Client is not yet connected!")
		return;
	}

	init_channels();

	// Don't write to DCAs the console doesn't have (the API throws for those)
	const console_dcas = presonusClient.channelCounts?.DCA;
	const dca_count = console_dcas > 0 ? Math.min(8, console_dcas) : 8;

	for (let i = 1; i <= dca_count; i++) {
		try {
			write_dca(cue_object, i);
		} catch (error) {
			console.log(`[SOUND:write_cue]: Failed to write DCA #${i}`, error);
			// Unknown state, so fully rewrite this DCA on the next cue
			applied_dcas[i] = undefined;
		}
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
	if (!show) return null;

	for (let profile of show.profiles) {
		if (profile.channel === ch && profile.default) {
			return profile;
		}
	}
	return null;
}

/**
 * Label for a line from its default profile (what normal cues show)
 * @param {Number} ch channel number
 * @returns {String}
 */
const get_profile_label = (ch) => {
	const profile = get_profile(ch);

	if (profile === null) return "";

	return profile.label ?? profile.name ?? "";
}

/**
 * Get the actor on a channel: the first active actor assigned to it
 * (lowest order, then lowest id)
 * @param {Number} ch channel number
 * @returns {Actor} TheatreMix Actor
 */
const get_actor = (ch) => {
	const show = getShow();
	if (!show) return null;

	const actors = show.actors
		.filter((actor) => actor.channel === ch && actor.active)
		.sort((a, b) => (a.order - b.order) || (a.id - b.id));

	return actors[0] ?? null;
}

/**
 * Set a line's username, skipping the send if it already shows that name
 * @param {Number} ch channel number
 * @param {String} name 
 */
const set_line_name = (ch, name) => {
	const current = line_names[ch] ?? presonusClient.state.get(`line/ch${ch}/username`);

	if (current === name) return;

	presonusClient.setName({type: 'LINE', channel: ch}, name);
	line_names[ch] = name;
}

/**
 * Initialize Channel Labels - each line shows its default profile's label
 */
const init_channels = async () => {
	try {
		for (let ch_num of CONTROLLED_LINES) {
			set_line_name(ch_num, get_profile_label(ch_num));
		}
	} catch (error) {
		console.log("[Sound.js] Error: ", error);
	}
}

/**
 * Line Check labels - each line shows the name of the actor on it.
 * Lines without an actor (or when the show turns off "cueZeroActorLabels")
 * fall back to the profile label.
 */
const set_soundcheck_labels = async () => {
	if (presonusClient == null) {
		console.warn("Console is not yet connected!");
		return;
	}

	const use_actor_names = getShow()?.config?.cueZeroActorLabels !== "0";

	try {
		for (let ch of CONTROLLED_LINES) {
			const actor = use_actor_names ? get_actor(ch) : null;

			set_line_name(ch, actor?.name ?? get_profile_label(ch));
		}
	} catch (error) {
		console.log("[SOUND:fire_sound_check]: Failed to set line check labels", error);
	}
}

export {discover, connect, disconnect, write_cue, fire_sound_check, reset_console_state, get_console_status, consoleEvents};
