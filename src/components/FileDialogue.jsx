import React, { useState } from 'react';

/**
 * @typedef {Object} FileDialogueProps
 * @property {function} load_show - function that loads the show
 */


/**
 * 
 * @param {FileDialogueProps} props 
 * @returns 
 */
const FileDialogue = ({load_show}) => {

  const handleOpenFile = async () => {
    // Access the API exposed by the preload script
    const path = await window.electronAPI.openFile();

    if (path) {
      load_show(path);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <button onClick={handleOpenFile}>Open File</button>
    </div>
  );
}

export default FileDialogue;