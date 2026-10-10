import { app, BrowserWindow, ipcMain } from 'electron';
import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';

import { Client } from '@featherbear/presonus-studiolive-api';
import {getShow} from './showManager.js';
import {attachConsoleButtons, detachConsoleButtons, syncConsoleButtons} from './consoleButtons.js';
import {debugLog} from './debugLog.js';
import {getSettings, updateSettings} from './settings.js';
import {attachChannelMonitor, detachChannelMonitor, resetChannelMonitor, setMonitoredChannels, setActiveChannels} from './channelMonitor.js';
import {get_dca_level, fader_to_level, level_to_fader, format_dca_level, NEW_DCA_LEVEL} from '../utils/dca_levels.js';

import {convert_ip_to_octets, is_ip_valid} from '../utils/ip_tools';
import Actor from '../models/Actor.js';
import Profile from '../models/Profile.js';

// DCA colors, like TheatreMix's DCA color coding (theatremix.com/features#dcaColours):
// each DCA shows what happens to it in the NEXT cue. (Line channel colors come from
// channelMonitor.js.)
const DCA_COLORS = {
	change: "ffffff",    // white: the DCA's channels change in the next cue (fader down before Go)
	same: "00ff00",      // green: exactly the same in the next cue (safe to Go with the fader up)
	position: "00ffff",  // cyan: same channels, but one changes position
	fx: "ff8000",        // orange: same channels, but one changes FX
	profile: "ffff00",   // yellow: same channels, but one changes profile
	ensemble: "ff00ff",  // magenta: channels move in and out of ensemble (multi-channel) DCAs
	off: "000000",       // black: nothing assigned to the DCA
	dimmed: "0000ff",    // blue: fader at -∞ with "dim DCA faders" + "suppress colors" on
};
// With "dim DCA faders" on (and colors not suppressed), a DCA at -∞ shows its color this bright
const DIM_FACTOR = 0.25;
// Fader positions (0-100) at or below this count as -∞
const DIM_FADER = 0.5;

// Global Presonus Client Object
/** @type {Client} */
let presonusClient = null; 

const CONTROLLED_LINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

// UCNet ports. Consoles broadcast a "DA" announce packet from CONTROL_PORT to
// 255.255.255.255:DISCOVERY_PORT roughly every 2.5 seconds.
const CONTROL_PORT = 53000;
const DISCOVERY_PORT = 47809;
const DEFAULT_DISCOVERY_TIMEOUT = 10000;

// The query Universal Control broadcasts to find consoles ("NO"); consoles answer with
// their "DA" announcement straight back to the sender
const DISCOVERY_PROBE = Buffer.from('5543000100004e4f00000000', 'hex');
const DISCOVERY_PROBE_INTERVAL = 3000;

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

/** 'found' (device) as soon as discovery hears a new console */
const discoveryEvents = new EventEmitter();

// Auto-connect on launch: how long to look for the last console
const AUTO_CONNECT_TIMEOUT = 10000;

/**
 * What was last written to each DCA, so unchanged DCAs aren't touched
 * @type {Object<number, {channels: String, label: String}>}
 */
let applied_dcas = {};

/** What was fired last, so it can be re-applied if the console comes back changed */
let last_fired = null; // {type: 'cue', cue} | {type: 'linecheck'}

/**
 * Line usernames last written to the console, so unchanged names aren't resent
 * @type {Object<number, String>}
 */
let line_names = {};

/**
 * The DCA fader position each line channel (person) was last mixed at, so their offset
 * follows them when they move to a different DCA. Read from the console's live faders before
 * every cue, so the operator's fader moves are kept.
 * @type {Map<number, number>} channel -> fader position (0-100)
 */
let channel_levels = new Map();

/**
 * DCA fader positions (0-100) since connecting: moves made on the console and levels we sent.
 * Kept here because the API's own state mixes scales: its connection snapshot and its own
 * writes are 0-100, but fader moves from the console are stored as 0-1.
 * @type {Map<number, number>} DCA -> fader position
 */
let dca_faders = new Map();

/**
 * DCA mutes since connecting (on = muted): mutes made on the console and ones we sent.
 * Kept here because the API doesn't record its own mute sends in its state.
 * @type {Map<number, boolean>}
 */
let dca_mutes = new Map();

/**
 * Each cue's DCAs as they were when it was last left: {channels, fader, muted} per DCA,
 * so going Back into a cue puts its faders and mutes back
 * @type {Map<string, Map<number, {channels: String, fader: Number | null, muted: Boolean | null}>>}
 */
