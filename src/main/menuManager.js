import { app, Menu, shell, dialog } from 'electron';
import { getMainWindow, setMainWindow } from './windowManager.js';
import { handle_open_file } from './fileManager.js';


const handle_new_show = async () => {
	
}
const handle_open_show = async () => {
	const filePath  = await handle_open_file();
	getMainWindow().webContents.send('file-opened', filePath);
}
const handle_close_show = async () => {

}
const handle_save_show = async () => {

}
const handle_save_show_as = async () => {

}
const handle_export_notes = async () => {

}
const handle_show_setup = async () => {

}
const handle_ensemble_setup = async () => {

}
const handle_pos_setup = async () => {

}
const handle_actor_setup = async () => {

}
const handle_console_setup = async () => {

}



const isMac = process.platform === 'darwin'
const template = [
	// { role: 'appMenu' }
	...(isMac
		? [{
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
		}]
		: []),
	// { role: 'fileMenu' }
	{
		label: 'File',
		submenu: [
			{ 
				label: 'New Show',
				accelerator: 'CmdOrCtrl+N',
				click: handle_new_show
			},
			{ 
				label: 'Open Show',
				accelerator: 'CmdOrCtrl+O',
				click: handle_open_show
			},
			{
				label: 'Open Recent',
				role: 'recentdocuments', // Native OS hook for the recent documents menu
				submenu: [
					{
						label: 'Clear Recent',
						role: 'clearrecentdocuments' // Native OS hook to clear the list
					}
				]
			},
			{ 
				label: 'Close Show',
				accelerator: 'CmdOrCtrl+W',
				click: handle_close_show
			},

			{ type: 'separator' },

			{ 
				label: 'Save Show',
				accelerator: 'CmdOrCtrl+S',
				click: handle_save_show
			},
			{ 
				label: 'Save As',
				accelerator: 'CmdOrCtrl+Shift+S',
				click: handle_save_show_as
			},
			{ 
				label: 'Export Notes',
				click: handle_export_notes
			},

			{ type: 'separator' },

			{ 
				label: 'Show Setup',
				click: handle_show_setup
			},
			{ 
				label: 'Ensemble Setup',
				click: handle_ensemble_setup
			},
			{ 
				label: 'Position Setup',
				click: handle_pos_setup
			},
			{ 
				label: 'Actor Setup',
				click: handle_actor_setup
			},

			{ type: 'separator' },

			{ 
				label: 'Console Setup',
				click: handle_console_setup
			},
		]
	},
	// { role: 'editMenu' }
	{
		label: 'Edit',
		submenu: [
		{ role: 'undo' },
		{ role: 'redo' },
		{ type: 'separator' },
		{ role: 'cut' },
		{ role: 'copy' },
		{ role: 'paste' },
		...(isMac
			? [
				{ role: 'pasteAndMatchStyle' },
				{ role: 'delete' },
				{ role: 'selectAll' },
				{ type: 'separator' },
				{
				label: 'Speech',
				submenu: [
					{ role: 'startSpeaking' },
					{ role: 'stopSpeaking' }
				]
				}
			]
			: [
				{ role: 'delete' },
				{ type: 'separator' },
				{ role: 'selectAll' }
			])
		]
	},
	// { role: 'viewMenu' }
	{
		label: 'View',
		submenu: [
		{ role: 'reload' },
		{ role: 'forceReload' },
		{ role: 'toggleDevTools' },
		{ type: 'separator' },
		{ role: 'resetZoom' },
		{ role: 'zoomIn' },
		{ role: 'zoomOut' },
		{ type: 'separator' },
		{ role: 'togglefullscreen' }
		]
	},
	// { role: 'windowMenu' }
	{
		label: 'Window',
		submenu: [
		{ role: 'minimize' },
		{ role: 'zoom' },
		...(isMac
			? [
				{ type: 'separator' },
				{ role: 'front' },
				{ type: 'separator' },
				{ role: 'window' }
			]
			: [
				{ role: 'close' }
			])
		]
	},
	{
		role: 'help',
		submenu: [
		{
			label: 'Learn More',
			click: async () => {
			const { shell } = require('electron')
			await shell.openExternal('https://maxdangermiller.com')
			}
		}
		]
	}
]

const MenuTemplate = Menu.buildFromTemplate(template)
	
export {MenuTemplate}