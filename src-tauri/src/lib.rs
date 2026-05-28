pub mod db;
pub mod models;
pub mod commands;
pub mod worker;
pub mod parser;

use tauri::Manager;
use tauri_plugin_notification::{NotificationExt, PermissionState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&app_dir).unwrap();

            let state = db::init_db(app_dir).expect("Failed to init database");
            let honker_db = state.honker_db.clone();

            app.manage(state);

            // Bootstrap OS notification permission up front so the background
            // worker can fire real Windows 11 / macOS / Linux toasts even if
            // the JS layer hasn't requested permission yet (e.g. autostart at
            // boot with the window hidden, or first reminder firing before the
            // user has interacted with the UI).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                match handle.notification().permission_state() {
                    Ok(PermissionState::Granted) => {}
                    Ok(_) => {
                        let _ = handle.notification().request_permission();
                    }
                    Err(e) => eprintln!("[yaad] could not query notification permission: {e}"),
                }
            });

            worker::start_worker(app.handle().clone(), honker_db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_submit,
            commands::list_reminders,
            commands::complete,
            commands::snooze,
            commands::test_notification,
            commands::list_completed,
            commands::get_settings,
            commands::set_settings,
            commands::factory_reset,
            commands::parse_time,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
