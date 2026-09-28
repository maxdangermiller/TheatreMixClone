import React from "react";

// https://www.svgrepo.com/collection/zest-interface-icons/
import FileIcon from "../../assets/file.svg?react";
import OpenFileIcon from "../../assets/open_file.svg?react";

const menu_bar_style = {
    backgroundColor: "#444444",
    height: "35px",
    padding: "5px",
    display: "flex",
    justifyContent: "start",
    allignItems: "center"
};

const menu_icon_style = {
    height: "28px", 
    width: "28px", 
    color: "white",
    paddingRight: "12px"
}

const svg_button_style = {
    background: 'none', 
    border: 'none', 
    cursor: 'pointer'
}

/**
 * @typedef {Object} MenuBarProps
 * @property {Function} load_show - function that loads the show
 */

/**
 * 
 * @param {MenuBarProps} params 
 */
const MenuBar = ({load_show}) => {

    const handleOpenFile = async () => {
        // Access the API exposed by the preload script
        const path = await window.electronAPI.openFile();

        if (path) {
        load_show(path);
        }
    };

    return (
        <div style={menu_bar_style}>
            <button onClick={handleOpenFile} aria-label="new-file" style={svg_button_style}>
                <FileIcon style={menu_icon_style}/>
            </button>
            <button onClick={handleOpenFile} aria-label="new-file" style={svg_button_style}>
                <OpenFileIcon style={menu_icon_style}/>
            </button>
        </div>
    );
}

export default MenuBar;