/**
 * TheatreMix cue numbers are stored as a whole number plus a two-digit point:
 * {number: 7, point: 70} is cue 7.7, {number: 2, point: 25} is 2.25,
 * {number: 3, point: 5} is 3.05.
 */

/**
 * Format a cue number the way TheatreMix shows it ("1", "7.7", "2.25")
 * @param {Number} number
 * @param {Number} point
 * @returns {String}
 */
const format_cue_number = (number, point) => {
	const p = Number(point) || 0;
	if (p === 0) return String(number);

	return `${number}.${String(p).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * Parse a typed cue number ("12", "12.5", "12,25") into number + point
 * @param {String | Number} text
 * @returns {{number: Number, point: Number} | null} null if it isn't a cue number
 */
const parse_cue_number = (text) => {
	const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(String(text).trim());
	if (!match) return null;

	return {
		number: parseInt(match[1], 10),
		point: match[2] ? parseInt(match[2].padEnd(2, "0"), 10) : 0,
	};
}

export { format_cue_number, parse_cue_number };
