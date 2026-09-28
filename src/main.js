import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

import {discover, connect, write_cue} from './main/sound.js';
import {loadShow, getShow} from './main/showManager.js';

import {handle_open_file} from './main/fileManager.js';
import {MenuTemplate} from './main/menuManager.js';

import { getMainWindow, setMainWindow } from './main/windowManager.js';

const SHOW_CONSOLE = true;


console.log('[MAIN] main.js loaded');


// Subscribe all the functions
ipcMain.handle('presonus:discover', discover);
ipcMain.handle('presonus:connect', connect);
// ipcMain.handle('presonus:set_dca', set_dca);
ipcMain.handle('presonus:write_cue', write_cue);

ipcMain.handle('show:load', async (_, path) => { return loadShow(path); });

ipcMain.handle('show:get', async () => { return getShow(); });

ipcMain.handle('dialog:openFile', handle_open_file);



if (started) {
  	app.quit();
}


const createWindow = () => {
	let mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		
		icon: path.join(__dirname, '../build/icons/icon1028.png'),

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

	if (SHOW_CONSOLE) {
		mainWindow.webContents.openDevTools();
	}

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
	if (process.platform !== 'darwin') {
		app.quit();
	}
});


// Setup Menu Bar
app.whenReady().then(() => {
	Menu.setApplicationMenu(MenuTemplate);
});

// MAC-OS Default File Handling
app.on('open-file', (event, filePath) => {
	event.preventDefault(); // Prevent default OS behavior
	
	if (app.isReady()) {
		// loadTargetFile(filePath);
		console.log("MacOS tried to load " + filePath + ", sending it to the frontend!")
		getMainWindow().webContents.send('file-opened', filePath);
		
	} else {
		// If the app isn't fully launched yet, store it or wait
		app.once('ready', () => {
			getMainWindow().webContents.send('file-opened', filePath);
		});
	}
});