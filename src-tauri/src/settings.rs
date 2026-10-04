use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{assets_dir, AppDb};
use crate::memo;

pub const DEFAULT_MEMO_SHORTCUT: &str = "Ctrl+Shift+M";
const MEMO_SHORTCUT: &str = "memo_shortcut";
const MEMO_RETENTION_DAYS: &str = "memo_retention_days";
const MEMO_WINDOW_SIZE: &str = "memo_window_size";
const MAIN_WINDOW_SIZE: &str = "main_window_size";
const SIZES: [&str; 3] = ["small", "medium", "large"];
const DEFAULT_SIZE: &str = "medium";
pub const MAIN_LABEL: &str = "main";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub memo_shortcut: String,
    pub memo_shortcut_active: bool,
    pub memo_retention_days: Option<u32>,
    pub memo_size: String,
    pub main_size: String,
}

fn memo_dimensions(size: &str) -> (f64, f64) {
    match size {
        "small" => (260.0, 300.0),
        "large" => (400.0, 500.0),
        _ => (320.0, 380.0),
    }
}

/// The editor and the library share the main window, so they share one size.
fn main_dimensions(size: &str) -> (f64, f64) {
    match size {
        "small" => (900.0, 600.0),
        "large" => (1400.0, 900.0),
        _ => (1120.0, 740.0),
    }
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<Settings, String> {
    current(&app)
}

#[tauri::command]
pub async fn set_memo_shortcut(app: AppHandle, shortcut: String) -> Result<Settings, String> {
    let shortcut = shortcut.trim().to_string();
    let next: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("\"{shortcut}\" is not a shortcut Eyja can use."))?;
    let previous = {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        memo_shortcut(&conn)?
    };
    // The database lock is released here: the shortcut calls below wait on the main thread.
    let manager = app.global_shortcut();
    let old = previous.parse::<Shortcut>().ok();
    if old != Some(next) {
        if let Some(old) = old {
            if manager.is_registered(old) {
                manager.unregister(old).map_err(|err| err.to_string())?;
            }
        }
        if let Err(err) = manager.register(next) {
            if let Some(old) = old {
                let _ = manager.register(old);
            }
            return Err(format!("Could not use {shortcut}: {err}"));
        }
    } else if !manager.is_registered(next) {
        manager
            .register(next)
            .map_err(|err| format!("Could not use {shortcut}: {err}"))?;
    }
    {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        set_value(&conn, MEMO_SHORTCUT, Some(&shortcut))?;
    }
    current(&app)
}

/// `None` keeps memos until the user deletes them.
#[tauri::command]
pub fn set_memo_retention(app: AppHandle, db: State<AppDb>, days: Option<u32>) -> Result<Settings, String> {
    if days == Some(0) {
        return Err("Use at least 1 day.".to_string());
    }
    {
        let conn = lock(&db)?;
        let value = days.map(|days| days.to_string());
        set_value(&conn, MEMO_RETENTION_DAYS, value.as_deref())?;
        memo::purge_expired(&conn, &assets_dir(&app)?)?;
    }
    current(&app)
}

/// `target` is `memo` or `main`; `size` is `small`, `medium` or `large`.
#[tauri::command]
pub fn set_window_size(app: AppHandle, target: String, size: String) -> Result<Settings, String> {
    if !SIZES.contains(&size.as_str()) {
        return Err(format!("Unknown size \"{size}\""));
    }
    let key = match target.as_str() {
        "memo" => MEMO_WINDOW_SIZE,
        "main" => MAIN_WINDOW_SIZE,
        _ => return Err(format!("Unknown window \"{target}\"")),
    };
    {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        set_value(&conn, key, Some(&size))?;
    }
    // Open memo windows keep the size they have; the memo size applies to new ones.
    if target == "main" {
        apply_main_size(&app)?;
    }
    current(&app)
}

pub(crate) fn memo_window_size(conn: &Connection) -> Result<(f64, f64), String> {
    Ok(memo_dimensions(&size_value(conn, MEMO_WINDOW_SIZE)?))
}

