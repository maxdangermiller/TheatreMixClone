// main/consoleButtons.js
// Console mute group buttons as Go / Back, the way TheatreMix's "Mute Group Buttons" work.
//
// The mapping is "action=muteGroup,..." e.g. "1=5,0=6" means Back on mute group 5
// and Go on mute group 6 (TheatreMix's muteButtonMap format). It comes from this app's
// StudioLive Console Setup (saved in the .tmixp), or if that hasn't been set, from
// TheatreMix's own setting (Console Setup → Mute Group Buttons) in the show's config.
//
// Pressing a mute group button on the console makes it send PV mutegroup/mutegroupN to
// every connected client. A real StudioLive 32 won't latch an EMPTY mute group, so a press
// only arrives as "= 0" (dad's console, 2026-10-09: every press logged as "off", never on).
// A group with channels in it latches and sends "= 1"; then we run the action and set it
// straight back to 0 so it acts like a push button, and ignore the "0" that follows.
// Use EMPTY mute groups: pressing one that has channels in it also mutes them.

import { EventEmitter } from 'node:events';

import { debugLog, describe } from './debugLog.js';

const MUTE_GROUP_COUNT = 8;

// Ignore a second press of the same button within this time (contact bounce / double taps)
const DEBOUNCE_MS = 300;

// An "off" this soon after an "on" (or our own reset) is that press ending, not a new press
const RELEASE_MS = 1000;

// TheatreMix action numbers. Only Go and Back are supported here; the others are
// listed (in TheatreMix's order) so the log can name them.
const ACTION_NAMES = [
	'Go', 'Back', 'QLab Go', 'QLab Stop', 'QLab Panic', 'QLab Pause', 'QLab Resume',
];
const SUPPORTED_ACTIONS = {0: 'go', 1: 'back'};

/** @type {import('@featherbear/presonus-studiolive-api').Client} */
let client = null;

/** @type {Map<Number, Number>} mute group -> TheatreMix action */
let buttonMap = new Map();
let rawButtonMap = "";

/** Runs a supported action ('go' | 'back'); set from main.js */
let actionHandler = (action) => debugLog('BUTTONS', `No action handler set, dropped ${action}`);

/** Log every message the console sends (Help → Log All Console Messages) */
let logAllMessages = false;

/** Per mute group: presses seen, last press time, last raw value */
const stats = new Map();

/**
 * 'activity' {group, on, pressed, action, fired} for every mute group change (Console Setup shows
 * presses live); 'changed' when the map or console mute groups are re-read
 */
const buttonEvents = new EventEmitter();

/** Where the current map came from */
let mapSource = 'none';

// #region Helpers

const statFor = (group) => {
	if (!stats.has(group)) stats.set(group, {presses: 0, lastPress: null, lastValue: null, ignored: 0, lastOn: 0, lastReset: 0});
	return stats.get(group);
}

/**
 * Decode a mute group value. The API passes it through as raw bytes (little-endian
 * float 1.0 / 0.0); handle booleans and numbers too in case that changes.
 * @param {any} value
 * @returns {boolean | null} null if it can't be read
 */
const decodeOn = (value) => {
	if (Buffer.isBuffer(value)) {
		return value.length >= 4 ? value.readFloatLE(value.length - 4) >= 0.5 : null;
	}
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value >= 0.5;
	return null;
}

/**
 * Parse TheatreMix's "action=button,..." map
 * @param {String} text
 * @returns {Map<Number, Number>} button -> action
 */
const parseButtonMap = (text) => {
	const map = new Map();

	for (const pair of String(text ?? "").split(",")) {
		const match = /^\s*(\d+)\s*=\s*(\d+)\s*$/.exec(pair);
		if (!match) {
			if (pair.trim()) debugLog('BUTTONS', `Couldn't read button map entry "${pair}"`);
			continue;
		}

		const [action, button] = [Number(match[1]), Number(match[2])];
		if (button < 1 || button > MUTE_GROUP_COUNT) {
			debugLog('BUTTONS', `Mute group ${button} (for ${actionName(action)}) doesn't exist on this console`);
			continue;
		}
		map.set(button, action);
	}

	return map;
}

const actionName = (action) => ACTION_NAMES[action] ?? `action ${action}`;

