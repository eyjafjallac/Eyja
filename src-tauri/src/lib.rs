mod assets;
mod db;
mod documents;
mod export;
mod links;
mod memo;
mod organize;
mod samples;
mod search;
mod settings;
mod shell;
mod versions;

use std::sync::atomic::AtomicBool;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must come first: a second launch hands over to the copy already in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::in_background(app, shell::show_main);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        shell::in_background(app, |app| {
                            memo::open_new(app);
                            Ok(())
                        });
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
            app.manage(shell::PendingDocument::default());
            if let Err(err) = app.global_shortcut().register(shortcut.as_str()) {
                eprintln!("Could not register the memo shortcut {shortcut}: {err}");
            }
            shell::setup_tray(app)?;
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
            if let Some(id) = memo::memo_id(window.label()) {
                memo::on_window_closed(window.app_handle(), id);
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
            settings::set_history_settings,
            settings::set_max_tags,
            organize::list_tags,
            organize::set_document_tags,
            organize::list_folders,
            organize::create_folder,
            organize::rename_folder,
            organize::move_folder,
            organize::delete_folder,
            organize::set_document_folder,
            organize::set_document_pinned,
            organize::set_document_favorite,
            organize::set_document_cover,
            samples::create_samples,
            search::search_documents,
            search::similar_documents,
            shell::take_pending_document,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { code, api, .. } = event {
                // The last window closing is not a quit: Eyja stays in the tray.
                // "Quit Eyja" in the tray, and Cmd+Q while a window is open, do quit.
                if code.is_none() && app.webview_windows().is_empty() {
                    api.prevent_exit();
                } else {
                    memo::on_app_exit(app);
                }
            }
        });
}
