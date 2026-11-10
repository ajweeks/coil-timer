import { createRoot } from 'react-dom/client';
import SpiralTimer from './SpiralTimer';

const root = createRoot(document.getElementById('root')!);
root.render(<SpiralTimer />);

// Only in production builds: a service worker in dev would serve stale modules
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
