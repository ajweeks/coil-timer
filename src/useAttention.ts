import { useEffect } from 'react';

const ALERT_TITLE = '⏰ Time’s up';
const BLINK_INTERVAL_MS = 1000;

/**
 * Draw the user's attention to this window while it's in the background.
 *
 * Browsers don't expose the OS "flash taskbar button" API directly, so this is best-effort:
 * - `window.focus()`: on Windows, Chromium asks the OS to activate the window; the OS refuses to
 *   steal focus from the foreground app and flashes the taskbar button instead. (Browsers may
 *   ignore the call entirely, in which case nothing happens.)
 * - Blinks the document title, which shows on the taskbar button / tab.
 * - Sets an app badge on the taskbar icon when running as an installed PWA.
 *
 * Everything is undone as soon as the window regains focus.
 */
export const useAttention = (active: boolean) => {
  useEffect(() => {
    if (!active || document.hasFocus()) return;

    const originalTitle = document.title;
    let showAlert = true;
    document.title = ALERT_TITLE;
    const blink = setInterval(() => {
      showAlert = !showAlert;
      document.title = showAlert ? ALERT_TITLE : originalTitle;
    }, BLINK_INTERVAL_MS);

    navigator.setAppBadge?.().catch(() => {});
    window.focus();

    const stop = () => {
      clearInterval(blink);
      document.title = originalTitle;
      navigator.clearAppBadge?.().catch(() => {});
      window.removeEventListener('focus', stop);
    };
    window.addEventListener('focus', stop);
    return stop;
  }, [active]);
};
