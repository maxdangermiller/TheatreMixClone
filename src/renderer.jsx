import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from "react-router";

import App from './components/App';
import Settings from './components/Settings';


const container = document.getElementById("root");
const root = ReactDOM.createRoot(container).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/popup/" element={<Settings/>} />
    </Routes>
  </BrowserRouter>,
);