import { app, ipcMain, dialog } from 'electron';

import { loadShow } from './showManager';

const handle_open_file = async () => {
	const result = await dialog.showOpenDialog({
		properties: ['openFile'],
		filters: [{ name: 'TheatreMix Files', extensions: ['tmix', 'tmixp', 'db'] }]
	});
	
	if (result.canceled) {
		return null;
	} else {
		app.addRecentDocument(result.filePaths[0]);
		return result.filePaths[0];
	}
}

export {
	handle_open_file
};