/// Sizes the main window from the setting, kept inside the screen, and centers it.
pub(crate) fn apply_main_size(app: &AppHandle) -> Result<(), String> {
    let size = {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        size_value(&conn, MAIN_WINDOW_SIZE)?
    };
    let window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "The main window is closed.".to_string())?;
    let (width, height) = main_dimensions(&size);
    window
        .set_size(fit_to_screen(&window, width, height))
        .map_err(|err| err.to_string())?;
    window.center().map_err(|err| err.to_string())
}

fn fit_to_screen(window: &WebviewWindow, width: f64, height: f64) -> LogicalSize<f64> {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
        return LogicalSize::new(width.min(area.width * 0.95), height.min(area.height * 0.95));
    }
    LogicalSize::new(width, height)
}

fn size_value(conn: &Connection, key: &str) -> Result<String, String> {
    Ok(get_value(conn, key)?
        .filter(|size| SIZES.contains(&size.as_str()))
        .unwrap_or_else(|| DEFAULT_SIZE.to_string()))
}

pub(crate) fn memo_shortcut(conn: &Connection) -> Result<String, String> {
    Ok(get_value(conn, MEMO_SHORTCUT)?.unwrap_or_else(|| DEFAULT_MEMO_SHORTCUT.to_string()))
}

pub(crate) fn memo_retention_days(conn: &Connection) -> Result<Option<u32>, String> {
    Ok(get_value(conn, MEMO_RETENTION_DAYS)?
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|days| *days > 0))
}

fn current(app: &AppHandle) -> Result<Settings, String> {
    let (memo_shortcut, memo_retention_days, memo_size, main_size) = {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        (
            memo_shortcut(&conn)?,
            memo_retention_days(&conn)?,
            size_value(&conn, MEMO_WINDOW_SIZE)?,
            size_value(&conn, MAIN_WINDOW_SIZE)?,
        )
    };
    let memo_shortcut_active = memo_shortcut
        .parse::<Shortcut>()
        .map(|shortcut| app.global_shortcut().is_registered(shortcut))
        .unwrap_or(false);
    Ok(Settings {
        memo_shortcut,
        memo_shortcut_active,
        memo_retention_days,
        memo_size,
        main_size,
    })
}

pub(crate) fn get_value(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|err| err.to_string())
}

pub(crate) fn set_value(conn: &Connection, key: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(value) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        ),
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [key]),
    }
    .map(|_| ())
    .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    #[test]
    fn defaults_and_overrides() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(memo_shortcut(&conn).unwrap(), DEFAULT_MEMO_SHORTCUT);
        assert_eq!(memo_retention_days(&conn).unwrap(), None);

        set_value(&conn, MEMO_SHORTCUT, Some("Alt+Space")).unwrap();
        set_value(&conn, MEMO_RETENTION_DAYS, Some("7")).unwrap();
        assert_eq!(memo_shortcut(&conn).unwrap(), "Alt+Space");
        assert_eq!(memo_retention_days(&conn).unwrap(), Some(7));

        set_value(&conn, MEMO_RETENTION_DAYS, None).unwrap();
        assert_eq!(memo_retention_days(&conn).unwrap(), None);
    }

    #[test]
    fn window_sizes_default_to_medium_and_ignore_unknown_values() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        assert_eq!(memo_window_size(&conn).unwrap(), memo_dimensions("medium"));
        set_value(&conn, MEMO_WINDOW_SIZE, Some("small")).unwrap();
        assert_eq!(memo_window_size(&conn).unwrap(), (260.0, 300.0));
        set_value(&conn, MAIN_WINDOW_SIZE, Some("huge")).unwrap();
        assert_eq!(size_value(&conn, MAIN_WINDOW_SIZE).unwrap(), "medium");
    }

    #[test]
    fn default_shortcut_parses() {
        assert!(DEFAULT_MEMO_SHORTCUT.parse::<Shortcut>().is_ok());
    }
}
