// main/qlab.js
// QLab playback cue recall over OSC, the way TheatreMix does it:
//   /workspaces                         -> pick the open workspace
//   /workspace/{id}/connect {passcode}  -> authorise (QLab 5: passcode needs View + Control)
//   /workspace/{id}/thump               -> heartbeat
//   /workspace/{id}/cue/{number}/start  -> recall a cue
// QLab listens on UDP 53000 on this computer and replies to port 53001.

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

import { encodeMessage, decodePacket } from './osc.js';

const QLAB_HOST = '127.0.0.1';
const QLAB_PORT = 53000;
const REPLY_PORT = 53001;

// How often to look for QLab (or thump it once connected), and how long without a reply means it's gone
const TICK_INTERVAL = 2000;
const THUMP_TIMEOUT = 6000;

/**
 * @typedef {Object} QLabStatus
 * @property {'off' | 'connecting' | 'connected'} state
 * @property {String} [workspace] workspace name when connected
 * @property {String} [message] why it isn't connected
 */

const qlabEvents = new EventEmitter();

/** @type {dgram.Socket} */
let socket = null;
let timer = null;

let passcode = "";
let workspaceId = null;
let workspaceName = null;
let lastReply = 0;

/** @type {QLabStatus} */
let status = {state: 'off'};

const setStatus = (next) => {
	if (JSON.stringify(next) === JSON.stringify(status)) return;

	status = next;
	console.log("[QLab]:", status.state, status.workspace ?? status.message ?? "");
	qlabEvents.emit('status', status);
}

const send = (address, args = []) => {
	if (socket === null) return;

	socket.send(encodeMessage(address, args), QLAB_PORT, QLAB_HOST, (error) => {
		if (error) console.warn("[QLab]: Send failed", error.code ?? error.message);
	});
}

/**
 * Forget the workspace and go back to searching for one
 * @param {String} message
 */
const dropConnection = (message) => {
	workspaceId = null;
	workspaceName = null;
	setStatus({state: 'connecting', message});
}

/**
 * Handle an OSC reply from QLab (the data is a JSON string)
 * @param {Buffer} packet
 */
const handleReply = (packet) => {
	let messages;
	try {
		messages = decodePacket(packet);
	} catch (error) {
		console.warn("[QLab]: Bad OSC packet", error.message);
		return;
	}

	for (const {address, args} of messages) {
		let reply = {};
		try {
			reply = JSON.parse(args[0] ?? "{}");
		} catch {
			// Some replies aren't JSON; ignore them
		}

		if (address === '/reply/workspaces') {
			const workspaces = Array.isArray(reply.data) ? reply.data : [];

			if (workspaces.length === 0) {
				dropConnection("No QLab workspace is open");
				continue;
			}

			// Use the first open workspace, like TheatreMix
			const workspace = workspaces[0];
			workspaceId = workspace.uniqueID;
			workspaceName = workspace.displayName ?? "QLab";

			send(`/workspace/${workspaceId}/connect`, passcode ? [passcode] : []);
			continue;
		}

		const connectReply = /^\/reply\/workspace\/([0-9A-F-]+)\/connect$/i.exec(address);
		if (connectReply && connectReply[1] === workspaceId) {
			const data = String(reply.data ?? reply.status ?? "");

			if (data.startsWith('ok')) {
				lastReply = Date.now();
				setStatus({state: 'connected', workspace: workspaceName});
			} else if (data === 'badpass') {
				dropConnection("QLab rejected the OSC passcode in the show's QLab settings");
			} else {
				dropConnection(`QLab refused the connection (${data || "no reason given"})`);
			}
			continue;
		}

		const thumpReply = /^\/reply\/workspace\/([0-9A-F-]+)\/thump$/i.exec(address);
		if (thumpReply && thumpReply[1] === workspaceId) {
			lastReply = Date.now();
			continue;
		}

		// A recall failed (e.g. no cue with that number)
		if (/\/cue\/.+\/start$/.test(address) && reply.status && reply.status !== 'ok') {
			console.warn(`[QLab]: ${address} -> ${reply.status}`);
		}
	}
}

/**
 * Connection loop: search for a workspace, or thump the one we're connected to
 */
const tick = () => {
	if (status.state === 'connected') {
		if (Date.now() - lastReply > THUMP_TIMEOUT) {
			dropConnection("QLab stopped responding");
			return;
		}
		send(`/workspace/${workspaceId}/thump`);
		return;
	}

	send('/workspaces');
}

/**
 * Open the reply socket. QLab replies to port 53001, so bind there if we can.
 * @returns {Promise<void>}
 */
const openSocket = () => new Promise((resolve) => {
	const bind = (port) => {
		const s = dgram.createSocket({type: 'udp4'});

		s.once('error', (error) => {
			s.close();

			if (port === REPLY_PORT && error.code === 'EADDRINUSE') {
				// Another app (e.g. TheatreMix) has 53001; replies may still reach us on our own port
				console.warn(`[QLab]: Port ${REPLY_PORT} is in use (is TheatreMix open?), using a random port`);
				bind(0);
				return;
			}

			console.warn("[QLab]: Could not open OSC socket", error);
			setStatus({state: 'connecting', message: `Could not open the QLab OSC port (${error.code ?? error.message})`});
			resolve();
		});

		s.bind(port, () => {
			s.on('error', (error) => console.warn("[QLab]: Socket error", error));
			s.on('message', handleReply);
			socket = s;
			resolve();
		});
	};

	bind(REPLY_PORT);
});

/**
 * Start talking to QLab
 * @param {String} code OSC passcode from the show's QLab settings
 */
const start = async (code) => {
	const passcodeChanged = code !== passcode;
	passcode = code;

	if (socket !== null) {
		// Already running: reconnect only if the passcode changed
		if (passcodeChanged) dropConnection("Reconnecting with new passcode");
		return;
	}

	setStatus({state: 'connecting', message: "Looking for QLab"});
	await openSocket();

	clearInterval(timer);
	timer = setInterval(tick, TICK_INTERVAL);
	tick();
}

/**
 * Stop talking to QLab
 */
const stop = () => {
	clearInterval(timer);
	timer = null;

	if (socket !== null) {
		socket.close();
		socket = null;
	}

	workspaceId = null;
	workspaceName = null;
	setStatus({state: 'off'});
}

/**
 * Start or stop QLab to match the show's "Recall QLab cues" setting
 * (set in TheatreMix: Show Setup → QLab). QLab only runs on macOS.
 * @param {import('../models/ShowFile').default | null} show
 */
const syncQLab = (show) => {
	const enabled = process.platform === 'darwin' && show?.config?.qLabCues === "1";

	if (enabled) {
		start(show.config.qLabPasscode ?? "");
	} else {
		stop();
	}
}

/**
 * Start a QLab cue
 * @param {String} cueNumber QLab cue number (case and whitespace sensitive)
 * @returns {{ok: boolean, error?: String}}
 */
const recallQLabCue = (cueNumber) => {
	if (!cueNumber) return {ok: false, error: "No QLab cue"};

	if (status.state !== 'connected') {
		const error = `QLab isn't connected${status.message ? `: ${status.message}` : ""}`;
		console.warn(`[QLab]: Can't start cue ${cueNumber}. ${error}`);
		return {ok: false, error};
	}

	console.log(`[QLab]: Starting cue ${cueNumber}`);
	send(`/workspace/${workspaceId}/cue/${cueNumber}/start`);
	return {ok: true};
}

const getQLabStatus = () => status;

export { qlabEvents, syncQLab, recallQLabCue, getQLabStatus, stop as stopQLab };
