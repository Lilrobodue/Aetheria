import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RootErrorBoundary, RootCrashProbe } from './components/ErrorBoundary';
import './src/index.css';
import { register as registerSW, NetworkStatus } from './src/serviceWorker';
import { startPerfHud } from './utils/perfHud';

// Dev-only perf readout (?perf=1); a no-op unless switched on.
startPerfHud();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      {/* DEV only: lets the root drill crash a sibling of App (the root boundary then replaces App, as App's own crash would) */}
      <RootCrashProbe />
      <App />
    </RootErrorBoundary>
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
    // Never a blocking confirm(): this fires whenever a deploy is detected,
    // which can be mid-playback on a locked phone or in the car, and a modal
    // dialog freezes JavaScript — auto-advance and the media session with it.
    // App shows a non-blocking "Update ready · Reload" toast instead; the flag
    // covers an App that mounts after the event.
    (window as any).__aetheriaUpdateReady = true;
    window.dispatchEvent(new Event('aetheria:update-ready'));
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