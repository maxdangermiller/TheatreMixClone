import { app, BrowserWindow, ipcMain, Menu, shell, powerSaveBlocker } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import {discover, connect, auto_connect, show_opened, disconnect, write_cue, fire_sound_check, reset_console_state, get_console_status, sync_channel_monitor} from './main/sound.js';
import {showEvents, loadShow, getShow, getShowState, saveShow, setDcaLevel, setConsoleSetup, undoDcaLevel, redoDcaLevel, isShowDirty, confirmDiscardChanges} from './main/showManager.js';
import {qlabEvents, syncQLab, recallQLabCue, getQLabStatus, stopQLab} from './main/qlab.js';
import {startOscServer, stopOscServer, notifyCueFired} from './main/oscServer.js';
import {syncConsoleButtons, setButtonActionHandler, buttonEvents, effectiveButtonMap, serializeButtonMap, getButtonSetup} from './main/consoleButtons.js';

import {handle_open_file} from './main/fileManager.js';
import {initMenu, sendViewSettings, sendMenuAction, setLockEditing} from './main/menuManager.js';
import {getSettings, updateSettings} from './main/settings.js';
import fs from 'node:fs';
// import {open_dialog} from './main/dialog.js';

import { getMainWindow, setMainWindow } from './main/windowManager.js';

const SHOW_CONSOLE = true;

/** Show file macOS asked us to open before the window was ready */
let pendingOpenFile = null;


console.log('[MAIN] main.js loaded');


// Subscribe all the functions
ipcMain.handle('presonus:discover', discover);
ipcMain.handle('presonus:connect', connect);
ipcMain.handle('presonus:disconnect', () => disconnect());
ipcMain.handle('presonus:get_status', async () => get_console_status());
// ipcMain.handle('presonus:set_dca', set_dca);
/**
 * Fire a cue: recall its QLab cue, tell OSC subscribers, then write it to the console.
 * QLab recall doesn't need a console, and is skipped on Back if the show says so
 * (TheatreMix: Show Setup → QLab → "Suppress QLab cue recall on back button").
 */
ipcMain.handle('presonus:write_cue', async (event, args) => {
	const {cue_object, back = false} = args;
	const config = getShow()?.config ?? {};

	if (config.qLabCues === "1" && cue_object.qLabCue && !(back && config.qLabSuppressBack === "1")) {
		recallQLabCue(cue_object.qLabCue);
	}

	notifyCueFired(cue_object);

	return write_cue(event, args);
});

ipcMain.handle('presonus:fire_sound_check', async (event, args) => {
	notifyCueFired(null);
	return fire_sound_check(event, args);
});

// Console Setup → StudioLive mute group buttons
ipcMain.handle('console-setup:get', async () => getButtonSetup(getShow()));
ipcMain.handle('console-setup:set_button_map', async (_, groupToAction) => {
	setConsoleSetup('muteButtonMap', serializeButtonMap(groupToAction));
	return getButtonSetup(getShow());
});

// Action → Test QLab Recall
ipcMain.handle('qlab:recall', async (_, cueNumber) => recallQLabCue(cueNumber));
ipcMain.handle('qlab:get_status', async () => getQLabStatus());

ipcMain.handle('show:load', async (_, path) => {
	// Returns null if the user canceled because of unsaved changes
	if (!(await confirmDiscardChanges())) { return null; }

	const show = loadShow(path);

	// New show: the next cue rewrites every DCA, and the editor starts on Line Checks
	// (which goes on the console now if it's connected)
	show_opened();

	return show;
});

ipcMain.handle('show:set_dca_level', async (_, {number, point, dca, level}) => {
	return setDcaLevel(number, point, dca, level);
});

ipcMain.handle('show:undo_dca_level', async () => { return undoDcaLevel(); });
ipcMain.handle('show:redo_dca_level', async () => { return redoDcaLevel(); });

ipcMain.handle('show:get', async () => { return getShow(); });

// Toolbar buttons go through the same paths as the menu
ipcMain.handle('menu:trigger', async (_, action) => { sendMenuAction(action); });
ipcMain.handle('app:set_lock_editing', async (_, locked) => { setLockEditing(locked); });
ipcMain.handle('show:save', async () => { return saveShow(); });
ipcMain.handle('show:can_save', async () => { return getShowState().canSave; });

// Console Setup preferences: DCA Recall and "Connect automatically"
const CONSOLE_PREFS = ['levelsFollowPeople', 'restoreOnBack', 'autoConnect'];
const consolePrefs = () => Object.fromEntries(CONSOLE_PREFS.map((key) => [key, getSettings()[key]]));
ipcMain.handle('app:get_recall_settings', async () => consolePrefs());
ipcMain.handle('app:set_recall_settings', async (_, changes) => {
	const allowed = {};
	for (const key of CONSOLE_PREFS) {
		if (typeof changes?.[key] === 'boolean') allowed[key] = changes[key];
	}
	updateSettings(allowed);
	return consolePrefs();
});

/** Auto-connect runs once, when the main window first loads */
let autoConnectStarted = false;

ipcMain.handle('app:get_view_settings', async () => {
	const {rowSize, lockEditing} = getSettings();
	return {rowSize, lockEditing};
});

ipcMain.handle('electronAPI:openFile', handle_open_file);
// ipcMain.handle('electronAPI:openErrorDialog', (_, msg) => open_dialog(msg));


