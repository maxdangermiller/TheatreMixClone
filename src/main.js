import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import DatabaseConnection from './database/DatabaseConnection';
import ShowRepository from './repositories/ShowRepository';

import './sound.js'

console.log('[MAIN] main.js loaded');

let db = new DatabaseConnection("/Users/maxmiller/Desktop/Programming/TheatreMixClone/LionKingKidsV2.db")
let show_rep = new ShowRepository(db);

let show = show_rep.load();

console.log(show.cues)

if (started) {
  app.quit();
}


const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
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