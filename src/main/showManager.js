// main/showManager.js

import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import DatabaseConnection from '../database/DatabaseConnection';
import ShowRepository from '../repositories/ShowRepository';
import ShowFile from '../models/ShowFile';

import { EventEmitter } from 'node:events';

import { dca_level_key, clamp_dca_level } from '../utils/dca_levels';
import { getMainWindow } from './windowManager.js';
import { addRecentFile } from './settings.js';

const APP_TITLE = "PreSonus TheatreMix";
const TMIXP_EXTENSION = ".tmixp";

/** @type {ShowFile} */
let currentShow = null;

/** @type {String} path the current show was loaded from / saved to */
let currentPath = null;

/**
 * File the show's TheatreMix data comes from on the next save. Usually currentPath,
 * but after merging a .tmix it's that .tmix until the merge is saved.
 * @type {String}
 */
let contentPath = null;

/** Unsaved changes (DCA levels, merges) */
let dirty = false;

/**
 * Undo / redo history for DCA level edits
 * @type {{key: String, dca: Number, before: Number | null, after: Number | null}[]}
 */
let undoStack = [];
let redoStack = [];

/** Emits 'changed' whenever the show, its path, dirty state or history changes (used by the menu) */
const showEvents = new EventEmitter();

/**
 * Update the window title / macOS "edited" dot
 */
function updateTitle() {
	const window = getMainWindow();
	if (!window || window.isDestroyed()) return;

	const name = currentPath ? path.basename(currentPath) : "";
	window.setTitle(name ? `${name}${dirty ? " •" : ""} — ${APP_TITLE}` : APP_TITLE);

	// macOS only: shows the unsaved dot in the window's close button
	if (process.platform === 'darwin') {
		window.setDocumentEdited(dirty);
	}
}

function setDirty(value) {
	dirty = value;
	updateTitle();
	showEvents.emit('changed');
}

function clearHistory() {
	undoStack = [];
	redoStack = [];
}

/**
 * Load Show
 * @param {String} path to show file (.tmix, .tmixp or .db)
 * @returns {ShowFile} for loaded show
 */
function loadShow(path) {
	const db = new DatabaseConnection(path);

	const repo = new ShowRepository(db);

	try {
		currentShow = repo.load();
	} finally {
		db.close();
	}

	currentPath = path;
	contentPath = path;
	clearHistory();
	addRecentFile(path);
	setDirty(false);

	return currentShow;
}

/**
 * Close the current show (asks about unsaved changes first)
 * @returns {Promise<boolean>} true if closed
 */
async function closeShow() {
	if (currentShow === null) return true;
	if (!(await confirmDiscardChanges())) return false;

	currentShow = null;
	currentPath = null;
	contentPath = null;
	clearHistory();
	setDirty(false);

	return true;
}

/**
 * Info the menu needs to decide which items are enabled
 * @returns {{hasShow: boolean, isTmixp: boolean, canUndo: boolean, canRedo: boolean, qLabEnabled: boolean, canSave: boolean}}
 */
function getShowState() {
	return {
		hasShow: currentShow !== null,
		isTmixp: currentPath !== null && path.extname(currentPath).toLowerCase() === TMIXP_EXTENSION,
		canUndo: undoStack.length > 0,
		canRedo: redoStack.length > 0,
		// TheatreMix: Show Setup → QLab → "Recall QLab cues"
		qLabEnabled: currentShow?.config?.qLabCues === "1",
		// Save Show has something to do: unsaved changes, or a .tmix to save as a .tmixp
		canSave: currentShow !== null && (dirty || path.extname(currentPath).toLowerCase() !== TMIXP_EXTENSION),
	};
}

/**
 * Path of the open show file
 * @returns {String | null}
 */
function getShowPath() {
	return currentPath;
}

/**
 * Get Show
 * @returns {ShowFile} for loaded show
 */
function getShow() {
	return currentShow;
}

/**
 * Has the show got unsaved changes?
 * @returns {boolean}
 */
function isShowDirty() {
	return currentShow !== null && dirty;
}

/**
 * Set (or clear) the level a DCA comes up at in a cue
 * @param {Number} number cue number
 * @param {Number} point cue point
 * @param {Number} dca DCA number
 * @param {Number | null} level dB, or null to use the default
 * @returns {Object} updated DCA level map
 */
function setDcaLevel(number, point, dca, level) {
	if (currentShow === null) {
		throw new Error("No show is loaded");
	}

	const key = dca_level_key(number, point);
	const before = currentShow.dcaLevels[key]?.[dca] ?? null;
	const after = (level === null || level === undefined) ? null : clamp_dca_level(Number(level));

	if (before !== after) {
		applyDcaLevel(key, dca, after);
		undoStack.push({key, dca, before, after});
		redoStack = [];
		setDirty(true);
	}

	return currentShow.dcaLevels;
}

