// windowManager.js
let mainWindow = null;

function setMainWindow(window) {
  mainWindow = window;
}

function getMainWindow() {
  return mainWindow;
}

export {
  setMainWindow,
  getMainWindow,
};