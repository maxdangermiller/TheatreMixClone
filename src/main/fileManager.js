const { app, ipcMain, dialog } = require('electron');

import { loadShow } from './showManager';

const handle_open_file = async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['.tmix', '.db'] }]
  });
  
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths[0];
  }
}

export {
    handle_open_file
};
