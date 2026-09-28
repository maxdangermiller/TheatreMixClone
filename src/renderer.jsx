import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ClientManager from './components/ClientManager';
import Editor from './components/Editor';
import MenuBar from './components/MenuBar';


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

		// Cleanup listener on unmount
		return () => {
			window.electronAPI.removeOpenFileListener();
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

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App/>);