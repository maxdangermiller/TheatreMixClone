// main/channelMonitor.js
// Automatic channel monitoring, like TheatreMix: each monitored channel's colour on the
// console shows its state at a glance.
//   red    - nearly clipping (faulty cable or connector), held a while so it can be checked
//   blue   - silent for a few seconds (mic off, flat battery, out of range)
//   yellow - has signal and is in one of the current cue's DCAs
//   white  - has signal
//
// Levels come from the console's meter frames: meter group 0 ("input signal"), one
// 16-bit linear value per line channel, 65535 = 0 dBFS (checked against Universal
// Control's meters with the simulator).

import { debugLog } from './debugLog.js';

// Meter group with each line channel's input level
const INPUT_SIGNAL_GROUP = 0;

// Below this for SILENCE_MS -> blue. Back above RESTORE_DB -> white/yellow. The gap stops a
// channel hovering at the threshold from flickering.
const SILENCE_DB = -60;
const RESTORE_DB = -57;
const SILENCE_MS = 3000;

// At or above this -> red, held for CLIP_HOLD_MS after the last time it got there
const CLIP_DB = -3;
const CLIP_HOLD_MS = 10000;

// If no meter frames arrive for this long, stop judging silence (no data is not silence)
const METER_TIMEOUT_MS = 2000;

// Colours from the StudioLive's own channel palette
const COLORS = {
	clip: "ff0000",
	silent: "0000ff",
	signal: "f0f0f0",
	active: "ffff00",
};

/** @type {import('@featherbear/presonus-studiolive-api').Client} */
let client = null;

/** Line channels to monitor (the show's channels) */
let channels = [];

/** Channels in the current cue's DCAs (yellow when they have signal) */
let activeChannels = new Set();

/**
 * Per channel: {lastSignal: ms, silent: boolean, clipUntil: ms (0 = not clipping), sent: colour last sent | null, level: dB}
 * @type {Map<number, {lastSignal: number, silent: boolean, clipUntil: number, sent: string | null, level: number}>}
 */
const channelState = new Map();

let lastFrameAt = 0;
let metersFlowing = false;
let loggedLayout = null;

const toDb = (value) => value > 0 ? 20 * Math.log10(value / 65535) : -Infinity;
const formatDb = (db) => Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-∞";

const stateFor = (ch) => {
	if (!channelState.has(ch)) {
		channelState.set(ch, {lastSignal: Date.now(), silent: false, clipUntil: 0, sent: null, level: -Infinity});
	}
	return channelState.get(ch);
}

/**
 * Send a channel's colour if it changed
 * @param {Number} ch
 * @param {String} reason for the log
 */
const applyColor = (ch, reason) => {
	const state = stateFor(ch);
	const color = Date.now() < state.clipUntil ? COLORS.clip
		: state.silent ? COLORS.silent
		: activeChannels.has(ch) ? COLORS.active
		: COLORS.signal;

	if (state.sent === color || client === null) return;

	const name = {[COLORS.clip]: "red", [COLORS.silent]: "blue", [COLORS.active]: "yellow", [COLORS.signal]: "white"}[color];
	debugLog('METERS', `Channel ${ch} -> ${name} (${reason}, level ${formatDb(state.level)})`);

	try {
		client.setColor({type: 'LINE', channel: ch}, color);
		state.sent = color;
	} catch (error) {
		debugLog('METERS', `Couldn't colour channel ${ch}`, error.message);
	}
}

/**
 * A meter frame from the console: {type: 'level', [group]: values[]}
 * @param {Object} meterData
 */
