// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('presonus', {
  discover: () => ipcRenderer.invoke('presonus:discover'),

  connect: (host, port) =>
        ipcRenderer.invoke('presonus:connect', { host, port }),
  set_dca: (dca) =>
        ipcRenderer.invoke('presonus:set_dca', { dca }),
});