let cue_snapshots = new Map();

/**
 * Color last sent to each DCA, so unchanged colors aren't resent
 * @type {Map<number, string>}
 */
let dca_colors = new Map();

/** Last time a DCA fader move from the console was logged, per DCA */
const fader_move_logged = new Map();


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
		const sockets = [];
		let finished = false;
		let timer = null;
		let probe_timer = null;
		let listener_error = null;

		const finish = (error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			clearInterval(probe_timer);
			for (const s of sockets) {
				try { s.close(); } catch {}
			}
			pending_discovery = null;

			// Only report the listener's error if nothing was found another way
			const reported = devices.size === 0 ? (error ?? listener_error) : error;
			debugLog('DISCOVERY', `Finished: ${devices.size} console(s) found`, reported ?? "");
			resolve({devices: [...devices.values()], error: reported ?? undefined});
		}

		/**
		 * A "DA" announcement arrived (on the shared port, or as a reply to our probe)
		 * @param {String} via which socket received it, for the log
		 */
		const handle_message = (packet, rinfo, via) => {
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
				debugLog('DISCOVERY', `Found "${device.name}" (${device.model}, serial ${device.serial}) at ${device.ip}, via ${via}`);
				if (event?.sender && !event.sender.isDestroyed()) {
					event.sender.send('presonus:device-found', device);
				}
				discoveryEvents.emit('found', device);
			}
		}

		// 1) Shared discovery port: consoles broadcast an announcement here every few seconds.
		//    Universal Control listens here too; broadcasts reach everyone, but a direct
		//    (unicast) announcement only reaches one of the listening apps.
		const listener = dgram.createSocket({type: 'udp4', reuseAddr: true});
		sockets.push(listener);
		listener.on('error', (err) => {
			debugLog('DISCOVERY', `Can't listen on port ${DISCOVERY_PORT} (${err.code ?? err.message}); relying on probes`);
			listener_error = err.code === 'EADDRINUSE'
				? `Discovery port ${DISCOVERY_PORT} is in use by another app (likely Universal Control). Quit it and rescan.`
				: `Discovery failed: ${err.code ?? err.message}`;
			try { listener.close(); } catch {}
		});
		listener.on('message', (packet, rinfo) => handle_message(packet, rinfo, `port ${DISCOVERY_PORT}`));
		listener.bind(DISCOVERY_PORT, '0.0.0.0', () => {
			listener.setBroadcast(true);
			debugLog('DISCOVERY', `Listening on port ${DISCOVERY_PORT}`);
		});

		// 2) Probe from every network adapter, like Universal Control: broadcast a "NO" query
		//    and take the replies on that adapter's own socket.
		const probes = [];
		for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
			for (const addr of addrs ?? []) {
				if (addr.family !== 'IPv4' || addr.internal) continue;

				const probe = dgram.createSocket({type: 'udp4'});
				sockets.push(probe);
				probe.on('error', (err) => debugLog('DISCOVERY', `Probe socket on ${iface} (${addr.address}) failed: ${err.code ?? err.message}`));
				probe.on('message', (packet, rinfo) => handle_message(packet, rinfo, `probe on ${iface}`));
				probe.bind(0, addr.address, () => {
					probe.setBroadcast(true);
					probes.push({probe, iface, address: addr.address});
				});
			}
		}

		const send_probes = () => {
			for (const {probe, iface, address} of probes) {
				probe.send(DISCOVERY_PROBE, DISCOVERY_PORT, '255.255.255.255', (err) => {
					if (err) debugLog('DISCOVERY', `Probe from ${iface} (${address}) failed: ${err.code ?? err.message}`);
				});
			}
		}

		// Give the sockets a moment to bind, then probe every few seconds while scanning
		setTimeout(() => {
			if (finished) return;
			debugLog('DISCOVERY', `Probing from ${probes.length} adapter(s): ${probes.map((p) => `${p.iface} ${p.address}`).join(", ") || "none"}`);
			send_probes();
			probe_timer = setInterval(send_probes, DISCOVERY_PROBE_INTERVAL);
		}, 200);

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
 * Connect to Console
 * @param {Event} _event 
 * @param {String} host 
 * @param {int} port
 * @returns {Promise<{ok: boolean, error?: String}>} connection result
 * @async
 */