/**
 * Change a StudioLive console setting (saved in the .tmixp)
 * @param {String} param e.g. "muteButtonMap"
 * @param {String} value 
 * @returns {Object<string, string>} updated console setup
 */
function setConsoleSetup(param, value) {
	if (currentShow === null) {
		throw new Error("No show is loaded");
	}

	if (currentShow.consoleSetup[param] !== value) {
		currentShow.consoleSetup = {...currentShow.consoleSetup, [param]: value};
		setDirty(true);
	}

	return currentShow.consoleSetup;
}

/**
 * Write a level into the show's level map
 * @param {String} key cue key
 * @param {Number} dca 
 * @param {Number | null} level dB, or null to remove
 */
function applyDcaLevel(key, dca, level) {
	const levels = currentShow.dcaLevels;

	if (level === null) {
		if (levels[key]) {
			delete levels[key][dca];
			if (Object.keys(levels[key]).length === 0) delete levels[key];
		}
	} else {
		levels[key] = {...levels[key], [dca]: level};
	}
}

/**
 * Undo the last DCA level edit
 * @returns {Object | null} updated DCA level map, or null if there was nothing to undo
 */
function undoDcaLevel() {
	const entry = undoStack.pop();
	if (!entry || currentShow === null) return null;

	applyDcaLevel(entry.key, entry.dca, entry.before);
	redoStack.push(entry);
	setDirty(true);

	return currentShow.dcaLevels;
}

/**
 * Redo the last undone DCA level edit
 * @returns {Object | null} updated DCA level map, or null if there was nothing to redo
 */
function redoDcaLevel() {
	const entry = redoStack.pop();
	if (!entry || currentShow === null) return null;

	applyDcaLevel(entry.key, entry.dca, entry.after);
	undoStack.push(entry);
	setDirty(true);

	return currentShow.dcaLevels;
}

/**
 * Write the show's DCA levels into a .tmixp file
 * The .tmixp is a copy of the source show file with an extra dcaLevels table,
 * so everything TheatreMix stores is preserved.
 *
 * Written to a temp file and then renamed over the target, so a failed save
 * never leaves a half-written show behind.
 * @param {String} targetPath
 */
function writeTmixp(targetPath) {
	const tempPath = `${targetPath}.saving`;

	fs.copyFileSync(contentPath, tempPath);

	try {
		const db = new DatabaseConnection(tempPath);

		try {
			const repo = new ShowRepository(db);
			repo.saveDcaLevels(currentShow.dcaLevels);
			repo.saveConsoleSetup(currentShow.consoleSetup);
		} finally {
			db.close();
		}

		fs.renameSync(tempPath, targetPath);
	} catch (error) {
		fs.rmSync(tempPath, {force: true});
		throw error;
	}

	currentPath = targetPath;
	contentPath = targetPath;
	addRecentFile(targetPath);
	setDirty(false);
}

/**
 * Save Show - saves in place if it's already a .tmixp, otherwise asks where to save one
 * @returns {Promise<boolean>} true if saved
 */
async function saveShow() {
	if (currentShow === null) return false;

	if (path.extname(currentPath).toLowerCase() === TMIXP_EXTENSION) {
		return trySave(currentPath);
	}

	return saveShowAs();
}

/**
 * Write a .tmixp, reporting failures to the user
 * @param {String} targetPath 
 * @returns {boolean} true if saved
 */
function trySave(targetPath) {
	try {
		writeTmixp(targetPath);
		return true;
	} catch (error) {
		console.warn("[showManager]: Failed to save show", error);
		dialog.showErrorBox("Save Failed", `Could not save the show to ${targetPath}\r\n${error.message}`);
		return false;
	}
}

/**
 * Save Show As a new .tmixp file
 * @returns {Promise<boolean>} true if saved
 */
async function saveShowAs() {
	if (currentShow === null) return false;

	const parsed = path.parse(currentPath);

	const result = await dialog.showSaveDialog(getMainWindow(), {
		title: "Save Show",
		defaultPath: path.join(parsed.dir, parsed.name + TMIXP_EXTENSION),
		filters: [{ name: 'TheatreMix Presonus Show', extensions: ['tmixp'] }]
	});

	if (result.canceled || !result.filePath) return false;

	let target = result.filePath;
	if (path.extname(target).toLowerCase() !== TMIXP_EXTENSION) {
		target += TMIXP_EXTENSION;
	}

	return trySave(target);
}

