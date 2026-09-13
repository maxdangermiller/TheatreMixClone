import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ClientManager from './components/ClientManager';
import Editor from './components/Editor';

const App = () => {
	const [showData, setShowData] = useState(null);

	useEffect(() => {
		console.log("[renderer.jsx] Show Data DEBUG Log: ", showData);
	}, [showData])

	return <div>
		<ClientManager showData={showData} setShowData={setShowData}/>
		<br />
		<Editor showData={showData} setShowData={setShowData}/>
	</div>
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App/>);