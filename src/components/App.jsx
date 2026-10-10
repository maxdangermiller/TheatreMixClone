import React, { useState, useEffect } from 'react';
import ReactDOM, { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from "react-router";

import ClientManager from './ClientManager';
import Editor from './Editor';
import MenuBar from './MenuBar';


const APP_STYLE = {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
};

const App = () => {
    const [showData, setShowData] = useState(null);

    const load_show = async (path) => {
        if (path === "") {
            console.error("[renderer::load_show]: File Path cannot be blank... silly goose!");
        }

        const show = await window.showApi.loadShow(path);

        // null when the user canceled to keep unsaved changes
        if (show !== null) {
            setShowData(show);
        }
    }

    // Listeners for Electron
    useEffect(() => {
        // Listen for the 'file-opened' channel exposed by preload.js
        window.electronAPI.onOpenFile((filePath) => {
            load_show(filePath)
        });

        // Main replaced the show (e.g. merged in a .tmix)
        window.showApi.onShowUpdated((show) => {
            setShowData(show);
        });

        // Listen for the 'main-log' channel exposed by preload.js
        window.electronAPI.onMainLog((logMessage) => {
            console.log("[MAIN] --> ", logMessage)
        });
        // Cleanup listener on unmount
        return () => {
            window.electronAPI.removeOpenFileListener();
            window.electronAPI.removeMainLogListener();
            window.showApi.removeShowUpdatedListener();
        };
    }, []);

    useEffect(() => {
        console.log("[renderer.jsx] Show Data DEBUG Log: ", showData);
    }, [showData])

    // Toolbar on top, cue list fills the rest of the window
    return <div style={APP_STYLE}>
        <MenuBar load_show={load_show} hasShow={showData !== null}/>
        <Editor showData={showData} setShowData={setShowData}/>
    </div>
}

export default App;