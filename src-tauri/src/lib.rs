mod window_activity;

use std::sync::Arc;

use tauri::{Manager, State};
use tauri_plugin_window_state::StateFlags;
use window_activity::{Activity, Tracker};

/// Whether the main window is currently active. Changes are pushed as `window-activity` events.
#[tauri::command]
fn window_activity(tracker: State<'_, Arc<Tracker>>) -> Activity {
  tracker.get()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Reopen where the timer was left. Decorations stay off: the app draws its own window controls.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
        .build(),
    )
    .setup(|app| {
      let tracker = Tracker::new(app.handle());
      if let Some(window) = app.get_webview_window("main") {
        window_activity::watch(&window, tracker.clone())?;
      }
      app.manage(tracker);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![window_activity])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
