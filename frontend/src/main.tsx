import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
// Polices du site, hébergées avec l'app (pas d'appel à Google Fonts)
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
