import { useSyncExternalStore } from 'react';
import { isNative, watchWindowActivity } from './native';
import { Seconds } from './time-utils';

/**
 * Whether this window is the one the user is working in: the single source of truth for everything
 * that reacts to focus.
 *
 * - Desktop app: the OS's window activation (see `watchWindowActivity`). The page's focus events aren't
 *   used there, because they follow keyboard focus inside the WebView, which isn't the same thing.
 * - Browser: `document.hasFocus()`, read again on every focus, blur and visibility change, rather than
 *   guessed from which event fired.
 *
 * State lives at module level so that every reader agrees, and so that there is only ever one pending
 * "away" timer, which is replaced on every change.
 */

/** How long the window must stay inactive before it counts as away */
const AWAY_DELAY = 3 * Seconds;

let focused = true;
let away = false;
let awayTimer: ReturnType<typeof setTimeout> | undefined;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

const setFocused = (next: boolean) => {
  if (next === focused) return;
  focused = next;
  clearTimeout(awayTimer);
  awayTimer = undefined;
  if (focused) {
    away = false;
  } else {
    awayTimer = setTimeout(() => {
      away = true;
      notify();
    }, AWAY_DELAY);
  }
  notify();
};

const watchDocumentFocus = () => {
  const sync = () => setFocused(document.hasFocus());
  sync();
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  document.addEventListener('visibilitychange', sync);
  return () => {
    window.removeEventListener('focus', sync);
    window.removeEventListener('blur', sync);
    document.removeEventListener('visibilitychange', sync);
  };
};

const watchNativeActivity = () => {
  let stop: (() => void) | null = null;
  let stopped = false;
  watchWindowActivity(setFocused)
    .then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    })
    .catch((e) => {
      // Shouldn't happen, but the page's own focus is better than none
      console.error('Window activity unavailable; using page focus', e);
      if (!stopped) stop = watchDocumentFocus();
    });
  return () => {
    stopped = true;
    stop?.();
  };
};

let stopWatching: (() => void) | null = null;

/** Watching starts with the first subscriber and stops with the last. */
export const subscribeWindowFocus = (listener: () => void) => {
  // Start before adding the listener: the initial state isn't a change it needs to hear about
  if (listeners.size === 0) stopWatching = isNative ? watchNativeActivity() : watchDocumentFocus();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatching?.();
    stopWatching = null;
  };
};

/** True while this window is active. */
export const isWindowFocused = () => focused;

/** True once the window has been inactive for a few seconds. UI that's only for the active window fades out then. */
export const useIsWindowAway = () => useSyncExternalStore(subscribeWindowFocus, () => away);
