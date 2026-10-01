import React, { useRef } from "react";

// https://www.svgrepo.com/collection/zest-interface-icons/
import FileIcon from "../../assets/file.svg?react";
import OpenFileIcon from "../../assets/open_file.svg?react";
import EditIcon from "../../assets/edit.svg?react";

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
    const popupRef = useRef(null);


    const handleNewFile = async () => {
        
    }

    const handleOpenFile = async () => {
        // Access the API exposed by the preload script
        const path = await window.electronAPI.openFile();

        if (path) {
        load_show(path);
        }
    };

    const handleOpenSettings = () => {
        // Prevent duplicate windows if already open
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.focus();
            return;
        }

        // Open the new window via a targeted path matching your React routing
        popupRef.current = window.open(
            '#/popup', 
            'PopupModal', 
            'width=600,height=800' // Merged into overrideBrowserWindowOptions by Electron
        );
    }

    return (
        <div style={menu_bar_style}>
            <button onClick={handleNewFile} aria-label="new-file" style={svg_button_style}>
                <FileIcon style={menu_icon_style}/>
            </button>
            <button onClick={handleOpenFile} aria-label="open-file" style={svg_button_style}>
                <OpenFileIcon style={menu_icon_style}/>
            </button>
            <button onClick={handleOpenSettings} aria-label="settings" style={svg_button_style}>
                <EditIcon style={menu_icon_style}/>
            </button>
        </div>
    );
}

export default MenuBar;