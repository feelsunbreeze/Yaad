pub mod db;
pub mod models;
pub mod commands;
pub mod worker;
pub mod parser;

use tauri::Manager;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
