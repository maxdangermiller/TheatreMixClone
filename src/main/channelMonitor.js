// main/channelMonitor.js
// Automatic channel monitoring, like TheatreMix: each monitored channel's color on the
// console shows its state at a glance.
//   red    - nearly clipping (faulty cable or connector), held a while so it can be checked
//   blue   - silent for a few seconds (mic off, flat battery, out of range)
//   yellow - has signal and is in one of the current cue's DCAs
//   white  - has signal
//
// Levels come from the console's meter frames. Each group id is [channel type][metering
// stage]; line channels are type 0 (groups 0-255, a real StudioLive 32 sends stages 4-6),
// one 16-bit linear value per channel, 65535 = 0 dBFS. The console trims each group's
// trailing silent channels and leaves out groups that are entirely silent (checked against
// ~18,500 captured frames), so a missing channel or group means silence, not "no data".
// A channel's level is its loudest line stage.

import { debugLog } from './debugLog.js';

// Line channel meter groups are type byte 0
const isLineGroup = (group) => group >= 0 && group < 256;

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

// Colors from the StudioLive's own channel palette
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
 * Per channel: {lastSignal: ms, silent: boolean, clipUntil: ms (0 = not clipping), sent: color last sent | null, level: dB}
 * @type {Map<number, {lastSignal: number, silent: boolean, clipUntil: number, sent: string | null, level: number}>}
 */
const channelState = new Map();

let lastFrameAt = 0;
let metersFlowing = false;
/** Meter groups seen since connecting (logged as they first appear) */
let seenGroups = new Set();

const toDb = (value) => value > 0 ? 20 * Math.log10(value / 65535) : -Infinity;
const formatDb = (db) => Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-∞";

const stateFor = (ch) => {
	if (!channelState.has(ch)) {
		channelState.set(ch, {lastSignal: Date.now(), silent: false, clipUntil: 0, sent: null, level: -Infinity});
	}
	return channelState.get(ch);
}

/**
 * Send a channel's color if it changed
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
		debugLog('METERS', `Couldn't color channel ${ch}`, error.message);
	}
}

/**
 * A meter frame from the console: {type: 'level', [group]: values[]}
 * @param {Object} meterData
 */
const handleMeters = (meterData) => {
	const now = Date.now();

	// Groups come and go as they go silent, so just log each one the first time it shows up
	const groups = Object.keys(meterData).filter((key) => key !== 'type').map(Number);
	const newGroups = groups.filter((group) => !seenGroups.has(group));
	if (newGroups.length) {
		newGroups.forEach((group) => seenGroups.add(group));
		debugLog('METERS', `New meter groups (group:count): ${newGroups.map((g) => `${g}:${meterData[g].length}`).join(" ")}; line groups so far: ${[...seenGroups].filter(isLineGroup).join(", ") || "none"}`);
	}

	// Loudest line stage per channel (index = channel - 1); anything not sent is silent
	const levels = [];
	for (const group of groups.filter(isLineGroup)) {
		meterData[group].forEach((value, i) => { levels[i] = Math.max(levels[i] ?? 0, value); });
	}

	if (!metersFlowing) {
		metersFlowing = true;
		// Don't count the gap without meters as silence
		for (const state of channelState.values()) state.lastSignal = now;
		debugLog('METERS', `Meters flowing: monitoring channels ${channels.join(", ") || "none"}`);
	}
	lastFrameAt = now;

	for (const ch of channels) {
		const value = levels[ch - 1] ?? 0;

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

		// First frame after (re)connecting, or the cue changed: make sure the color is right
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
 * Start monitoring a newly connected console. Colors are re-sent from scratch.
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
 * Forget the colors we've sent (new connection, or the console may have been reset)
 */
const resetChannelMonitor = () => {
	for (const state of channelState.values()) state.sent = null;
	seenGroups = new Set();
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
