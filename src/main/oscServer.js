// main/oscServer.js
// TheatreMix-compatible OSC API on UDP port 32000, so QLab (Network cues) or a
// Stream Deck via Bitfocus Companion can drive the cue list.
//
// Supported:  /go  /back  /jump {number}  /jump selected  /select [up|down|current]
//             /lock  /unlock  /undo  /redo  /theatremix  /thump  /subscribe
// Events sent to subscribers:  /cuefired {number} {text} [color]

import { app } from 'electron';
import dgram from 'node:dgram';
import path from 'node:path';

import { encodeMessage, decodePacket } from './osc.js';
import { sendMenuAction, setLockEditing } from './menuManager.js';
import { getShow, getShowPath } from './showManager.js';
import { format_cue_number } from '../utils/cue_number.js';

const OSC_PORT = 32000;

// TheatreMix allows up to five subscribers; they renew at half the expiry
const MAX_SUBSCRIBERS = 5;
const SUBSCRIPTION_SECONDS = 60;

// Editing commands TheatreMix has that this app doesn't support yet
const UNSUPPORTED = [
	'/markcue', '/insertcue', '/clonecue', '/deletecue', '/recordoffsets', '/cloneoffsets',
	'/togglebackup', '/allocatespare', '/togglespare', '/removespare',
];

const CUE_COLORS = {1: 'red', 2: 'yellow', 3: 'green', 4: 'blue', 5: 'purple'};

/** @type {dgram.Socket} */
let socket = null;

/** @type {Map<String, {address: String, port: Number, expires: Number}>} */
const subscribers = new Map();

/**
 * Pass a command to the cue list. Marked remote so it still runs while a popup
 * is open (a QLab network cue mid-show shouldn't be blocked by a stray dialog).
 * @param {String} action 
 * @param {any} [arg] 
 */
const sendRemote = (action, arg) => {
	sendMenuAction({action, arg, remote: true});
}

const reply = (rinfo, address, args = []) => {
	socket?.send(encodeMessage(address, args), rinfo.port, rinfo.address);
}

/**
 * Handle one OSC command
 * @param {{address: String, args: Array}} message
 * @param {dgram.RemoteInfo} rinfo
 */
const handleCommand = ({address, args}, rinfo) => {
	switch (address) {
		case '/go':
			sendRemote('go');
			return;

		case '/back':
			sendRemote('back');
			return;

		case '/jump':
			if (args[0] === 'selected') {
				sendRemote('jump-selected');
			} else if (args.length > 0) {
				// Cue number as a string, int32 or float32 (floats can be inexact, e.g. 7.699999)
				const number = typeof args[0] === 'number' && !Number.isInteger(args[0])
					? String(Math.round(args[0] * 100) / 100)
					: String(args[0]);
				sendRemote('jump-to', number);
			}
			return;

		case '/select':
			if (['up', 'down', 'current'].includes(args[0])) {
				sendRemote('select', args[0]);
			}
			return;

		case '/lock':
			setLockEditing(true);
			return;

		case '/unlock':
			setLockEditing(false);
			return;

		case '/undo':
		case '/redo':
			sendRemote(address.slice(1));
			return;

		case '/theatremix': {
			const showPath = getShowPath();
			reply(rinfo, '/theatremix', showPath
				? [app.getVersion(), path.parse(showPath).name]
				: [app.getVersion()]);
			return;
		}

		case '/thump':
			reply(rinfo, '/thump');
			return;

		case '/subscribe': {
			const key = `${rinfo.address}:${rinfo.port}`;
			pruneSubscribers();

			if (!subscribers.has(key) && subscribers.size >= MAX_SUBSCRIBERS) {
				reply(rinfo, '/subscribefail');
				return;
			}

			subscribers.set(key, {address: rinfo.address, port: rinfo.port, expires: Date.now() + SUBSCRIPTION_SECONDS * 1000});
			reply(rinfo, '/subscribeok', [SUBSCRIPTION_SECONDS]);
			return;
		}

		default:
			if (UNSUPPORTED.includes(address)) {
				console.log(`[OSC]: ${address} isn't supported yet`);
			} else {
				console.log(`[OSC]: Unknown command ${address}`);
			}
	}
}

const pruneSubscribers = () => {
	const now = Date.now();
	for (const [key, sub] of subscribers) {
		if (sub.expires < now) subscribers.delete(key);
	}
}

/**
 * Tell subscribers a cue was fired
 * @param {{number: Number, point: Number, name: String, colour?: Number} | null} cue null for Line Checks
 */
const notifyCueFired = (cue) => {
	if (socket === null) return;
	pruneSubscribers();
	if (subscribers.size === 0) return;

	const args = cue === null
		? ['0', 'Line Checks']
		: [format_cue_number(cue.number, cue.point), cue.name ?? ""];

	const color = CUE_COLORS[cue?.colour];
	if (color) args.push(color);

	const packet = encodeMessage('/cuefired', args);
	for (const sub of subscribers.values()) {
		socket.send(packet, sub.port, sub.address);
	}
}

/**
 * Start the OSC server
 */
const startOscServer = () => {
	if (socket !== null) return;

	const s = dgram.createSocket({type: 'udp4'});

	s.on('error', (error) => {
		// Usually TheatreMix itself is running and already has the port
		console.warn(`[OSC]: Could not start the OSC server on port ${OSC_PORT} (${error.code ?? error.message}). Is TheatreMix open?`);
		s.close();
		socket = null;
	});

	s.on('message', (packet, rinfo) => {
		try {
			for (const message of decodePacket(packet)) {
				handleCommand(message, rinfo);
			}
		} catch (error) {
			console.warn("[OSC]: Bad packet", error.message);
		}
	});

	s.bind(OSC_PORT, () => {
		console.log(`[OSC]: Listening on UDP port ${OSC_PORT}`);
		socket = s;
	});
}

const stopOscServer = () => {
	socket?.close();
	socket = null;
	subscribers.clear();
}

export { startOscServer, stopOscServer, notifyCueFired };
