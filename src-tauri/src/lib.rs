pub mod db;
pub mod models;
pub mod commands;
pub mod worker;
pub mod parser;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_notification::{NotificationExt, PermissionState};

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

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

            let show_item = MenuItem::with_id(app, "show", "Open Yaad", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Yaad", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id("yaad-tray")
                .tooltip("Yaad")
                .icon(app.default_window_icon().cloned().expect("default window icon"))
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let _ = w.hide();
                        api.prevent_close();
                    }
                });
            }

            worker::start_worker(app.handle().clone(), honker_db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_submit,
            commands::list_reminders,
            commands::complete,
            commands::snooze,
            commands::reschedule_at,
            commands::test_notification,
            commands::list_completed,
            commands::count_completed,
            commands::get_settings,
            commands::set_settings,
            commands::factory_reset,
            commands::parse_time,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
