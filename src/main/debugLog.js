// main/debugLog.js
// Timestamped debug log written to a file (so it can be sent in for troubleshooting)
// as well as the console. Help → Show Debug Log opens it.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Start a fresh file once the log gets big, keeping the previous one
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logPath = null;

/**
 * Where the debug log lives (e.g. ~/Library/Logs/Presonus TheatreMix/debug.log on macOS)
 * @returns {String}
 */
const getDebugLogPath = () => {
	if (logPath === null) {
		const dir = app.getPath('logs');
		fs.mkdirSync(dir, {recursive: true});
		logPath = path.join(dir, 'debug.log');
	}
	return logPath;
}

/**
 * Turn a value into readable log text (buffers as hex)
 * @param {any} value
 * @returns {String}
 */
const describe = (value) => {
	if (value instanceof Buffer) return `<${value.toString('hex').replace(/(..)/g, '$1 ').trim()}>`;
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * Write a debug line
 * @param {String} tag e.g. "BUTTONS"
 * @param {...any} parts
 */
const debugLog = (tag, ...parts) => {
	const line = `${new Date().toISOString()} [${tag}] ${parts.map(describe).join(' ')}`;
	console.log(line);

	try {
		const file = getDebugLogPath();

		if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
			fs.renameSync(file, `${file}.old`);
		}

		fs.appendFileSync(file, line + '\n');
	} catch {
		// Logging must never break the app
	}
}

export { debugLog, getDebugLogPath, describe };
