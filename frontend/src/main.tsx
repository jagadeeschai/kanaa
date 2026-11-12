import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './editor.css';
import './studio.css';
import './editor/editor-shell.css';
import { isEditable } from './editor/ContextMenu';
import { startTranslating } from './i18n-dom';
// Kanaa has its own menus. Text boxes keep the browser's, for copy and paste.
document.addEventListener('contextmenu', (event) => { if (!isEditable(event.target)) event.preventDefault(); });

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
startTranslating();
