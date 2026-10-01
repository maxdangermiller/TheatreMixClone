const { app, dialog } = require('electron');

const open_dialog = (msg) => {
    app.whenReady().then(() => {
        // Arguments: showErrorBox(title, content)
        dialog.showErrorBox(
            'An Error Occurred', 
            msg
        );
    });

}

export default open_dialog;