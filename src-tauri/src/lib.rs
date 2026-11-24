use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Reopen where the timer was left. Decorations stay off: the app draws its own window controls.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
        .build(),
    )
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
