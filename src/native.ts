import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';

/** True when running inside the Tauri desktop app rather than a browser. */
export const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const appWindow = () => getCurrentWindow();

export const closeWindow = () => appWindow().close();

export const minimizeWindow = () => appWindow().minimize();

export const setAlwaysOnTop = (onTop: boolean) => appWindow().setAlwaysOnTop(onTop);

export const toggleNativeFullscreen = async () => {
  const win = appWindow();
  await win.setFullscreen(!(await win.isFullscreen()));
};

/** Move the window with the mouse. Must be called while the primary button is held. */
export const startDragging = () => appWindow().startDragging();

interface WindowActivity {
  active: boolean;
  /** Increases with every change */
  seq: number;
}

/**
 * Follow whether the window is active (the one the user is working in), as the OS sees it.
 *
 * Neither the page's focus/blur events nor Tauri's own focus events can tell: on Windows both follow
 * keyboard focus inside the WebView, which can be lost or never arrive while the window is active.
 * The app reports activation itself instead (see src-tauri/src/window_activity.rs).
 *
 * Calls back with the current state, then with every change. Resolves to a function that stops watching.
 */
export const watchWindowActivity = async (callback: (active: boolean) => void) => {
  let latest = -1;
  const apply = ({ active, seq }: WindowActivity) => {
    // The reply to the query below can arrive after newer events; keep whichever is newest
    if (seq <= latest) return;
    latest = seq;
    callback(active);
  };
  // Listen before asking, so no change can be missed in between
  const unlisten = await listen<WindowActivity>('window-activity', (e) => apply(e.payload));
  try {
    apply(await invoke<WindowActivity>('window_activity'));
  } catch (e) {
    unlisten();
    throw e;
  }
  return unlisten;
};

/** Flash the taskbar button (Windows) / mark the window urgent (Linux). */
export const requestAttention = () => appWindow().requestUserAttention(UserAttentionType.Critical);
