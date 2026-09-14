import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './styles/index.css';
// Side-effect only: stamps the resolved theme onto <html> before anything
// renders, so there's no flash of the wrong theme on load. See
// store/themeStore.ts's own doc.
import './store/themeStore.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
