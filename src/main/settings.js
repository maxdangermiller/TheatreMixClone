// main/settings.js
// App preferences that persist between launches (stored in the user data folder)

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// TheatreMix keeps 4 recent shows (⌘1 - ⌘4)
const MAX_RECENT_FILES = 4;

const ROW_SIZES = ['small', 'medium', 'large'];

const DEFAULTS = {
	/** @type {String[]} most recent first */
	recentFiles: [],
	/** @type {'small' | 'medium' | 'large'} cue list row size */
	rowSize: 'medium',
	/** Prevent edits (e.g. DCA levels) in the cue list */
	lockEditing: false,
	/** A person's DCA fader level follows them when they move to another DCA */
	levelsFollowPeople: true,
	/** Going Back into a cue restores its DCA faders and mutes as they were when it was left */
	restoreOnBack: true,
	/** On launch, connect to the last console if it's found */
	autoConnect: true,
	/** @type {{host: String, port: Number, name: String | null, serial: String | null} | null} last console connected to */
	lastConsole: null,
};

// On/off preferences, checked when loading
const BOOLEAN_SETTINGS = ['lockEditing', 'levelsFollowPeople', 'restoreOnBack', 'autoConnect'];

let settings = null;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

/**
 * Get all settings (loaded from disk on first use)
 * @returns {typeof DEFAULTS}
 */
function getSettings() {
	if (settings !== null) return settings;

	settings = {...DEFAULTS};

	try {
		const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));

		if (Array.isArray(saved.recentFiles)) settings.recentFiles = saved.recentFiles.filter((f) => typeof f === 'string');
		if (ROW_SIZES.includes(saved.rowSize)) settings.rowSize = saved.rowSize;
		for (const key of BOOLEAN_SETTINGS) {
			if (typeof saved[key] === 'boolean') settings[key] = saved[key];
		}
		if (typeof saved.lastConsole?.host === 'string') settings.lastConsole = saved.lastConsole;
	} catch {
		// No settings yet (first launch) or unreadable - use defaults, and carry over
		// the shows from the OS recent documents list the app used before
		try {
			settings.recentFiles = app.getRecentDocuments()
				.filter((f) => ['.tmix', '.tmixp', '.db'].includes(path.extname(f).toLowerCase()))
				.slice(0, MAX_RECENT_FILES);
		} catch {
			// getRecentDocuments isn't available on every platform
		}
	}

	return settings;
}

/**
 * Update and persist settings
 * @param {Partial<typeof DEFAULTS>} changes
 */
function updateSettings(changes) {
	settings = {...getSettings(), ...changes};

	try {
		fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, '\t'));
	} catch (error) {
		console.warn("[settings]: Failed to save settings", error);
	}
}

/**
 * Move a show to the top of the recent list
 * @param {String} filePath
 */
function addRecentFile(filePath) {
	const recentFiles = [
		filePath,
		...getSettings().recentFiles.filter((f) => path.resolve(f) !== path.resolve(filePath))
	].slice(0, MAX_RECENT_FILES);

	updateSettings({recentFiles});
	app.addRecentDocument(filePath);
}

/**
 * Drop a show from the recent list (e.g. it was moved or deleted)
 * @param {String} filePath
 */
function removeRecentFile(filePath) {
	updateSettings({
		recentFiles: getSettings().recentFiles.filter((f) => path.resolve(f) !== path.resolve(filePath))
	});
}

export {
	ROW_SIZES,
	getSettings,
	updateSettings,
	addRecentFile,
	removeRecentFile,
};
