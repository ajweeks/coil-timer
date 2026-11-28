import { useEffect } from 'react';
import { isNative, requestAttention } from './native';
import { isWindowFocused, subscribeWindowFocus } from './windowFocus';

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
 * - In the desktop app, asks the OS directly to flash the taskbar button.
 *
 * Everything is undone as soon as the window becomes active again.
 */
export const useAttention = (active: boolean) => {
  useEffect(() => {
    if (!active || isWindowFocused()) return;

    const originalTitle = document.title;
    let showAlert = true;
    document.title = ALERT_TITLE;
    const blink = setInterval(() => {
      showAlert = !showAlert;
      document.title = showAlert ? ALERT_TITLE : originalTitle;
    }, BLINK_INTERVAL_MS);

    navigator.setAppBadge?.().catch(() => {});
    if (isNative) requestAttention().catch(() => {});
    else window.focus();

    let stopped = false;
    let unsubscribe = () => {};
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(blink);
      document.title = originalTitle;
      navigator.clearAppBadge?.().catch(() => {});
      unsubscribe();
    };
    unsubscribe = subscribeWindowFocus(() => {
      if (isWindowFocused()) stop();
    });
    return stop;
  }, [active]);
};
