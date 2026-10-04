mod assets;
mod db;
mod documents;
mod export;
mod memo;
mod settings;
mod versions;

use std::sync::atomic::AtomicBool;

use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Building a window inside an event handler can deadlock on Windows.
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { memo::open_new(&app) });
                    }
                })
                .build(),
        )
        .setup(|app| {
            let connection = db::open(app)?;
            if let Err(err) = memo::purge_expired(&connection, &db::assets_dir(app)?) {
                eprintln!("Could not clear expired memos: {err}");
            }
            let shortcut = settings::memo_shortcut(&connection)?;
            app.manage(db::AppDb(std::sync::Mutex::new(connection)));
            app.manage(memo::Exiting(AtomicBool::new(false)));
            if let Err(err) = app.global_shortcut().register(shortcut.as_str()) {
                eprintln!("Could not register the memo shortcut {shortcut}: {err}");
            }
            let handle = app.handle();
            if let Err(err) = settings::apply_main_size(handle) {
                eprintln!("Could not size the main window: {err}");
            }
            if let Some(main) = app.get_webview_window(settings::MAIN_LABEL) {
                main.show()?;
            }
            if let Err(err) = memo::restore_windows(handle) {
                eprintln!("Could not reopen memo windows: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }
            let app = window.app_handle();
            if window.label() == settings::MAIN_LABEL {
                // Memo windows would otherwise keep the app alive after the main window is gone.
                memo::on_app_exit(app);
                app.exit(0);
            } else if let Some(id) = memo::memo_id(window.label()) {
                memo::on_window_closed(app, id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            documents::list_documents,
            documents::get_document,
            documents::create_document,
            documents::update_document,
            documents::delete_document,
            versions::history_state,
            versions::record_version,
            versions::get_version,
            versions::restore_version,
            export::export_source,
            export::export_markdown,
            export::export_pdf,
            assets::list_assets,
            assets::import_assets,
            assets::save_asset,
            assets::remove_asset,
            assets::open_asset,
            memo::list_memos,
            memo::create_memo,
            memo::get_memo,
            memo::update_memo,
            memo::set_memo_color,
            memo::open_memo,
            memo::open_in_editor,
            settings::get_settings,
            settings::set_memo_shortcut,
            settings::set_memo_retention,
            settings::set_window_size,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
