import { createRoot } from 'react-dom/client';
import { isNative } from './native';
import SpiralTimer from './SpiralTimer';

const root = createRoot(document.getElementById('root')!);
root.render(<SpiralTimer />);

// Only in production builds: a service worker in dev would serve stale modules
// The desktop app ships its files locally, so it doesn't need one
if (import.meta.env.PROD && !isNative && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
