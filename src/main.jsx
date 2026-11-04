import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'
import { installDragDebug } from './utils/dragDebug'

installDragDebug()
if (new URLSearchParams(window.location.search).get('neo3EditorSelfTest') === '1') import('./components/workbench/artifact-editor/selftest').then((m) => m.mountEditorSelfTest())

// Register service worker for PWA + Web Push support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => {
    console.warn('Service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
