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

/**
 * Follow the OS window's focus. The page's own focus/blur events aren't enough on Windows: activating
 * the window with Alt+Tab doesn't focus the WebView2 inside it, so no `focus` event fires until a click.
 * Only changes are reported: Windows can send the same state repeatedly.
 */
export const onWindowFocusChanged = (callback: (focused: boolean) => void) => {
  let last: boolean | null = null;
  return appWindow().onFocusChanged(({ payload: focused }) => {
    if (focused === last) return;
    last = focused;
    callback(focused);
  });
};

/** Flash the taskbar button (Windows) / mark the window urgent (Linux). */
export const requestAttention = () => appWindow().requestUserAttention(UserAttentionType.Critical);
