import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

window.addEventListener('vite:preloadError', () => {
  const reloadKey = 'dst-chunk-reload-once';
  if (!sessionStorage.getItem(reloadKey)) {
    sessionStorage.setItem(reloadKey, '1');
    window.location.reload();
  }
});

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadedForSw = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloadedForSw) {
      reloadedForSw = true;
      window.location.reload();
    }
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      registration.update().catch(() => undefined);
    }
  },
});

createRoot(document.getElementById('root')!).render(<App />);
