// main/menuManager.js
// Application menu, laid out to match TheatreMix (File / Edit / View / Action / Help).
// Items for features this app doesn't have yet are shown disabled, the same way
// TheatreMix greys out items that aren't available.

import { app, Menu, shell, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { getMainWindow } from './windowManager.js';
import { handle_open_file } from './fileManager.js';
import {
	showEvents, getShowState, closeShow,
	saveShow, saveShowAs, mergeTmix
} from './showManager.js';
import { getSettings, updateSettings, removeRecentFile } from './settings.js';
import { getConsoleButtonReport, getLogAllConsoleMessages, setLogAllConsoleMessages } from './consoleButtons.js';
import { getDebugLogPath } from './debugLog.js';

const isMac = process.platform === 'darwin';

const README_URL = 'https://github.com/MaxMessWithTech/TheatreMixClone#readme';

/**
 * Send a menu command to the renderer (cue list actions live there)
 * @param {String} action
 */
const sendMenuAction = (action) => {
	const window = getMainWindow();
	if (window && !window.isDestroyed()) {
		window.webContents.send('menu-action', action);
	}
}

/**
 * Tell the renderer about view preferences (row size, editing lock)
 */
const sendViewSettings = () => {
	const window = getMainWindow();
	if (window && !window.isDestroyed()) {
		const {rowSize, lockEditing} = getSettings();
		window.webContents.send('view-settings', {rowSize, lockEditing});
	}
}

const openShowFile = (filePath) => {
	getMainWindow()?.webContents.send('file-opened', filePath);
}

// #region File handlers

const handle_open_show = async () => {
	const filePath = await handle_open_file();
	if (filePath) {
		openShowFile(filePath);
	}
}

const handle_open_recent = async (filePath) => {
	if (!fs.existsSync(filePath)) {
		await dialog.showMessageBox(getMainWindow(), {
			type: 'warning',
			message: `${path.basename(filePath)} can't be found`,
			detail: `It may have been moved or deleted.\n\n${filePath}`
		});
		removeRecentFile(filePath);
		updateMenu();
		return;
	}

	openShowFile(filePath);
}

const handle_close_show = async () => {
	if (await closeShow()) {
		getMainWindow()?.webContents.send('show-updated', null);
	}
}

const handle_merge_tmix = async () => {
	const show = await mergeTmix();
	if (show !== null) {
		getMainWindow()?.webContents.send('show-updated', show);
	}
}

// #endregion

// #region Help handlers

/**
 * Help → Console Buttons...: what's mapped, whether the mute groups are safe to use,
 * and what presses have been seen
 */
const handle_console_buttons = async () => {
	const { response } = await dialog.showMessageBox(getMainWindow(), {
		type: 'info',
		message: "Console Buttons",
		detail: getConsoleButtonReport(),
		buttons: ['OK', 'Show Debug Log'],
		defaultId: 0,
	});

	if (response === 1) handle_show_debug_log();
}

const handle_show_debug_log = () => {
	const logPath = getDebugLogPath();

	if (fs.existsSync(logPath)) {
		shell.showItemInFolder(logPath);
	} else {
		dialog.showMessageBox(getMainWindow(), {
			type: 'info',
			message: "Nothing has been logged yet",
			detail: `The debug log will be created at:\n${logPath}`
		});
	}
}

// #endregion

// #region View handlers

const handle_lock_editing = (menuItem) => {
	setLockEditing(menuItem.checked);
}

const handle_row_size = (rowSize) => {
	updateSettings({rowSize});
	sendViewSettings();
}

// #endregion

/**
 * Build the menu template for the current app state
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
const buildTemplate = () => {
	const {hasShow, isTmixp, qLabEnabled} = getShowState();
	const {recentFiles, rowSize, lockEditing} = getSettings();

	// Feature not in this app yet
	const notImplemented = {enabled: false};

	return [
		// macOS app menu (TheatreMix's About / Quit live here on Mac)
		...(isMac ? [{
			label: app.name,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}] : []),

		{
			label: '&File',
			submenu: [
				{ label: 'New Show', accelerator: 'CmdOrCtrl+N', ...notImplemented },
				{ label: 'Open Show...', accelerator: 'CmdOrCtrl+O', click: handle_open_show },
				{
					label: 'Open Recent',
					enabled: recentFiles.length > 0,
					submenu: recentFiles.length > 0
						? recentFiles.map((filePath, index) => ({
							label: path.basename(filePath),
							accelerator: `CmdOrCtrl+${index + 1}`,
							click: () => handle_open_recent(filePath)
						}))
						: [{ label: 'No Recent Shows', enabled: false }]
				},
				{ label: 'Close Show', accelerator: 'CmdOrCtrl+W', enabled: hasShow, click: handle_close_show },
				{ type: 'separator' },
				{ label: 'Save Show', accelerator: 'CmdOrCtrl+S', enabled: hasShow, click: () => saveShow() },
				{ label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', enabled: hasShow, click: () => saveShowAs() },
				{ label: 'Export Notes...', ...notImplemented },
				{ label: 'Merge Cues from .tmix...', enabled: isTmixp, click: handle_merge_tmix },
				{ type: 'separator' },
				{ label: 'Show Setup', ...notImplemented },
				{ label: 'Ensemble Setup', ...notImplemented },
				{ label: 'Position Setup', ...notImplemented },
				{ label: 'Actor Setup', ...notImplemented },
				{ type: 'separator' },
				// Unlike TheatreMix this works without a show, so a console can be tested on its own
				{ label: 'Console Setup', accelerator: 'CmdOrCtrl+K', click: () => sendMenuAction('console-setup') },
				...(isMac ? [] : [
					{ type: 'separator' },
					{ label: 'E&xit', accelerator: 'Ctrl+Q', role: 'quit' }
				]),
			]
		},

		{
			label: '&Edit',
			submenu: [
				// Cut / Copy / Paste act on text fields (cue editing isn't supported yet)
				{ label: 'Cut', role: 'cut' },
				{ label: 'Copy', role: 'copy' },
				{ label: 'Paste', role: 'paste' },
				{ label: 'Paste Merge', accelerator: 'CmdOrCtrl+Shift+V', ...notImplemented },
				{ label: 'Paste Swap', accelerator: 'CmdOrCtrl+Alt+V', ...notImplemented },
				{ label: 'Fill Down', accelerator: 'CmdOrCtrl+D', ...notImplemented },
				{ type: 'separator' },
				// Undo text edits when typing, otherwise DCA level edits (handled in the renderer)
				{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
				{ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuAction('redo') },
				{ type: 'separator' },
				{ label: 'Insert Cue', accelerator: 'CmdOrCtrl+M', ...notImplemented },
				{ label: 'Clone Cue', accelerator: 'CmdOrCtrl+Alt+C', ...notImplemented },
				{ label: 'Clone Cue to end', accelerator: 'CmdOrCtrl+Alt+Shift+C', ...notImplemented },
				// TheatreMix uses ⌘⌫ / ⌫ here; not registered so they keep working in text fields
				{ label: 'Delete Cue', ...notImplemented },
				{ type: 'separator' },
				{ label: 'Skip Cue', accelerator: 'CmdOrCtrl+Alt+K', ...notImplemented },
				{ label: 'Renumber Cues...', ...notImplemented },
				{ type: 'separator' },
				{ label: 'Assign...', accelerator: 'CmdOrCtrl+E', ...notImplemented },
				{ label: 'Clear Assignment', ...notImplemented },
			]
		},

		{
			label: '&View',
			submenu: [
				{ label: 'Lock Editing', type: 'checkbox', accelerator: 'CmdOrCtrl+L', checked: lockEditing, enabled: hasShow, click: handle_lock_editing },
				{ type: 'separator' },
				{ label: 'FX', accelerator: 'CmdOrCtrl+F', ...notImplemented },
				{ label: 'Positions', accelerator: 'CmdOrCtrl+T', ...notImplemented },
				{
					label: 'Row Size',
					submenu: ['small', 'medium', 'large'].map((size) => ({
						label: size[0].toUpperCase() + size.slice(1),
						type: 'radio',
						checked: rowSize === size,
						enabled: hasShow,
						click: () => handle_row_size(size)
					}))
				},
				{ type: 'separator' },
				{ label: 'Channel Utilisation', accelerator: 'CmdOrCtrl+U', ...notImplemented },
				{ label: 'Active Cue Info', accelerator: 'CmdOrCtrl+I', ...notImplemented },

				// Developer tools while running from source
				...(app.isPackaged ? [] : [
					{ type: 'separator' },
					{
						label: 'Developer',
						submenu: [
							{ role: 'reload', accelerator: '' },
							{ role: 'forceReload', accelerator: '' },
							{ role: 'toggleDevTools' },
						]
					}
				]),
			]
		},

		{
			label: '&Action',
			submenu: [
				{ label: 'Go', accelerator: 'CmdOrCtrl+G', enabled: hasShow, click: () => sendMenuAction('go') },
				{ label: 'Back', accelerator: 'CmdOrCtrl+B', enabled: hasShow, click: () => sendMenuAction('back') },
				{ label: 'Jump...', accelerator: 'CmdOrCtrl+J', enabled: hasShow, click: () => sendMenuAction('jump') },
				{ label: 'Jump to Selected Cue', accelerator: 'CmdOrCtrl+Alt+J', enabled: hasShow, click: () => sendMenuAction('jump-selected') },
				{ type: 'separator' },
				{ label: 'Mark Selected Cue...', accelerator: 'CmdOrCtrl+R', ...notImplemented },
				{ label: 'Mark Current Cue...', accelerator: 'CmdOrCtrl+Shift+R', ...notImplemented },
				{ type: 'separator' },
				// Starts the selected cue's QLab cue without firing the cue (works without a console)
				{ label: 'Test QLab Recall', accelerator: 'CmdOrCtrl+Alt+T', enabled: hasShow && qLabEnabled, click: () => sendMenuAction('test-qlab') },
			]
		},

		{
			label: '&Help',
			role: 'help',
			submenu: [
				{ label: 'Quick Start', click: () => shell.openExternal(README_URL) },
				{ label: 'Feature Guide', ...notImplemented },
				{ type: 'separator' },
				// Troubleshooting the console's Go / Back buttons
				{ label: 'Console Buttons...', click: handle_console_buttons },
				{
					label: 'Log All Console Messages',
					type: 'checkbox',
					checked: getLogAllConsoleMessages(),
					click: (menuItem) => setLogAllConsoleMessages(menuItem.checked)
				},
				{ label: 'Show Debug Log', click: handle_show_debug_log },
				...(isMac ? [] : [
					{ type: 'separator' },
					{ role: 'about' },
				]),
				{ type: 'separator' },
				{ label: 'Learn More', click: () => shell.openExternal('https://maxdangermiller.com') },
			]
		},
	];
}

/**
 * Rebuild the menu (enabled states, recent shows, checkmarks)
 */
const updateMenu = () => {
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

/**
 * Build the menu and keep it in sync with the show
 */
const initMenu = () => {
	updateMenu();
	showEvents.on('changed', updateMenu);
}

/**
 * Toggle View → Lock Editing (from the menu or the toolbar)
 * @param {boolean} locked 
 */
const setLockEditing = (locked) => {
	updateSettings({lockEditing: !!locked});
	sendViewSettings();
	updateMenu();
}

export { initMenu, updateMenu, sendViewSettings, sendMenuAction, setLockEditing };