/**
 * Merge an updated .tmix into the open .tmixp
 *
 * The .tmix becomes the source of truth for everything TheatreMix stores (cues,
 * actors, profiles, config...). DCA levels are kept for every cue that still
 * exists (matched by cue number + point). The merge is held in memory and marked
 * unsaved; saving writes it into the .tmixp.
 * @returns {Promise<ShowFile | null>} merged show, or null if canceled
 */
async function mergeTmix() {
	const window = getMainWindow();

	if (currentShow === null || path.extname(currentPath).toLowerCase() !== TMIXP_EXTENSION) {
		await dialog.showMessageBox(window, {
			type: 'info',
			message: "Open a .tmixp show first",
			detail: "Merging updates a .tmixp show with the latest cues from a TheatreMix .tmix file."
		});
		return null;
	}

	const result = await dialog.showOpenDialog(window, {
		title: "Merge Cues from TheatreMix Show",
		properties: ['openFile'],
		filters: [{ name: 'TheatreMix Show', extensions: ['tmix'] }]
	});

	if (result.canceled || result.filePaths.length === 0) return null;

	const tmixPath = result.filePaths[0];

	let incoming;
	try {
		const db = new DatabaseConnection(tmixPath);
		try {
			incoming = new ShowRepository(db).load();
		} finally {
			db.close();
		}
	} catch (error) {
		console.warn("[showManager]: Failed to read show for merge", error);
		dialog.showErrorBox("Merge Failed", `Could not read ${path.basename(tmixPath)} as a TheatreMix show.\r\n${error.message}`);
		return null;
	}

	// Compare cue lists by cue number + point
	const cue_map = (show) => new Map(show.cues.map((cue) => [dca_level_key(cue.number, cue.point), cue]));
	const before = cue_map(currentShow);
	const after = cue_map(incoming);

	const added = [...after.keys()].filter((key) => !before.has(key));
	const removed = [...before.keys()].filter((key) => !after.has(key));
	const changed = [...after.keys()].filter((key) =>
		before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))
	);

	// Keep levels only for cues that still exist
	const kept_levels = {};
	const dropped_levels = [];
	for (const [key, dcas] of Object.entries(currentShow.dcaLevels)) {
		if (after.has(key)) {
			kept_levels[key] = dcas;
		} else {
			dropped_levels.push(key);
		}
	}

	const summary = [
		`${added.length} new cue${added.length === 1 ? "" : "s"}`,
		`${changed.length} changed`,
		`${removed.length} removed`,
	].join(", ");

	const detail = [
		`${summary}.`,
		"Actors, profiles and show settings will also be updated from the .tmix.",
		dropped_levels.length > 0
			? `DCA levels for removed cue${dropped_levels.length === 1 ? "" : "s"} ${dropped_levels.join(", ")} will be dropped.`
			: "All DCA levels will be kept.",
		"Nothing is written until you save."
	].join("\n\n");

	const { response } = await dialog.showMessageBox(window, {
		type: 'question',
		buttons: ['Merge', 'Cancel'],
		defaultId: 0,
		cancelId: 1,
		message: `Merge ${path.basename(tmixPath)} into ${path.basename(currentPath)}?`,
		detail
	});

	if (response !== 0) return null;

	incoming.dcaLevels = kept_levels;
	// StudioLive setup belongs to this app, not TheatreMix: keep it
	incoming.consoleSetup = currentShow.consoleSetup;
	currentShow = incoming;
	contentPath = tmixPath;
	// Level history refers to cues that may no longer exist
	clearHistory();
	setDirty(true);

	console.log(`[showManager]: Merged ${tmixPath}: ${summary}, dropped levels for ${dropped_levels.length} cue(s)`);

	return currentShow;
}

/**
 * If there are unsaved changes, ask the user what to do with them
 * @returns {Promise<boolean>} true if it's okay to continue (saved or discarded)
 */
async function confirmDiscardChanges() {
	if (!isShowDirty()) return true;

	const { response } = await dialog.showMessageBox(getMainWindow(), {
		type: 'warning',
		buttons: ['Save', "Don't Save", 'Cancel'],
		defaultId: 0,
		cancelId: 2,
		message: `Save changes to ${path.basename(currentPath)}?`,
		detail: "DCA levels you've set will be lost if you don't save them."
	});

	if (response === 2) return false;
	if (response === 0) return saveShow();

	return true;
}

export {
	showEvents,
	loadShow,
	closeShow,
	getShow,
	getShowPath,
	getShowState,
	isShowDirty,
	setDcaLevel,
	setConsoleSetup,
	undoDcaLevel,
	redoDcaLevel,
	saveShow,
	saveShowAs,
	mergeTmix,
	confirmDiscardChanges
};