/**
 * The show's mute group button map: this app's StudioLive setup if it has one
 * (even an empty one, meaning "no buttons"), otherwise TheatreMix's setting
 * @param {import('../models/ShowFile').default | null} show 
 * @returns {{map: String, source: 'studiolive' | 'theatremix' | 'none'}}
 */
const effectiveButtonMap = (show) => {
	if (show?.consoleSetup && Object.hasOwn(show.consoleSetup, 'muteButtonMap')) {
		return {map: show.consoleSetup.muteButtonMap ?? "", source: 'studiolive'};
	}
	if (show?.config?.muteButtonMap) {
		return {map: show.config.muteButtonMap, source: 'theatremix'};
	}
	return {map: "", source: 'none'};
}

/**
 * Write a button map back to TheatreMix's "action=button" format
 * @param {Map<Number, Number> | Object} groupToAction mute group -> action
 * @returns {String} e.g. "0=6,1=5"
 */
const serializeButtonMap = (groupToAction) => {
	const entries = groupToAction instanceof Map ? [...groupToAction] : Object.entries(groupToAction);

	return entries
		.map(([group, action]) => [Number(action), Number(group)])
		.filter(([action, group]) => Number.isInteger(action) && group >= 1 && group <= MUTE_GROUP_COUNT)
		.sort((a, b) => a[0] - b[0])
		.map(([action, group]) => `${action}=${group}`)
		.join(",");
}

/**
 * Channels in a mute group, from its membership string ("0010...")
 * @param {Number} group
 * @returns {Number[] | null} positions (1-based), or null if unknown
 */
const groupMembers = (group) => {
	const mutes = client?.state.get(`mutegroup/mutegroup${group}mutes`);
	if (typeof mutes !== 'string') return null;

	return [...mutes].flatMap((bit, i) => bit === '1' ? [i + 1] : []);
}

/**
 * Compact a channel list for display: [1,2,3,5] -> "1-3, 5"
 * @param {Number[]} channels
 */
const formatChannels = (channels) => {
	const ranges = [];
	for (const ch of channels) {
		const last = ranges[ranges.length - 1];
		if (last && ch === last[1] + 1) last[1] = ch; else ranges.push([ch, ch]);
	}
	return ranges.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(", ");
}

/**
 * Turn a mute group off on the console
 * @param {Number} group
 */
const resetGroup = (group) => {
	if (client === null) return;

	statFor(group).lastReset = Date.now();

	const zero = Buffer.alloc(4);
	zero.writeFloatLE(0);
	client._sendPacket('PV', Buffer.concat([Buffer.from(`mutegroup/mutegroup${group}\0\0\0`), zero]));
}

// #endregion

// #region Incoming messages

/**
 * A mute group changed on the console
 * @param {Number} group
 * @param {any} value raw PV value
 */
const handleMuteGroup = (group, value) => {
	const on = decodeOn(value);
	const stat = statFor(group);
	stat.lastValue = describe(value);

	const action = buttonMap.get(group);
	const mapped = action !== undefined ? `mapped to ${actionName(action)}` : "not mapped";

	const now = Date.now();

	// "off" right after an "on" or our reset is that press ending; otherwise it's a press
	// of an empty mute group (the console doesn't latch those, so it only ever sends off)
	const release = on === false && now - Math.max(stat.lastOn, stat.lastReset) < RELEASE_MS;
	const pressed = on === true || (on === false && !release);

	// Tell Console Setup (it flashes pressed buttons), whether or not it's mapped
	const notify = (fired) => buttonEvents.emit('activity', {group, on, pressed, action: action ?? null, fired});

	debugLog('BUTTONS', `Mute group ${group} -> ${on === null ? `unreadable value ${describe(value)}` : on ? "ON" : "off"}` +
		`${pressed ? " (pressed)" : release ? " (release)" : ""} (${mapped}, raw ${describe(value)})`);

	if (on === true) {
		stat.lastOn = now;
		// Make it a push button: turn it straight back off
		if (action !== undefined) resetGroup(group);
	}

	if (!pressed || action === undefined) {
		notify(false);
		return;
	}

	if (stat.lastPress !== null && now - stat.lastPress < DEBOUNCE_MS) {
		stat.ignored++;
		debugLog('BUTTONS', `Mute group ${group}: ignored repeat press ${now - stat.lastPress}ms after the last one`);
		notify(false);
		return;
	}

	stat.presses++;
	stat.lastPress = now;

	const command = SUPPORTED_ACTIONS[action];
	if (!command) {
		debugLog('BUTTONS', `Mute group ${group}: ${actionName(action)} isn't supported yet`);
		notify(false);
		return;
	}

	debugLog('BUTTONS', `Mute group ${group} pressed -> ${actionName(action)}`);
	actionHandler(command);
	notify(true);
}