if (started) {
  	app.quit();
}


const createWindow = () => {
	let mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		// Keeps the whole toolbar visible
		minWidth: 900,
		minHeight: 500,
		
		icon: path.join(__dirname, '../build/icons/icon1028.png'),

		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
		},
	});

	
	if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
		mainWindow.webContents.openDevTools();
	} else {
		mainWindow.loadFile(
			path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
		);
	}

	// Override console.log in Main process to forward logs
	const originalLog = console.log;
	console.log = (...args) => {
		originalLog(...args); // keep terminal output
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('main-log', args.join(' '));
		}
	};
	// Override console.warn in Main process to forward logs
	const originalWarn = console.warn;
	console.warn = (...args) => {
		originalWarn(...args); // keep terminal output
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('main-log', args.join(' '));
		}
	};
			/*
	const originalStdoutWrite = process.stdout.write;
	process.stdout.write = function (chunk, encoding, callback) {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send('main-log', args.join(' '));
		}
    	return originalStdoutWrite.apply(process.stdout, arguments);
	};
	*/

	// Intercept window.open calls from the React frontend
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		console.log("Trying to open popup")

		// You can filter by URL if you only want to allow specific popups
		if (url.includes('/popup')) {
			console.log("opening popup")
			return {
				action: 'allow',
				overrideBrowserWindowOptions: {
					width: 800,
					// Tall enough for the console list and the mute group buttons
					height: 760,
					resizable: false,
					minimizable: false,
					maximizable: false,
					frame: false, // Set to false for a frameless popup
					parent: mainWindow,
					webPreferences: {
						// Inherit or inject custom preloads if necessary
						preload: path.join(__dirname, 'preload.cjs'), 
						contextIsolation: true
					}
				}
			};
		}
		
		// Deny external/unknown popups, or route them to the default browser
		return { action: 'deny' };
	});

	// On Load, open the most recent file if it exists
	mainWindow.webContents.on('did-finish-load', () => {
		// Connect to the last console if it's there (Console Setup → Connect automatically)
		if (!autoConnectStarted) {
			autoConnectStarted = true;
			auto_connect(mainWindow.webContents);
		}

		// A file double-clicked in Finder before the app was ready wins over the recent list
		if (pendingOpenFile !== null) {
			mainWindow.webContents.send('file-opened', pendingOpenFile);
			pendingOpenFile = null;
			return;
		}

		sendViewSettings();

		// Reopen the most recent show, if it's still there
		const recent = getSettings().recentFiles[0];

		if (recent && fs.existsSync(recent)) {
			mainWindow.webContents.send('file-opened', recent);
		}
	});

	mainWindow.on('close', async (event) => {
		if (isShowDirty()) {
			// Hold the close until the user decides what to do with unsaved changes
			event.preventDefault();

			if (!(await confirmDiscardChanges())) { return; }

			mainWindow.destroy();
		}

		app.quit()
	})

	setMainWindow(mainWindow);
};

app.whenReady().then(() => {
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	app.quit();
});

// Drop the console connection so it doesn't hold a stale client slot
app.on('before-quit', () => {
	disconnect();
	stopQLab();
	stopOscServer();
});


// Setup Menu Bar
app.whenReady().then(() => {
	initMenu();

	// QLab and the console's mute group buttons follow the open show's settings.
	// ('changed' also fires on every level edit, so only re-sync buttons when the map changes.)
	let lastButtonMap;
	showEvents.on('changed', () => {
		getMainWindow()?.webContents.send('show-can-save', getShowState().canSave);
		syncQLab(getShow());
		sync_channel_monitor();

		const {map, source} = effectiveButtonMap(getShow());
		const buttonMap = getShow() ? `${source}:${map}` : null;
		if (buttonMap !== lastButtonMap) {
			lastButtonMap = buttonMap;
			syncConsoleButtons(getShow());
		}
	});

	// Console Go / Back buttons run like OSC commands (still work with a popup open)
	setButtonActionHandler((action) => sendMenuAction({action, remote: true}));

	// Console Setup shows button presses live, and refreshes when mute groups change
	const broadcast = (channel, value) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(channel, value);
		}
	};
	buttonEvents.on('activity', (activity) => broadcast('console-buttons-activity', activity));
	buttonEvents.on('changed', () => broadcast('console-buttons-changed'));
	qlabEvents.on('status', (status) => getMainWindow()?.webContents.send('qlab-status', status));

	// TheatreMix-compatible OSC API (QLab network cues, Stream Deck...)
	startOscServer();

	// Stop macOS App Nap from throttling the app while it's in the background:
	// throttled timers made the console and QLab heartbeats time out and drop
	// the connections. This also stops the computer idle-sleeping while the app
	// is open (the display can still turn off), which a show machine wants anyway.
	powerSaveBlocker.start('prevent-app-suspension');
});

// MAC-OS Default File Handling
app.on('open-file', (event, filePath) => {
	event.preventDefault(); // Prevent default OS behavior
	
	app.addRecentDocument(filePath);

	const mainWindow = getMainWindow();

	// Launched by double-clicking a show: the window isn't loaded yet, so open it once it is
	if (!app.isReady() || !mainWindow || mainWindow.webContents.isLoading()) {
		pendingOpenFile = filePath;
		return;
	}

	console.log("MacOS tried to load " + filePath + ", sending it to the frontend!");
	mainWindow.webContents.send('file-opened', filePath);
});