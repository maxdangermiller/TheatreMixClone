import React, { useState, useEffect } from 'react';
import ReactDOM, { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from "react-router";

import ClientManager from './ClientManager';
import Editor from './Editor';
import MenuBar from './MenuBar';


const App = () => {
    const [showData, setShowData] = useState(null);

    const load_show = async (path) => {
        if (path === "") {
            console.error("[renderer::load_show]: File Path cannot be blank... silly goose!");
        }

        setShowData(await window.showApi.loadShow(path));
    }

    // Listeners for Electron
    useEffect(() => {
        // Listen for the 'file-opened' channel exposed by preload.js
        window.electronAPI.onOpenFile((filePath) => {
            load_show(filePath)
        });

        // Listen for the 'main-log' channel exposed by preload.js
        window.electronAPI.onMainLog((logMessage) => {
            console.log("[MAIN] --> ", logMessage)
        });
        // Cleanup listener on unmount
        return () => {
            window.electronAPI.removeOpenFileListener();
            window.electronAPI.removeMainLogListener();
        };
    }, []);

    useEffect(() => {
        console.log("[renderer.jsx] Show Data DEBUG Log: ", showData);
    }, [showData])

    return <>
        <MenuBar load_show={load_show}/>
        <Editor showData={showData} setShowData={setShowData}/>
    </>
}

export default App;