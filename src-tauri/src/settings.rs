use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, LogicalSize, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{assets_dir, now_ms, AppDb};
use crate::memo;
use crate::versions;

pub const DEFAULT_MEMO_SHORTCUT: &str = "Ctrl+Shift+M";
const MEMO_SHORTCUT: &str = "memo_shortcut";
const MEMO_RETENTION_DAYS: &str = "memo_retention_days";
const MEMO_WINDOW_SIZE: &str = "memo_window_size";
const MAIN_WINDOW_SIZE: &str = "main_window_size";
const HISTORY_IDLE_MINUTES: &str = "history_idle_minutes";
const HISTORY_TYPING_MINUTES: &str = "history_typing_minutes";
const HISTORY_RETENTION: &str = "history_retention";
const MAX_TAGS: &str = "max_tags";
const SIZES: [&str; 3] = ["small", "medium", "large"];
const DEFAULT_SIZE: &str = "medium";
pub const MAIN_LABEL: &str = "main";

pub const DEFAULT_IDLE_MINUTES: u32 = 2;
pub const DEFAULT_TYPING_MINUTES: u32 = 5;
const MAX_IDLE_MINUTES: u32 = 120;
const MAX_TYPING_MINUTES: u32 = 240;
/// `all` keeps every version; `daily` keeps only the last version of each past day.
const RETENTIONS: [&str; 2] = ["all", "daily"];
pub const DEFAULT_MAX_TAGS: u32 = 5;
const MAX_TAGS_LIMIT: u32 = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub memo_shortcut: String,
    pub memo_shortcut_active: bool,
    pub memo_retention_days: Option<u32>,
    pub memo_size: String,
    pub main_size: String,
    pub history_idle_minutes: u32,
    pub history_typing_minutes: u32,
    pub history_retention: String,
    pub max_tags: u32,
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

/// `tz_offset_minutes` is the caller's `Date.getTimezoneOffset()`, so "a day" is a local day.
#[tauri::command]
pub fn set_history_settings(
    app: AppHandle,
    idle_minutes: u32,
    typing_minutes: u32,
    retention: String,
    tz_offset_minutes: i32,
) -> Result<Settings, String> {
    if !(1..=MAX_IDLE_MINUTES).contains(&idle_minutes) {
        return Err(format!("Use 1 to {MAX_IDLE_MINUTES} minutes for the idle version."));
    }
    if !(1..=MAX_TYPING_MINUTES).contains(&typing_minutes) {
        return Err(format!("Use 1 to {MAX_TYPING_MINUTES} minutes for the typing version."));
    }
    if !RETENTIONS.contains(&retention.as_str()) {
        return Err(format!("Unknown retention \"{retention}\""));
    }
    {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
        set_value(&tx, HISTORY_IDLE_MINUTES, Some(&idle_minutes.to_string()))?;
        set_value(&tx, HISTORY_TYPING_MINUTES, Some(&typing_minutes.to_string()))?;
        set_value(&tx, HISTORY_RETENTION, Some(&retention))?;
        if retention == "daily" {
            versions::compact_all(&tx, tz_offset_minutes, now_ms())?;
        }
        tx.commit().map_err(|err| err.to_string())?;
    }
    current(&app)
}

#[tauri::command]
pub fn set_max_tags(app: AppHandle, max_tags: u32) -> Result<Settings, String> {
    if !(1..=MAX_TAGS_LIMIT).contains(&max_tags) {
        return Err(format!("Use 1 to {MAX_TAGS_LIMIT} tags."));
    }
    {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        set_value(&conn, MAX_TAGS, Some(&max_tags.to_string()))?;
    }
    current(&app)
}

fn number_value(conn: &Connection, key: &str, default: u32, max: u32) -> Result<u32, String> {
    Ok(get_value(conn, key)?
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| (1..=max).contains(value))
        .unwrap_or(default))
}

pub(crate) fn max_tags(conn: &Connection) -> Result<u32, String> {
    number_value(conn, MAX_TAGS, DEFAULT_MAX_TAGS, MAX_TAGS_LIMIT)
}

pub(crate) fn keeps_daily_versions(conn: &Connection) -> Result<bool, String> {
    Ok(get_value(conn, HISTORY_RETENTION)?.as_deref() == Some("daily"))
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
    let mut settings = {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        stored(&conn)?
    };
    settings.memo_shortcut_active = settings
        .memo_shortcut
        .parse::<Shortcut>()
        .map(|shortcut| app.global_shortcut().is_registered(shortcut))
        .unwrap_or(false);
    Ok(settings)
}

/// Everything except whether the shortcut is registered, which only the app knows.
fn stored(conn: &Connection) -> Result<Settings, String> {
    Ok(Settings {
        memo_shortcut: memo_shortcut(conn)?,
        memo_shortcut_active: false,
        memo_retention_days: memo_retention_days(conn)?,
        memo_size: size_value(conn, MEMO_WINDOW_SIZE)?,
        main_size: size_value(conn, MAIN_WINDOW_SIZE)?,
        history_idle_minutes: number_value(conn, HISTORY_IDLE_MINUTES, DEFAULT_IDLE_MINUTES, MAX_IDLE_MINUTES)?,
        history_typing_minutes: number_value(
            conn,
            HISTORY_TYPING_MINUTES,
            DEFAULT_TYPING_MINUTES,
            MAX_TYPING_MINUTES,
        )?,
        history_retention: if keeps_daily_versions(conn)? { "daily" } else { "all" }.to_string(),
        max_tags: max_tags(conn)?,
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
    fn library_settings_default_and_ignore_bad_values() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let settings = stored(&conn).unwrap();
        assert_eq!(settings.history_idle_minutes, 2);
        assert_eq!(settings.history_typing_minutes, 5);
        assert_eq!(settings.history_retention, "all");
        assert_eq!(settings.max_tags, 5);

        set_value(&conn, HISTORY_IDLE_MINUTES, Some("0")).unwrap();
        set_value(&conn, HISTORY_TYPING_MINUTES, Some("12")).unwrap();
        set_value(&conn, HISTORY_RETENTION, Some("daily")).unwrap();
        set_value(&conn, MAX_TAGS, Some("99")).unwrap();
        let settings = stored(&conn).unwrap();
        assert_eq!(settings.history_idle_minutes, 2);
        assert_eq!(settings.history_typing_minutes, 12);
        assert_eq!(settings.history_retention, "daily");
        assert_eq!(settings.max_tags, 5);
    }

    #[test]
    fn default_shortcut_parses() {
        assert!(DEFAULT_MEMO_SHORTCUT.parse::<Shortcut>().is_ok());
    }
}
