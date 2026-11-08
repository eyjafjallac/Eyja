use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindowBuilder};

use crate::memo;
use crate::settings::{self, MAIN_LABEL};

/// A document the main window should open once it has loaded.
#[derive(Default)]
pub struct PendingDocument(pub Mutex<Option<String>>);

#[tauri::command]
pub fn take_pending_document(pending: State<PendingDocument>) -> Option<String> {
    pending.0.lock().ok().and_then(|mut id| id.take())
}

/// Shows the main window, building it again if the user closed it.
pub fn show_main(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.unminimize();
        main.show().map_err(|err| err.to_string())?;
        return main.set_focus().map_err(|err| err.to_string());
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_LABEL)
        .ok_or_else(|| "The main window is missing from tauri.conf.json".to_string())?;
    let main = WebviewWindowBuilder::from_config(app, config)
        .and_then(|builder| builder.build())
        .map_err(|err| err.to_string())?;
    settings::apply_main_size(app)?;
    main.show().map_err(|err| err.to_string())?;
    main.set_focus().map_err(|err| err.to_string())
}

/// Opens a document in the main window. A freshly built window picks it up when it loads.
pub fn open_document(app: &AppHandle, id: String) -> Result<(), String> {
    if app.get_webview_window(MAIN_LABEL).is_some() {
        show_main(app)?;
        return app
            .emit_to(MAIN_LABEL, "open-document", id)
            .map_err(|err| err.to_string());
    }
    *app.state::<PendingDocument>()
        .0
        .lock()
        .map_err(|err| err.to_string())? = Some(id);
    show_main(app)
}

/// Runs window work off the event loop: building a window inside a menu, tray or shortcut
/// handler can deadlock on Windows.
pub fn in_background(app: &AppHandle, work: fn(&AppHandle) -> Result<(), String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = work(&app) {
            eprintln!("{err}");
        }
    });
}

/// The notification-area icon keeps Eyja reachable after every window is closed.
pub fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Eyja", true, None::<&str>)?;
    let new_memo = MenuItem::with_id(app, "memo", "New memo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Eyja", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &new_memo, &separator, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("Eyja")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => in_background(app, show_main),
            "memo" => in_background(app, |app| {
                memo::open_new(app);
                Ok(())
            }),
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
                in_background(tray.app_handle(), show_main);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
