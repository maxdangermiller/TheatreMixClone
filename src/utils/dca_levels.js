/**
 * Shared helpers for per-cue DCA levels (used by both main and renderer)
 *
 * Levels are stored as decibels, keyed by cue then DCA number:
 *   { "2.0": { 3: -10, 4: -5.5 } }
 */

// Range accepted by setChannelVolumeLogarithmic (-84 dB is -∞)
const MIN_DCA_LEVEL = -84;
const MAX_DCA_LEVEL = 10;

// Where the level popup's slider starts when no level is set (unity). With no level set a
// DCA isn't moved: it takes the level its people were last mixed at, or stays where it is.
const DEFAULT_DCA_LEVEL = 0;

// Where a DCA comes up the first time it gets people (no level set for the cue and none of
// them mixed yet), so it's at a safe, usable level rather than wherever the fader was
const NEW_DCA_LEVEL = -20;

/**
 * Key for a cue in the DCA level map (cues are unique by number + point)
 * @param {Number} number
 * @param {Number} point
 * @returns {String}
 */
const dca_level_key = (number, point) => `${number}.${point}`;

/**
 * Get the stored level for a cue's DCA
 * @param {Object} dca_levels level map
 * @param {Cue} cue
 * @param {Number} dca
 * @returns {Number | null} level in dB, or null if none is set
 */
const get_dca_level = (dca_levels, cue, dca) => {
	if (!dca_levels || !cue) return null;

	return dca_levels[dca_level_key(cue.number, cue.point)]?.[dca] ?? null;
}

/**
 * Clamp a level into the console's range
 * @param {Number} level dB
 * @returns {Number}
 */
const clamp_dca_level = (level) => Math.min(MAX_DCA_LEVEL, Math.max(MIN_DCA_LEVEL, level));

/**
 * Format a level for display
 * @param {Number} level dB
 * @returns {String} e.g. "-10.0 dB", "+2.5 dB", "-∞"
 */
const format_dca_level = (level) => {
	if (level <= MIN_DCA_LEVEL) return "-∞";

	return `${level > 0 ? "+" : ""}${level.toFixed(1)} dB`;
}

/**
 * dB -> fader position (0-100), the same curve the API uses to send levels to the console
 * @param {Number} level dB
 * @returns {Number} fader position
 */
const level_to_fader = (level) => {
	if (level <= MIN_DCA_LEVEL) return 0;
	if (level >= MAX_DCA_LEVEL) return 100;

	const fader = 72.5204177782 + 2.473473992 * level + 0.026567557 * level ** 2 + 0.0000880866 * level ** 3;
	return Math.min(100, Math.max(0, fader));
}

/**
 * Fader position (0-100) -> dB, rounded to 0.5 dB
 * @param {Number} fader position
 * @returns {Number} level dB
 */
const fader_to_level = (fader) => {
	if (fader <= 0) return MIN_DCA_LEVEL;
	if (fader >= 100) return MAX_DCA_LEVEL;

	// The curve has no clean inverse, so binary search it
	let low = MIN_DCA_LEVEL, high = MAX_DCA_LEVEL;
	for (let i = 0; i < 40; i++) {
		const mid = (low + high) / 2;
		if (level_to_fader(mid) < fader) low = mid; else high = mid;
	}

	return clamp_dca_level(Math.round(((low + high) / 2) * 2) / 2);
}

export {
	MIN_DCA_LEVEL, MAX_DCA_LEVEL, DEFAULT_DCA_LEVEL, NEW_DCA_LEVEL,
	dca_level_key, get_dca_level, clamp_dca_level, format_dca_level,
	level_to_fader, fader_to_level
};