const handlePV = ({name, value}) => {
	if (logAllMessages) debugLog('CONSOLE', `PV ${name} =`, value);

	const group = /^mutegroup\/mutegroup(\d+)$/.exec(name);
	if (group) {
		handleMuteGroup(Number(group[1]), value);
	} else if (name.startsWith('mutegroup/')) {
		// e.g. allon / alloff
		debugLog('BUTTONS', `Mute group message ${name} =`, value);
	}
}

const handlePS = ({name, value}) => {
	if (logAllMessages) debugLog('CONSOLE', `PS ${name} =`, value);

	// Mute group renamed or its channels changed on the console: Console Setup shows these
	if (/^mutegroup\/mutegroup\d+(username|mutes)$/.test(name)) {
		debugLog('BUTTONS', `Mute group setting ${name} = ${describe(value)}`);
		buttonEvents.emit('changed');
	}
}

const handlePC = ({name, value}) => {
	if (logAllMessages) debugLog('CONSOLE', `PC ${name} =`, value);
}

// #endregion

/**
 * Start listening to a new console client
 * @param {import('@featherbear/presonus-studiolive-api').Client} newClient
 */
const attachConsoleButtons = (newClient) => {
	client = newClient;
	client.on('PV', handlePV);
	client.on('PS', handlePS);
	client.on('PC', handlePC);
	debugLog('BUTTONS', "Listening for console button presses");
}

/**
 * Stop listening (the client is being torn down)
 */
const detachConsoleButtons = () => {
	if (client === null) return;

	client.off('PV', handlePV);
	client.off('PS', handlePS);
	client.off('PC', handlePC);
	client = null;
	debugLog('BUTTONS', "Stopped listening for console button presses");
}

/**
 * Load the button map from the show and check the console's mute groups.
 * Call on connect / reconnect and when a show is opened.
 * @param {import('../models/ShowFile').default | null} show
 */
const syncConsoleButtons = (show) => {
	({map: rawButtonMap, source: mapSource} = effectiveButtonMap(show));
	buttonMap = parseButtonMap(rawButtonMap);

	const from = mapSource === 'studiolive' ? "StudioLive Console Setup" : "TheatreMix's Mute Group Buttons";

	if (buttonMap.size === 0) {
		debugLog('BUTTONS', show
			? `No mute group buttons in this show (${mapSource === 'none' ? "none set" : `${from}: "${rawButtonMap}"`}). Set them in Console Setup.`
			: "No show open, so no mute group buttons");
	} else {
		debugLog('BUTTONS', `Button map "${rawButtonMap}" from ${from}: ` +
			[...buttonMap].map(([group, action]) => `mute group ${group} = ${actionName(action)}`).join(", "));
	}

	buttonEvents.emit('changed');

	if (client === null) return;

	// Snapshot every mute group, so the log shows which ones are free to use
	for (let group = 1; group <= MUTE_GROUP_COUNT; group++) {
		const name = client.state.get(`mutegroup/mutegroup${group}username`);
		const members = groupMembers(group);
		const on = decodeOn(client.state.get(`mutegroup/mutegroup${group}`));
		const action = buttonMap.get(group);

		debugLog('BUTTONS', `  Mute group ${group} "${name ?? "?"}": ` +
			`${members === null ? "members unknown" : members.length ? `channels ${formatChannels(members)}` : "empty"}, ` +
			`${on ? "ON" : "off"}${action !== undefined ? ` -> ${actionName(action)}` : ""}`);

		if (action === undefined) continue;

		if (members?.length) {
			debugLog('BUTTONS', `  WARNING: mute group ${group} (${actionName(action)}) contains channels ${formatChannels(members)}. Pressing it will also mute them; use an empty mute group.`);
		}

		// Left on from before (e.g. pressed while the app was closed): clear it without firing
		if (on) {
			debugLog('BUTTONS', `  Mute group ${group} was left on, turning it off`);
			resetGroup(group);
		}
	}
}

