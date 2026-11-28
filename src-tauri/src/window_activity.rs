//! Whether a window is the active (foreground) window, i.e. the one the user is working in.
//!
//! Tauri's own focus tracking can't answer this on Windows: there, `WindowEvent::Focused` follows
//! the WebView2 control's *keyboard* focus, which can move off the WebView (or never arrive) while
//! the window stays active, and `is_focused()` is only true while the top-level window itself holds
//! keyboard focus (never, while the WebView has it). So on Windows the window is subclassed to read
//! `WM_ACTIVATE`, the OS's own activation notice. Elsewhere `WindowEvent::Focused` already reports
//! activation (GTK's toplevel focus-in/out).
//!
//! Every change is numbered, so the frontend can order the reply to its initial query against
//! events it receives around the same time and always keep the newest.

use std::sync::{Arc, Mutex, mpsc};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};

/// Sent to the frontend whenever the activity changes, with an [`Activity`] payload.
pub const EVENT: &str = "window-activity";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Activity {
  pub active: bool,
  /// Increases with every change.
  pub seq: u64,
}

pub struct Tracker {
  current: Mutex<Activity>,
  /// Changes are emitted from a separate thread. On Windows they're detected inside the window
  /// procedure, which can run re-entrantly from within Tauri's own event handling, so calling back
  /// into Tauri there isn't safe. A channel also keeps the events in order.
  changes: mpsc::Sender<Activity>,
}

impl Tracker {
  pub fn new<R: Runtime>(app: &AppHandle<R>) -> Arc<Self> {
    let (changes, rx) = mpsc::channel::<Activity>();
    let app = app.clone();
    std::thread::spawn(move || {
      for activity in rx {
        let _ = app.emit(EVENT, activity);
      }
    });
    Arc::new(Self {
      current: Mutex::new(Activity { active: false, seq: 0 }),
      changes,
    })
  }

  pub fn get(&self) -> Activity {
    *self.current.lock().unwrap()
  }

  fn set(&self, active: bool) {
    let mut current = self.current.lock().unwrap();
    if current.active == active {
      return;
    }
    *current = Activity { active, seq: current.seq + 1 };
    let _ = self.changes.send(*current);
  }
}

/// Start tracking whether `window` is active.
pub fn watch<R: Runtime>(window: &WebviewWindow<R>, tracker: Arc<Tracker>) -> tauri::Result<()> {
  platform::watch(window, tracker)
}

#[cfg(windows)]
mod platform {
  use super::*;
  use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
  use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
  use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, WA_INACTIVE, WM_ACTIVATE, WM_NCDESTROY};

  const SUBCLASS_ID: usize = 0xC011;

  pub fn watch<R: Runtime>(window: &WebviewWindow<R>, tracker: Arc<Tracker>) -> tauri::Result<()> {
    // HWND isn't Send; carry it to the main thread as an integer
    let hwnd = window.hwnd()?.0 as isize;
    // A window can only be subclassed from the thread that created it
    window.run_on_main_thread(move || unsafe {
      let hwnd = HWND(hwnd as _);
      let data = Box::into_raw(Box::new(tracker));
      if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, data as usize).as_bool() {
        drop(Box::from_raw(data));
        eprintln!("coil: couldn't watch window activation");
        return;
      }
      // Read the starting state only once the subclass is in place, so no change can slip between
      (*data).set(GetForegroundWindow() == hwnd);
    })
  }

  unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
  ) -> LRESULT {
    unsafe {
      let tracker = data as *mut Arc<Tracker>;
      match msg {
        // The low word is WA_INACTIVE, WA_ACTIVE or WA_CLICKACTIVE. The high word says whether the
        // window is minimized; that's ignored, since a window restored while already active gets
        // no further WM_ACTIVATE.
        WM_ACTIVATE => (*tracker).set((wparam.0 & 0xFFFF) as u32 != WA_INACTIVE),
        WM_NCDESTROY => {
          let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
          drop(Box::from_raw(tracker));
        }
        _ => {}
      }
      DefSubclassProc(hwnd, msg, wparam, lparam)
    }
  }
}

#[cfg(not(windows))]
mod platform {
  use super::*;
  use tauri::WindowEvent;

  pub fn watch<R: Runtime>(window: &WebviewWindow<R>, tracker: Arc<Tracker>) -> tauri::Result<()> {
    let events = tracker.clone();
    window.on_window_event(move |event| {
      if let WindowEvent::Focused(focused) = event {
        events.set(*focused);
      }
    });
    // Subscribed first, so no change can slip between
    tracker.set(window.is_focused()?);
    Ok(())
  }
}
