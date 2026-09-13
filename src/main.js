import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import DatabaseConnection from './database/DatabaseConnection';
import ShowRepository from './repositories/ShowRepository';

import {discover, connect, write_cue} from './main/sound.js';
import {loadShow, getShow} from './main/showManager.js';

import {handle_open_file} from './main/fileManager.js';

console.log('[MAIN] main.js loaded');

/*
let db = new DatabaseConnection("/Users/maxmiller/Desktop/Programming/TheatreMixClone/LionKingKidsV2.db")
let show_rep = new ShowRepository(db);

let show = show_rep.load();

console.log(show.profiles)
*/


// Subscribe all the functions
ipcMain.handle('presonus:discover', discover);
ipcMain.handle('presonus:connect', connect);
// ipcMain.handle('presonus:set_dca', set_dca);
ipcMain.handle('presonus:write_cue', write_cue);

ipcMain.handle('show:load', async (_, path) => {
    return loadShow(path);
});

ipcMain.handle('show:get', async () => {
    return getShow();
});

ipcMain.handle('dialog:openFile', handle_open_file);



if (started) {
  app.quit();
}


const createWindow = () => {
  console.log(path.join(__dirname, '../../build/icons/icon_512x512.png'),);
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../../build/icons/icon_512x512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.webContents.openDevTools();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});