/**
 * Set what runs when a mapped button is pressed
 * @param {(action: 'go' | 'back') => void} handler
 */
const setButtonActionHandler = (handler) => {
	actionHandler = handler;
}

const setLogAllConsoleMessages = (enabled) => {
	logAllMessages = enabled;
	debugLog('BUTTONS', `Logging all console messages: ${enabled ? "on" : "off"}`);
}

const getLogAllConsoleMessages = () => logAllMessages;

/**
 * Human-readable status for Help → Console Buttons
 * @returns {String}
 */
const getConsoleButtonReport = () => {
	const lines = [];

	lines.push(client ? "Console: connected" : "Console: not connected");
	lines.push(`Mute group buttons: ${rawButtonMap ? `"${rawButtonMap}"` : "none set"}` +
		(mapSource === 'studiolive' ? " (from StudioLive Console Setup)" : mapSource === 'theatremix' ? " (from TheatreMix)" : ""));
	lines.push("");

	if (buttonMap.size === 0) {
		lines.push("No buttons mapped. Set them in File → Console Setup (⌘K).");
	}

	for (const [group, action] of buttonMap) {
		const stat = statFor(group);
		const members = client ? groupMembers(group) : null;
		const name = client?.state.get(`mutegroup/mutegroup${group}username`);

		lines.push(`Mute group ${group}${name ? ` "${name}"` : ""} → ${actionName(action)}${SUPPORTED_ACTIONS[action] ? "" : " (not supported yet)"}`);
		if (members !== null) {
			lines.push(members.length ? `    ⚠︎ contains channels ${formatChannels(members)}` : "    empty (good)");
		}
		lines.push(`    presses: ${stat.presses}${stat.lastPress ? `, last ${new Date(stat.lastPress).toLocaleTimeString()}` : ""}${stat.ignored ? `, ${stat.ignored} ignored as repeats` : ""}`);
	}

	const unmapped = [...stats].filter(([group]) => !buttonMap.has(group));
	if (unmapped.length) {
		lines.push("");
		lines.push(`Other mute groups changed: ${unmapped.map(([group, s]) => `${group} (last ${s.lastValue})`).join(", ")}`);
	}

	lines.push("");
	lines.push(`Log all console messages: ${logAllMessages ? "on" : "off"}`);

	return lines.join("\n");
}

/**
 * Everything Console Setup needs to show the mute group buttons
 * @param {import('../models/ShowFile').default | null} show 
 * @returns {{
 *   hasShow: boolean, connected: boolean, source: String, map: Object<number, number>,
 *   actions: {id: Number, name: String, supported: boolean}[],
 *   groups: {group: Number, name: String | null, members: Number[] | null, membersText: String | null, presses: Number}[]
 * }}
 */
const getButtonSetup = (show) => {
	const {map, source} = effectiveButtonMap(show);

	const groups = [];
	for (let group = 1; group <= MUTE_GROUP_COUNT; group++) {
		const members = client ? groupMembers(group) : null;
		groups.push({
			group,
			name: client?.state.get(`mutegroup/mutegroup${group}username`) ?? null,
			members,
			membersText: members?.length ? formatChannels(members) : null,
			presses: stats.get(group)?.presses ?? 0,
		});
	}

	return {
		hasShow: show !== null && show !== undefined,
		connected: client !== null,
		source,
		map: Object.fromEntries(parseButtonMap(map)),
		actions: ACTION_NAMES.map((name, id) => ({id, name, supported: id in SUPPORTED_ACTIONS})),
		groups,
	};
}

export {
	buttonEvents,
	effectiveButtonMap,
	serializeButtonMap,
	getButtonSetup,
	attachConsoleButtons,
	detachConsoleButtons,
	syncConsoleButtons,
	setButtonActionHandler,
	setLogAllConsoleMessages,
	getLogAllConsoleMessages,
	getConsoleButtonReport,
	parseButtonMap,
};
