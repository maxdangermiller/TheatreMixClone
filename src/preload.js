// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('presonus', {
  	discover: () => 
		ipcRenderer.invoke('presonus:discover'),

  	connect: (host, port) =>
	  	ipcRenderer.invoke('presonus:connect', { host, port }),

  	set_dca: (dca) =>
	  	ipcRenderer.invoke('presonus:set_dca', { dca }),

  	write_cue: (cue_object) =>
	  	ipcRenderer.invoke('presonus:write_cue', {cue_object}),

  	fire_sound_check: () =>
	  	ipcRenderer.invoke('presonus:fire_sound_check', {}),
});

contextBridge.exposeInMainWorld('showApi', {
	loadShow: path =>
		ipcRenderer.invoke('show:load', path),

	getShow: () =>
		ipcRenderer.invoke('show:get')
});

contextBridge.exposeInMainWorld('electronAPI', {
	openFile: () => ipcRenderer.invoke('electronAPI:openFile'),

  	onOpenFile: (callback) => ipcRenderer.on('file-opened', (event, filePath) => callback(filePath)),
	removeOpenFileListener: () => ipcRenderer.removeAllListeners('file-opened'),
	
	openErrorDialog: 
		msg => ipcRenderer.invoke('presonus:openErrorDialog', msg),


});