const handleMeters = (meterData) => {
	const now = Date.now();

	// Log the layout once (and if it changes), so a console that sends something else shows up
	const layout = Object.entries(meterData)
		.filter(([key]) => key !== 'type')
		.map(([group, values]) => `${group}:${values.length}`)
		.join(" ");
	if (layout !== loggedLayout) {
		loggedLayout = layout;
		debugLog('METERS', `Meter layout (group:count): ${layout}`);
		if (!meterData[INPUT_SIGNAL_GROUP]) {
			debugLog('METERS', `WARNING: no input signal meters (group ${INPUT_SIGNAL_GROUP}) in this frame; channel monitoring can't run`);
		}
	}

	const levels = meterData[INPUT_SIGNAL_GROUP];
	if (!levels) return;

	if (!metersFlowing) {
		metersFlowing = true;
		// Don't count the gap without meters as silence
		for (const state of channelState.values()) state.lastSignal = now;
		debugLog('METERS', `Meters flowing: monitoring channels ${channels.join(", ") || "none"}`);
	}
	lastFrameAt = now;

	for (const ch of channels) {
		const value = levels[ch - 1];
		if (value === undefined) continue;

		const state = stateFor(ch);
		state.level = toDb(value);

		// Nearly clipping: red, and (re)start the hold
		if (state.level >= CLIP_DB) {
			const wasClipping = now < state.clipUntil;
			state.clipUntil = now + CLIP_HOLD_MS;
			state.lastSignal = now;
			state.silent = false;
			if (!wasClipping) applyColor(ch, "nearly clipping");
			continue;
		}

		// Hold over: back to blue / yellow / white
		if (state.clipUntil && now >= state.clipUntil) {
			state.clipUntil = 0;
			applyColor(ch, `no clipping for ${CLIP_HOLD_MS / 1000}s`);
		}

		if (state.level > (state.silent ? RESTORE_DB : SILENCE_DB)) {
			state.lastSignal = now;
			if (state.silent) {
				state.silent = false;
				applyColor(ch, "signal back");
				continue;
			}
		} else if (!state.silent && now - state.lastSignal >= SILENCE_MS) {
			state.silent = true;
			applyColor(ch, `silent for ${((now - state.lastSignal) / 1000).toFixed(1)}s`);
			continue;
		}

		// First frame after (re)connecting, or the cue changed: make sure the colour is right
		if (state.sent === null) applyColor(ch, "initial");
	}
}

/**
 * Notice when meter frames stop (e.g. the meter subscription was lost)
 */
setInterval(() => {
	if (metersFlowing && Date.now() - lastFrameAt > METER_TIMEOUT_MS) {
		metersFlowing = false;
		debugLog('METERS', `No meter data for ${METER_TIMEOUT_MS / 1000}s; pausing channel monitoring`);
	}
}, 1000).unref?.();

/**
 * Start monitoring a newly connected console. Colours are re-sent from scratch.
 * @param {import('@featherbear/presonus-studiolive-api').Client} newClient
 */
const attachChannelMonitor = (newClient) => {
	client = newClient;
	client.on('meter', handleMeters);
	resetChannelMonitor();
}

const detachChannelMonitor = () => {
	client?.off('meter', handleMeters);
	client = null;
	metersFlowing = false;
}

/**
 * Forget the colours we've sent (new connection, or the console may have been reset)
 */
const resetChannelMonitor = () => {
	for (const state of channelState.values()) state.sent = null;
	loggedLayout = null;
}

/**
 * Which channels to monitor: the show's channels (TheatreMix Show Setup), or a default
 * @param {import('../models/ShowFile').default | null} show
 * @param {Number[]} fallback
 */
const setMonitoredChannels = (show, fallback) => {
	const fromShow = String(show?.config?.channels ?? "")
		.split(",")
		.map(Number)
		.filter((ch) => Number.isInteger(ch) && ch > 0);

	const next = fromShow.length ? fromShow : fallback;
	if (next.join(",") === channels.join(",")) return;

	channels = next;
	debugLog('METERS', `Monitoring channels ${channels.join(", ")}${fromShow.length ? " (from the show)" : ""}`);
}

/**
 * Channels in the current cue's DCAs: yellow while they have signal
 * @param {Number[]} cueChannels
 */
const setActiveChannels = (cueChannels) => {
	activeChannels = new Set(cueChannels);
	for (const ch of channels) applyColor(ch, activeChannels.has(ch) ? "in the current cue" : "not in the current cue");
}

/**
 * Status for the debug report
 */
const getChannelMonitorStatus = () => ({
	metersFlowing,
	channels: channels.map((ch) => {
		const s = channelState.get(ch);
		return {ch, level: s ? formatDb(s.level) : "?", silent: s?.silent ?? false, color: s?.sent ?? null};
	}),
});

export {
	attachChannelMonitor,
	detachChannelMonitor,
	resetChannelMonitor,
	setMonitoredChannels,
	setActiveChannels,
	getChannelMonitorStatus,
	SILENCE_DB,
	SILENCE_MS,
	CLIP_DB,
	CLIP_HOLD_MS,
};