const connect = async (_event, {host, port, name, serial}) => {
	// Ignore repeat clicks while an attempt is already running
	if (pending_connect !== null) {
		console.log("[SOUND:connect]: Connection attempt already in progress");
		return pending_connect;
	}

	port = Number(port) || CONTROL_PORT;
	pending_connect = do_connect(host, port, name).then((result) => {
		// Remember it for auto-connect on the next launch
		if (result?.ok) updateSettings({lastConsole: {host, port, name: name ?? null, serial: serial ?? null}});
		return result;
	}).finally(() => {
		pending_connect = null;
	});

	return pending_connect;
}

/**
 * On launch (Console Setup → "Connect automatically"): look for the console we were last
 * connected to and connect to it if it's there. Matched by serial, so it's found even if
 * its IP address changed.
 * @param {Electron.WebContents} [sender] window that shows discovered consoles
 */
const auto_connect = async (sender) => {
	const {autoConnect, lastConsole} = getSettings();
	if (!autoConnect) {
		debugLog('AUTOCONNECT', "Off (Console Setup)");
		return;
	}
	if (!lastConsole?.host) {
		debugLog('AUTOCONNECT', "No console connected before, nothing to reconnect to");
		return;
	}

	const label = `"${lastConsole.name ?? lastConsole.host}"${lastConsole.serial ? ` (serial ${lastConsole.serial})` : ""}`;
	debugLog('AUTOCONNECT', `Looking for the last console ${label}, last at ${lastConsole.host}`);
	set_console_status({state: 'connecting', host: lastConsole.host, name: lastConsole.name, message: "Looking for the last console"});

	const matches = (device) => lastConsole.serial ? device.serial === lastConsole.serial : device.ip === lastConsole.host;
	const found = await new Promise((resolve) => {
		let done = false;
		const finish = (device) => {
			if (done) return;
			done = true;
			discoveryEvents.off('found', on_found);
			resolve(device);
		};
		const on_found = (device) => { if (matches(device)) finish(device); };

		discoveryEvents.on('found', on_found);
		discover({sender}, {timeout: AUTO_CONNECT_TIMEOUT})
			.then(({devices}) => finish(devices.find(matches) ?? null));
	});

	// Connected by hand in the meantime
	if (presonusClient !== null || pending_connect !== null) return;

	if (!found) {
		debugLog('AUTOCONNECT', `${label} wasn't found within ${AUTO_CONNECT_TIMEOUT / 1000}s; not connecting`);
		set_console_status({state: 'disconnected', message: `Last console ${label} not found`});
		return;
	}

	debugLog('AUTOCONNECT', `Found ${label} at ${found.ip}; connecting`);
	return connect(null, {host: found.ip, port: found.port, name: found.name, serial: found.serial});
}

/**
 * Tear down the current client so it stops reconnecting in the background
 */
