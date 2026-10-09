import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter as Router, Routes, Route } from "react-router";

import './index.css';

import App from './components/App';
import Settings from './components/Settings';


const container = document.getElementById("root");
const root = ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/popup/" element={<Settings/>} />
      </Routes>
    </Router>
  </React.StrictMode>
);