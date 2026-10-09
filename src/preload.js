// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('presonus', {
  	discover: (timeout) => 
		ipcRenderer.invoke('presonus:discover', {timeout}),

  	onDeviceFound: (callback) =>
		ipcRenderer.on('presonus:device-found', (_event, device) => callback(device)),
	removeDeviceFoundListener: () =>
		ipcRenderer.removeAllListeners('presonus:device-found'),

	// name: console name from discovery, shown in the status tooltip
  	connect: (host, port, name) =>
	  	ipcRenderer.invoke('presonus:connect', { host, port, name }),

	// {state: 'disconnected' | 'connecting' | 'connected', host?, name?, message?}
	getStatus: () =>
		ipcRenderer.invoke('presonus:get_status'),
	onStatus: (callback) => {
		const listener = (_event, status) => callback(status);
		ipcRenderer.on('console-status', listener);
		return () => ipcRenderer.removeListener('console-status', listener);
	},

  	disconnect: () =>
	  	ipcRenderer.invoke('presonus:disconnect'),

  	set_dca: (dca) =>
	  	ipcRenderer.invoke('presonus:set_dca', { dca }),

	// back: fired by the Back button (QLab recall may be suppressed)
  	write_cue: (cue_object, {back = false} = {}) =>
	  	ipcRenderer.invoke('presonus:write_cue', {cue_object, back}),

  	fire_sound_check: () =>
	  	ipcRenderer.invoke('presonus:fire_sound_check', {}),
});

contextBridge.exposeInMainWorld('showApi', {
	loadShow: path =>
		ipcRenderer.invoke('show:load', path),

	getShow: () =>
		ipcRenderer.invoke('show:get'),

	// Main replaced the show (e.g. after merging a .tmix)
	onShowUpdated: (callback) =>
		ipcRenderer.on('show-updated', (_event, show) => callback(show)),
	removeShowUpdatedListener: () =>
		ipcRenderer.removeAllListeners('show-updated'),

	// level in dB, or null to go back to the default
	setDcaLevel: (number, point, dca, level) =>
		ipcRenderer.invoke('show:set_dca_level', {number, point, dca, level}),

	// File → Save Show; returns true if saved
	save: () =>
		ipcRenderer.invoke('show:save'),

	// Return the updated level map, or null if there was nothing to undo / redo
	undoDcaLevel: () =>
		ipcRenderer.invoke('show:undo_dca_level'),
	redoDcaLevel: () =>
		ipcRenderer.invoke('show:redo_dca_level'),
});

/**
 * Subscribe to an IPC channel, returning a function that removes just this listener
 * @param {String} channel 
 * @param {Function} callback 
 */
const subscribe = (channel, callback) => {
	const listener = (_event, value) => callback(value);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('consoleSetupApi', {
	// {hasShow, connected, source, map: {group: action}, actions, groups}
	get: () => ipcRenderer.invoke('console-setup:get'),

	// groupToAction: {muteGroup: actionId}; saved in the show (mark unsaved)
	setButtonMap: (groupToAction) => ipcRenderer.invoke('console-setup:set_button_map', groupToAction),

	// {group, on, action, fired} whenever a mute group changes on the console
	onButtonActivity: (callback) => subscribe('console-buttons-activity', callback),

	// Mute group names / channels or the show's map changed
	onChanged: (callback) => subscribe('console-buttons-changed', callback),
});

contextBridge.exposeInMainWorld('qlabApi', {
	// Start a QLab cue now (Test QLab Recall); returns {ok, error?}
	recall: (cueNumber) => ipcRenderer.invoke('qlab:recall', cueNumber),

	// {state: 'off' | 'connecting' | 'connected', workspace?, message?}
	getStatus: () => ipcRenderer.invoke('qlab:get_status'),
	onStatus: (callback) => subscribe('qlab-status', callback),
});

contextBridge.exposeInMainWorld('menuApi', {
	// Menu commands handled in the renderer: go, back, jump, jump-selected, undo, redo, console-setup
	onMenuAction: (callback) => subscribe('menu-action', callback),

	// Run a menu command (used by the toolbar): go, back, undo, redo...
	trigger: (action) => ipcRenderer.invoke('menu:trigger', action),

	// {rowSize: 'small' | 'medium' | 'large', lockEditing: boolean}
	getViewSettings: () => ipcRenderer.invoke('app:get_view_settings'),
	setLockEditing: (locked) => ipcRenderer.invoke('app:set_lock_editing', locked),
	onViewSettings: (callback) => subscribe('view-settings', callback),
});

contextBridge.exposeInMainWorld('electronAPI', {
	openFile: () => ipcRenderer.invoke('electronAPI:openFile'),

  	onOpenFile: (callback) => ipcRenderer.on('file-opened', (event, filePath) => callback(filePath)),
	removeOpenFileListener: () => ipcRenderer.removeAllListeners('file-opened'),
	
	openErrorDialog: msg => ipcRenderer.invoke('presonus:openErrorDialog', msg),

	onMainLog: (callback) => ipcRenderer.on('main-log', (_event, value) => callback(value)),
	removeMainLogListener: () => ipcRenderer.removeAllListeners('main-log'),


});