const disconnect = (message) => {
	if (presonusClient === null) return;

	console.log("[SOUND:disconnect]: Disconnecting from Sound Board.");
	detachConsoleButtons();
	detachChannelMonitor();
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
	dca_faders = new Map();
	dca_mutes = new Map();

	// Console mute group buttons as Go / Back
	attachConsoleButtons(client);

	// Line channel colors from the meters (blue silent / white signal / yellow in cue)
	setMonitoredChannels(getShow(), CONTROLLED_LINES);
	attachChannelMonitor(client);

	// Log DCA fader moves made on the console (at most once a second per DCA), so the log
	// shows the levels that will follow people to their next DCA
	client.on('PV', ({name, value}) => {
		// DCA muted / unmuted on the console
		const mute = /^filtergroup\/ch(\d+)\/mute$/.exec(name);
		if (mute && typeof value === 'boolean') {
			dca_mutes.set(Number(mute[1]), value);
			return;
		}

		const match = /^filtergroup\/ch(\d+)\/volume$/.exec(name);
		if (!match || typeof value !== 'number') return;

		const dca = Number(match[1]);
		// PV volumes are 0-1
		dca_faders.set(dca, value * 100);
		// A fader pulled to (or up from) -∞ can change the DCA's dimmed color
		update_dca_color(dca);

		const now = Date.now();
		if (now - (fader_move_logged.get(dca) ?? 0) < 1000) return;
		fader_move_logged.set(dca, now);

		debugLog('LEVELS', `DCA ${dca} fader moved on the console -> ${format_dca_level(fader_to_level(value * 100))}`);
	});

	let last_error = null;

	client.on('socketError', (err) => {
		// Keep the more specific error if a timeout follows it
		if (err.code !== 'ETIMEDOUT' || last_error === null) {
			last_error = err;
		}
		console.warn(`[SOUND:connect]: ${describe_socket_error(err)}`);
	});

	let ever_connected = false;

	client.on('connected', () => {
		console.log("Connected to the device!");
		set_console_status({state: 'connected', host, name});

		// (Re)check the mute group buttons each time the connection comes up
		syncConsoleButtons(getShow());

		if (!ever_connected) {
			// Fresh connection: forget what was written before, then put the active cue on the
			// console (Line Checks until a cue is fired: actors' names, DCAs cleared)
			reset_console_state();
			apply_active_cue();
		} else {
			// Line names for where we are (Line Checks shows actors, cues show characters)
			if (last_fired?.type === 'linecheck') set_soundcheck_labels(); else init_channels();
		}

		// Reconnected (network blip or console reboot): make sure the console still matches
		if (ever_connected) {
			// Faders may have moved while we were away: the fresh snapshot has them.
			// The console may also have been reset, so resend the DCA colors.
			dca_faders = new Map();
			dca_mutes = new Map();
			dca_colors = new Map();
			resync_after_reconnect(client);

			// The meter subscription belongs to the old connection: ask for meters again on
			// the same port, and re-send the channel colors in case the console was reset
			if (client.meteringClient) {
				const port = client.meteringClient.address().port;
				const portBytes = Buffer.alloc(2);
				portBytes.writeUInt16LE(port);
				client._sendPacket('UM', portBytes, 0);
				debugLog('METERS', `Reconnected: asked for meters again on port ${port}`);
			}
			resetChannelMonitor();
		}
		ever_connected = true;
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
 * Set a channel's fader position (0-100)
 * Sent as an exact position: the API's dB call rounds down to a whole percent (up to 0.5 dB
 * low each time), which would add up as levels follow people from DCA to DCA.
 * The API call is async, so catch its errors here instead of leaving an unhandled rejection
 * @param {import("@featherbear/presonus-studiolive-api").ChannelSelector} selector 
 * @param {Number} position 0-100
 */
const set_fader = (selector, position) => {
	if (selector.type === 'DCA') dca_faders.set(selector.channel, position);

	presonusClient.setChannelVolumeLinear(selector, position).catch((error) => {
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
 * Read a value from the state snapshot the console sent on (re)connect. Unlike
 * client.state, this ignores values cached from before the connection dropped.
 * @param {Object} snapshot client.dumpState().internal
 * @param {String} path e.g. "filtergroup/ch1/line3"
 */
const snapshot_get = (snapshot, path) => {
	let node = snapshot;
	for (const key of path.split("/")) {
		node = node?.children?.[key] ?? node?.[key];
		if (node === undefined) return undefined;
	}
	return node;
}

const is_on = (value) => value === true || (typeof value === 'number' && value >= 0.5);

/**
 * After a reconnect, compare what we last wrote with the console's fresh state. After a
 * network blip nothing differs and nothing is touched (live fader moves are kept). If the
 * console rebooted or was changed while we were away, forget those DCAs / line names and
 * re-apply the current cue so the console matches straight away instead of at the next Go.
 * @param {Client} client 
 */
const resync_after_reconnect = (client) => {
	let snapshot;
	try {
		snapshot = client.dumpState().internal;
	} catch (error) {
		debugLog('RECONNECT', "Couldn't read the console's state after reconnecting; rewriting everything", error.message);
		reset_console_state();
		snapshot = null;
	}

	const changed = [];

	if (snapshot) {
		for (const [dca, applied] of Object.entries(applied_dcas)) {
			if (!applied) continue;

			const channels = CONTROLLED_LINES
				.filter((n) => is_on(snapshot_get(snapshot, `filtergroup/ch${dca}/line${n}`)))
				.join(",");
			const name = snapshot_get(snapshot, `filtergroup/ch${dca}/name`) ?? "";

			if (channels !== applied.channels || name !== applied.label) {
				changed.push(`DCA ${dca} (console has "${name}" ch [${channels}], we sent "${applied.label}" ch [${applied.channels}])`);
				delete applied_dcas[dca];
			}
		}

		for (const [ch, name] of Object.entries(line_names)) {
			const actual = snapshot_get(snapshot, `line/ch${ch}/username`) ?? "";
			if (actual !== name) {
				changed.push(`line ${ch} name ("${actual}" instead of "${name}")`);
				// Record what the console really shows (not forget it: the client's cache can still
				// hold the old name, which would make the resend look unnecessary)
				line_names[ch] = actual;
			}
		}
	}

	if (snapshot && changed.length === 0) {
		debugLog('RECONNECT', "Reconnected; the console still matches, nothing to resend");
		return;
	}

	debugLog('RECONNECT', `Reconnected; the console changed while we were away: ${changed.join("; ") || "unknown state"}`);

	if (last_fired?.type === 'cue') {
		debugLog('RECONNECT', `Re-applying the current cue ${last_fired.cue.number}.${last_fired.cue.point}`);
		write_cue(null, {cue_object: last_fired.cue});
	} else if (last_fired?.type === 'linecheck') {
		debugLog('RECONNECT', "Re-applying Line Checks");
		fire_sound_check();
	}
}

/**
 * A fresh connection: fire the active cue so the console matches the app. That's the last
 * cue fired, or Line Checks if none has been (the editor starts on Line Checks).
 */
const apply_active_cue = () => {
	// No show yet (e.g. connected on launch before it opened): it's applied when it opens
	if (!getShow()) {
		debugLog('CONNECT', "Connected with no show open; the active cue fires when one is opened");
		return;
	}

	if (last_fired?.type === 'cue') {
		debugLog('CONNECT', `Connected: firing the active cue ${last_fired.cue.number}.${last_fired.cue.point}`);
		write_cue(null, {cue_object: last_fired.cue});
	} else {
		debugLog('CONNECT', "Connected: firing the active cue, Line Checks");
		fire_sound_check();
	}
}

/**
 * A show was opened: forget what was written to the console, and since the editor starts
 * on Line Checks, that's the active cue: put it on the console if we're connected
 */
const show_opened = () => {
	reset_console_state();
	current_cue = null;
	last_fired = null;

	if (presonusClient !== null && console_status.state === 'connected') apply_active_cue();
}

/**
 * Forget what has been written to the console so the next cue rewrites everything
 * (DCA assignments, levels, mutes, names, colors and line names).
 * Called on connect and show load.
 */
const reset_console_state = () => {
	applied_dcas = {};
	line_names = {};
	channel_levels = new Map();
	dca_colors = new Map();
	cue_snapshots = new Map();
}

/**
 * A DCA's fader position on the console right now
 * @param {Number} dca
 * @returns {Number | null} 0-100, or null if unknown
 */
const read_dca_fader = (dca) => {
	// Moved or set since connecting, else the console's state from when we connected (0-100)
	const position = dca_faders.get(dca) ?? presonusClient?.getLevel({type: 'DCA', channel: dca});
	return typeof position === 'number' ? position : null;
}

/**
 * Whether a DCA is muted on the console right now
 * @param {Number} dca
 * @returns {Boolean | null} null if unknown
 */
const read_dca_mute = (dca) => {
	const muted = dca_mutes.get(dca) ?? presonusClient?.state.get(`filtergroup/ch${dca}/mute`);
	return typeof muted === 'boolean' ? muted : null;
}

/**
 * Mute or unmute a DCA, remembering it
 * @param {Number} dca
 * @param {Boolean} muted
 */
const set_dca_mute = (dca, muted) => {
	const selector = {type: 'DCA', channel: dca};
	if (muted) presonusClient.mute(selector); else presonusClient.unmute(selector);
	dca_mutes.set(dca, muted);
}

/**
 * Key for a cue in cue_snapshots
 * @param {Cue} cue
 */
const cue_key = (cue) => `${Number(cue.number)}.${Number(cue.point)}`;

/**
 * Leaving the current cue: remember each DCA's fader and mute, for going Back into it
 */
const save_cue_snapshot = () => {
	if (current_cue === null) return;

	const snapshot = new Map();
	for (const [dca, applied] of Object.entries(applied_dcas)) {
		if (!applied?.channels) continue;
		snapshot.set(Number(dca), {channels: applied.channels, fader: read_dca_fader(Number(dca)), muted: read_dca_mute(Number(dca))});
	}
	cue_snapshots.set(cue_key(current_cue), snapshot);
}

/**
 * Before a cue changes anything: remember the level every assigned person is at now
 * (their DCA's live fader), so it can follow them to another DCA
 */
const remember_channel_levels = () => {
	for (const [dca, applied] of Object.entries(applied_dcas)) {
		if (!applied?.channels) continue;

		const position = read_dca_fader(Number(dca));
		if (position === null) continue;

		for (const ch of applied.channels.split(",").map(Number)) channel_levels.set(ch, position);
	}
}

/**
 * The fader position a DCA's new channels were last mixed at. If they come from different
 * DCAs, the position most of them share wins (ties go to the first channel listed).
 * @param {Number[]} channels
 * @returns {Number | null} 0-100, or null if none of them have a level yet
 */
const carried_level = (channels) => {
	const counts = new Map();
	for (const ch of channels) {
		const level = channel_levels.get(ch);
		if (level !== undefined) counts.set(level, (counts.get(level) ?? 0) + 1);
	}

	let best = null;
	for (const [level, count] of counts) {
		if (best === null || count > counts.get(best)) best = level;
	}
	return best;
}

/**
 * Write a single DCA for a cue
 *
 * Fader level:
 *  - a level set for this cue's DCA (DCA level popup) is always applied when the cue fires
 *  - otherwise, when the DCA gets different channels, it takes the level those people were
 *    last mixed at (the fader of the DCA they came from), so their offset follows them
 *  - otherwise, when the DCA comes up for the first time (it was empty, or none of its people
 *    have been mixed yet), it goes to NEW_DCA_LEVEL (-20 dB)
 *  - otherwise (same channels) the fader is left where it is
 * Mute is only sent when the channel assignment changes, so a DCA that keeps its channels
 * isn't touched and live fader moves are kept. An unassigned DCA is muted and pulled to -∞
 * (and shows black, see update_dca_colors), so it's obvious it's empty.
 *
 * Going Back into a cue (restore given): a DCA with the same channels as when that cue was
 * last left gets its fader and mute back exactly as they were.
 * @param {Cue} cue_object 
 * @param {Number} dca DCA number
 * @param {{channels: String, fader: Number | null, muted: Boolean | null} | undefined} restore
 */
const write_dca = (cue_object, dca, restore) => {
	const selector = {type: 'DCA', channel: dca};
	const channels = get_dca_channels(cue_object, dca);
	const channels_key = [...channels].sort((a, b) => a - b).join(",");
	const label = cue_object[`dca${String(dca).padStart(2, "0")}Label`] ?? "";
	const previous = applied_dcas[dca];

	const reassigned = previous?.channels !== channels_key;
	const configured = channels.length ? get_dca_level(getShow()?.dcaLevels, cue_object, dca) : null;

	if (channels.length && restore?.channels === channels_key) {
		debugLog('LEVELS', `Back to cue ${cue_object.number}.${cue_object.point} DCA ${dca} -> ch ${channels_key} restored` +
			`${restore.fader !== null ? ` at ${format_dca_level(fader_to_level(restore.fader))}` : ""}` +
			`${restore.muted !== null ? `, ${restore.muted ? "muted" : "unmuted"}` : ""}`);

		if (restore.fader !== null) {
			set_fader(selector, restore.fader);
			for (const ch of channels) channel_levels.set(ch, restore.fader);
		}
		if (reassigned) presonusClient.assign_dca(selector, channels, CONTROLLED_LINES);

		const muted = restore.muted ?? false;
		if (reassigned || read_dca_mute(dca) !== muted) set_dca_mute(dca, muted);
	} else if (reassigned && channels.length === 0) {
		// Being cleared: muted and pulled to -∞ so it's obvious it's unassigned (the level
		// its people were at was remembered first, so it follows them)
		debugLog('LEVELS', `Cue ${cue_object.number ?? "Line Checks"}${cue_object.point !== undefined ? `.${cue_object.point}` : ""} DCA ${dca} unassigned -> -∞, muted`);
		set_dca_mute(dca, true);
		set_fader(selector, 0);
		presonusClient.assign_dca(selector, channels, CONTROLLED_LINES);
	} else if (reassigned || configured !== null) {
		// Set the level before the new channels land on it
		// Console Setup → DCA Recall: "Levels follow people"
		const carried = reassigned && getSettings().levelsFollowPeople ? carried_level(channels) : null;
		const first_time = reassigned && carried === null &&
			(!previous?.channels || channels.every((ch) => !channel_levels.has(ch)));
		const position = configured !== null ? level_to_fader(configured)
			: carried !== null ? carried
			: first_time ? level_to_fader(NEW_DCA_LEVEL)
			: null;
		const source = configured !== null ? "set for this cue"
			: carried !== null ? "where these channels were last mixed"
			: first_time ? "first time up, default level"
			: !getSettings().levelsFollowPeople ? "levels don't follow people (Console Setup), fader left as is"
			: "no level set, fader left as is";

		const shown = configured ?? (position !== null ? fader_to_level(position) : null);
		debugLog('LEVELS', `Cue ${cue_object.number}.${cue_object.point} DCA ${dca} -> ch ${channels_key}` +
			`${shown !== null ? ` at ${format_dca_level(shown)}` : ""} (${source})`);

		if (position !== null) {
			set_fader(selector, position);
			for (const ch of channels) channel_levels.set(ch, position);
		}

		if (reassigned) {
			presonusClient.assign_dca(selector, channels, CONTROLLED_LINES);
			set_dca_mute(dca, false);
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
const write_cue = async (_event, {cue_object, back = false}) => {

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
	
	if (presonusClient !== null) save_cue_snapshot();

	current_cue = cue_object;
	last_fired = {type: 'cue', cue: cue_object};
	
	console.log("[SOUND:write_cue]: Writing Cue")

	if (presonusClient === null) {
		console.warn("Client is not yet connected!")
		return;
	}

	init_channels();
	// Back into a cue we've been in: put its DCAs back as they were when we left it
	// (Console Setup → DCA Recall: "Back restores DCAs")
	const restore_on_back = back && getSettings().restoreOnBack;
	const restore = restore_on_back ? cue_snapshots.get(cue_key(cue_object)) : undefined;
	if (restore_on_back) debugLog('LEVELS', `Back to cue ${cue_key(cue_object)}: ${restore ? "restoring its DCAs" : "never left before, nothing to restore"}`);
	write_dcas(cue_object, restore);
	update_dca_colors();

	// Channels in this cue's DCAs show yellow while they have signal
	setActiveChannels(get_cue_channels());

	// TODO: Write AUX assignments?
	// filtergroup/ch1/mute_aux* - 0 or 1
	// filtergroup/ch1/aux* - volume 0.0 - 1.0
	
	
}

/**
 * Number of DCAs to write: the console's, up to 8 (the API throws for DCAs it doesn't have)
 */
const get_dca_count = () => {
	const console_dcas = presonusClient?.channelCounts?.DCA;
	return console_dcas > 0 ? Math.min(8, console_dcas) : 8;
}

/**
 * Parse a cue's per-channel map, e.g. channelProfiles "3=38,5=40"
 * @param {String} value
 * @returns {Map<number, string>} channel -> value (channels not listed use their default)
 */
const parse_channel_map = (value) => new Map(String(value ?? "")
	.split(",")
	.map((item) => item.split("="))
	.filter(([ch, v]) => ch && v !== undefined)
	.map(([ch, v]) => [Number(ch), v.trim()]));

/**
 * The cue after the current one (skipping cues marked skip), in show order. After Line
 * Checks (no current cue) it's the first cue.
 * @returns {Cue | null}
 */
const get_next_cue = () => {
	const cues = [...(getShow()?.cues ?? [])].sort((a, b) => (Number(a.number) - Number(b.number)) || (Number(a.point) - Number(b.point)));
	const start = current_cue === null ? 0
		: cues.findIndex((c) => Number(c.number) === Number(current_cue.number) && Number(c.point) === Number(current_cue.point)) + 1;
	if (current_cue !== null && start === 0) return null;   // current cue isn't in the show

	return cues.slice(start).find((c) => !Number(c.skip)) ?? null;
}

/**
 * Darken a color (for dimmed DCAs)
 * @param {String} hex "rrggbb"
 */
const dim_color = (hex) => hex.match(/../g)
	.map((c) => Math.round(parseInt(c, 16) * DIM_FACTOR).toString(16).padStart(2, "0"))
	.join("");

/**
 * What a DCA's color should be now: what happens to it in the next cue (TheatreMix's
 * DCA color coding), dimmed when its fader is at -∞ if the show asks for that
 * @param {Number} dca
 * @param {Cue | null} next
 * @returns {{color: String, reason: String}}
 */
const dca_color_for = (dca, next) => {
	const now = current_cue === null ? [] : get_dca_channels(current_cue, dca);
	const then = next === null ? now : get_dca_channels(next, dca);
	const key = (channels) => [...channels].sort((a, b) => a - b).join(",");

	let state;
	// Unassigned now: always black, so it's obvious (whatever the next cue does with it)
	if (now.length === 0) state = 'off';
	else if (next === null) state = 'same';   // last cue: nothing coming
	else if (key(now) !== key(then)) state = now.length > 1 && then.length > 1 ? 'ensemble' : 'change';
	else {
		// Same channels: does one of them change position, FX or profile?
		const changes = (field) => {
			const a = parse_channel_map(current_cue[field]), b = parse_channel_map(next[field]);
			return now.some((ch) => (a.get(ch) ?? "") !== (b.get(ch) ?? ""));
		};
		state = changes('channelPositions') ? 'position'
			: changes('channelFX') ? 'fx'
			: changes('channelProfiles') ? 'profile'
			: 'same';
	}

	let color = DCA_COLORS[state];

	// Dim DCA Faders (TheatreMix show setting): a DCA at -∞ dims its scribble strip
	const config = getShow()?.config ?? {};
	const fader = read_dca_fader(dca);
	if (state !== 'off' && config.dimDCAFaders === "1" && fader !== null && fader <= DIM_FADER) {
		color = config.dimDCAFadersSuppressColours === "1" ? DCA_COLORS.dimmed : dim_color(color);
		return {color, reason: `${state}, dimmed (fader at -∞)`};
	}

	return {color, reason: state};
}

/**
 * Set one DCA's color if it changed
 * @param {Number} dca
 * @param {Cue | null} next
 */
const update_dca_color = (dca, next = get_next_cue()) => {
	if (presonusClient === null || dca > get_dca_count()) return;
	if (current_cue === null && last_fired?.type !== 'linecheck') return;   // nothing fired yet

	const {color, reason} = dca_color_for(dca, next);
	if (dca_colors.get(dca) === color) return;

	debugLog('DCACOLOR', `DCA ${dca} -> ${color} (${reason}; next cue ${next ? `${next.number}.${next.point}` : "none"})`);
	try {
		set_color({type: 'DCA', channel: dca}, color);
		dca_colors.set(dca, color);
	} catch (error) {
		debugLog('DCACOLOR', `Couldn't color DCA ${dca}`, error.message);
	}
}

/**
 * Color every DCA for what's coming in the next cue
 */
const update_dca_colors = () => {
	const next = get_next_cue();
	for (let dca = 1; dca <= get_dca_count(); dca++) update_dca_color(dca, next);
}

/**
 * Write every DCA for a cue
 * @param {Cue} cue_object (an empty object clears them all)
 * @param {Map<number, Object>} [restore] going Back: the cue's DCAs as they were when it was left
 */
const write_dcas = (cue_object, restore) => {
	// Capture where everyone is mixed right now, before any DCA changes
	remember_channel_levels();

	for (let i = 1; i <= get_dca_count(); i++) {
		try {
			write_dca(cue_object, i, restore?.get(i));
		} catch (error) {
			console.log(`[SOUND:write_cue]: Failed to write DCA #${i}`, error);
			// Unknown state, so fully rewrite this DCA on the next cue
			applied_dcas[i] = undefined;
		}
	}
}

/**
 * Fire Sound Check Cue: every line shows its actor's real name and every DCA is
 * cleared (unassigned, muted and blank), so nothing is up while mics are checked.
 * The levels people were mixed at are remembered for when they're next assigned.
 * @param {Event} _event 
 */
const fire_sound_check = async (_event) => {
	if (presonusClient !== null) save_cue_snapshot();
	current_cue = null;
	last_fired = {type: 'linecheck'};

	if (presonusClient === null) {
		console.warn("Console is not yet connected!");
		return;
	}

	debugLog('LINECHECK', "Line Checks: actors' names on the lines, clearing every DCA");
	set_soundcheck_labels();
	write_dcas({});
	update_dca_colors();
	setActiveChannels([]);
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

	if (current === name) {
		// Already showing it: remember that, so a reconnect can check it's still true
		line_names[ch] = name;
		return;
	}

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

/**
 * Monitor the open show's channels and refresh the DCA colors (call when the show changes)
 */
const sync_channel_monitor = () => {
	setMonitoredChannels(getShow(), CONTROLLED_LINES);
	// The show changed (edited, merged, settings): the next cue's DCA colors may have too
	update_dca_colors();
}

export {discover, connect, auto_connect, show_opened, disconnect, write_cue, fire_sound_check, reset_console_state, sync_channel_monitor, get_console_status, consoleEvents};
