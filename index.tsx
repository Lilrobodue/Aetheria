import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './src/index.css';
import { register as registerSW, NetworkStatus } from './src/serviceWorker';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for offline support
registerSW({
  onSuccess: (registration) => {
    console.log('✅ App is now available offline!');
    // Optional: Show user notification that app is cached for offline use
  },
  onUpdate: (registration) => {
    console.log('🔄 New app version available!');
    // Optional: Show user notification that they can refresh for updates
    if (confirm('New version available! Reload to update?')) {
      window.location.reload();
    }
  },
  onOfflineReady: () => {
    console.log('📱 App is ready to work offline');
  },
  onNeedRefresh: () => {
    console.log('🔄 App needs refresh for latest version');
  }
});

// Optional: Set up network status monitoring
const networkStatus = new NetworkStatus();
networkStatus.addListener((online) => {
  if (online) {
    console.log('🌐 Back online!');
    // Optional: Show user notification or update UI
  } else {
    console.log('📴 Gone offline - app will still work!');
    // Optional: Show user notification or update UI  
  }
});