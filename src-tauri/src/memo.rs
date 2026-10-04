use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::assets::{self, Asset};
use crate::db::{assets_dir, now_ms, AppDb};
use crate::documents;
use crate::settings::{self, MAIN_LABEL};

/// Each memo window is labelled `memo-<document id>`.
pub const LABEL_PREFIX: &str = "memo-";
const OPEN_WINDOWS_KEY: &str = "memo_windows";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const PREVIEW_CHARS: usize = 80;
pub const COLORS: [&str; 6] = ["yellow", "green", "blue", "pink", "purple", "gray"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub color: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub title: String,
    pub body: String,
    pub color: Option<String>,
    pub updated_at: i64,
    pub assets: Vec<Asset>,
}

/// Set while the app quits, so closing every memo window does not forget which were open.
pub struct Exiting(pub AtomicBool);

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct OpenWindow {
    id: String,
    x: f64,
    y: f64,
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
}

/// Below this height the window was collapsed to its bar, which is not a size worth restoring.
const MIN_RESTORED_HEIGHT: f64 = 120.0;

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_memos(app: AppHandle, db: State<AppDb>) -> Result<Vec<MemoSummary>, String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    purge_expired(&conn, &dir)?;
    list(&conn)
}

#[tauri::command]
pub fn create_memo(db: State<AppDb>) -> Result<Memo, String> {
    let conn = lock(&db)?;
    let note = documents::create_kind(&conn, "memo")?;
    Ok(Memo {
        id: note.id,
        title: note.title,
        body: note.body,
        color: note.color,
        updated_at: note.updated_at,
        assets: Vec::new(),
    })
}

#[tauri::command]
pub fn get_memo(app: AppHandle, db: State<AppDb>, id: String) -> Result<Memo, String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    get(&conn, &dir, &id)?.ok_or_else(|| "Memo not found".to_string())
}

/// Saves only the body, so a title set in the editor is kept.
#[tauri::command]
pub fn update_memo(db: State<AppDb>, id: String, body: String) -> Result<(), String> {
    let conn = lock(&db)?;
    update_body(&conn, &id, &body)
}

#[tauri::command]
pub fn set_memo_color(db: State<AppDb>, id: String, color: Option<String>) -> Result<(), String> {
    let conn = lock(&db)?;
    set_color(&conn, &id, color.as_deref())
}

/// Opens a memo in its own window, or focuses the window it is already in.
/// Without an id this opens a blank memo.
#[tauri::command]
pub async fn open_memo(app: AppHandle, id: Option<String>) -> Result<String, String> {
    let id = match id {
        Some(id) => id,
        None => blank_or_new(&app)?,
    };
    open_window(&app, &id, None, None, true)?;
    Ok(id)
}

#[tauri::command]
pub async fn open_in_editor(app: AppHandle, id: String) -> Result<(), String> {
    let main = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "The main window is closed.".to_string())?;
    let _ = main.unminimize();
    main.show().map_err(|err| err.to_string())?;
    main.set_focus().map_err(|err| err.to_string())?;
    app.emit_to(MAIN_LABEL, "open-document", id)
        .map_err(|err| err.to_string())
}

pub fn memo_id(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX)
}

/// The global shortcut: a blank memo in its own window.
pub fn open_new(app: &AppHandle) {
    let opened = blank_or_new(app).and_then(|id| open_window(app, &id, None, None, true));
    if let Err(err) = opened {
        eprintln!("Could not open a memo window: {err}");
    }
}

/// Reopens the memo windows that were open when the app last quit.
pub fn restore_windows(app: &AppHandle) -> Result<(), String> {
    let saved = {
        let db = app.state::<AppDb>();
        let conn = lock(&db)?;
        let saved: Vec<OpenWindow> = settings::get_value(&conn, OPEN_WINDOWS_KEY)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default();
        let mut live = Vec::new();
        for window in saved {
            if exists(&conn, &window.id)? {
                live.push(window);
            }
        }
        live
    };
    for window in saved {
        let position = on_screen(app, window.x, window.y).then_some((window.x, window.y));
        open_window(app, &window.id, position, restored_size(&window), false)?;
    }
    Ok(())
}

fn restored_size(window: &OpenWindow) -> Option<(f64, f64)> {
    match (window.width, window.height) {
        (Some(width), Some(height)) if height >= MIN_RESTORED_HEIGHT => Some((width, height)),
        _ => None,
    }
}

pub fn on_window_closed(app: &AppHandle, id: &str) {
    if app.state::<Exiting>().0.load(Ordering::SeqCst) {
        return;
    }
    if let Err(err) = discard_blank(app, &[id.to_string()]) {
        eprintln!("Could not clean up memo {id}: {err}");
    }
    save_open_windows(app, &[id.to_string()]);
}

/// Called when the main window closes, just before the app quits.
pub fn on_app_exit(app: &AppHandle) {
    app.state::<Exiting>().0.store(true, Ordering::SeqCst);
    let open = open_ids(app);
    let discarded = discard_blank(app, &open).unwrap_or_default();
    save_open_windows(app, &discarded);
}

/// `size` is a size the user set by hand; without it the window uses the size setting.
fn open_window(
    app: &AppHandle,
    id: &str,
    position: Option<(f64, f64)>,
    size: Option<(f64, f64)>,
    focus: bool,
) -> Result<(), String> {
    let label = format!("{LABEL_PREFIX}{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show().map_err(|err| err.to_string())?;
        return window.set_focus().map_err(|err| err.to_string());
    }
    let (width, height) = match size {
        Some(size) => size,
        None => {
            let db = app.state::<AppDb>();
            let conn = lock(&db)?;
            settings::memo_window_size(&conn)?
        }
    };
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Memo")
        .inner_size(width, height)
        .min_inner_size(200.0, 40.0)
        .decorations(false)
        .focused(focus);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    builder.build().map_err(|err| err.to_string())?;
    save_open_windows(app, &[]);
    Ok(())
}

fn open_ids(app: &AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter_map(|label| memo_id(label))
        .map(str::to_string)
        .collect()
}

/// Reuses an open blank memo so repeated shortcuts do not stack empty windows.
fn blank_or_new(app: &AppHandle) -> Result<String, String> {
    let open = open_ids(app);
    let db = app.state::<AppDb>();
    let conn = lock(&db)?;
    for id in open {
        if is_blank(&conn, &id)? {
            return Ok(id);
        }
    }
    Ok(documents::create_kind(&conn, "memo")?.id)
}

/// Removes memos that were closed without any text or attachment. Returns their ids.
fn discard_blank(app: &AppHandle, ids: &[String]) -> Result<Vec<String>, String> {
    let dir = assets_dir(app)?;
    let db = app.state::<AppDb>();
    let conn = lock(&db)?;
    let mut discarded = Vec::new();
    for id in ids {
        if discard_if_blank(&conn, &dir, id)? {
            discarded.push(id.clone());
        }
    }
    Ok(discarded)
}

fn save_open_windows(app: &AppHandle, skip: &[String]) {
    let windows: Vec<OpenWindow> = app
        .webview_windows()
        .iter()
        .filter_map(|(label, window)| {
            let id = memo_id(label)?;
            if skip.iter().any(|skipped| skipped == id) {
                return None;
            }
            let scale = window.scale_factor().ok()?;
            let position = window.outer_position().ok()?.to_logical::<f64>(scale);
            let size = window.inner_size().ok()?.to_logical::<f64>(scale);
            Some(OpenWindow {
                id: id.to_string(),
                x: position.x,
                y: position.y,
                width: Some(size.width),
                height: Some(size.height),
            })
        })
        .collect();
    let Ok(json) = serde_json::to_string(&windows) else {
        return;
    };
    let db = app.state::<AppDb>();
    let saved = lock(&db).and_then(|conn| settings::set_value(&conn, OPEN_WINDOWS_KEY, Some(&json)));
    if let Err(err) = saved {
        eprintln!("Could not remember open memo windows: {err}");
    }
}

fn on_screen(app: &AppHandle, x: f64, y: f64) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return false;
    };
    monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        let origin = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        // Keep at least a grabbable corner of the window on this screen.
        x >= origin.x && y >= origin.y && x < origin.x + size.width - 40.0 && y < origin.y + size.height - 40.0
    })
}

fn exists(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM documents WHERE id = ?1 AND kind = 'memo' AND deleted_at IS NULL",
        [id],
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(|err| err.to_string())
}

fn is_blank(conn: &Connection, id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT TRIM(body) = '' AND NOT EXISTS (SELECT 1 FROM assets WHERE document_id = ?1)
         FROM documents
         WHERE id = ?1 AND kind = 'memo' AND deleted_at IS NULL",
        [id],
        |row| row.get::<_, bool>(0),
    )
    .optional()
    .map(|blank| blank.unwrap_or(false))
    .map_err(|err| err.to_string())
}

/// A blank memo that never reached the timeline is removed outright; one that was
/// cleared later is marked deleted so its history stays.
fn discard_if_blank(conn: &Connection, assets_dir: &Path, id: &str) -> Result<bool, String> {
    if !is_blank(conn, id)? {
        return Ok(false);
    }
    let versions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM document_versions WHERE document_id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    if versions == 0 {
        conn.execute("DELETE FROM documents WHERE id = ?1", [id])
            .map_err(|err| err.to_string())?;
    } else {
        documents::soft_delete(conn, assets_dir, id)?;
    }
    Ok(true)
}

/// Deletes memos that have not changed for longer than the retention setting, when it is on.
pub(crate) fn purge_expired(conn: &Connection, assets_dir: &Path) -> Result<usize, String> {
    let Some(days) = settings::memo_retention_days(conn)? else {
        return Ok(0);
    };
    purge_older_than(conn, assets_dir, now_ms() - i64::from(days) * DAY_MS)
}

fn purge_older_than(conn: &Connection, assets_dir: &Path, cutoff: i64) -> Result<usize, String> {
    let ids = {
        let mut statement = conn
            .prepare(
                "SELECT id FROM documents
                 WHERE kind = 'memo' AND deleted_at IS NULL AND updated_at < ?1",
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([cutoff], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())?
    };
    for id in &ids {
        documents::soft_delete(conn, assets_dir, id)?;
    }
    Ok(ids.len())
}

fn list(conn: &Connection) -> Result<Vec<MemoSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, title, body, color, updated_at
             FROM documents
             WHERE kind = 'memo' AND deleted_at IS NULL
             ORDER BY updated_at DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let body: String = row.get(2)?;
            Ok(MemoSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                preview: preview(&body),
                color: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn get(conn: &Connection, assets_dir: &Path, id: &str) -> Result<Option<Memo>, String> {
    let row = conn
        .query_row(
            "SELECT id, title, body, color, updated_at
             FROM documents
             WHERE id = ?1 AND kind = 'memo' AND deleted_at IS NULL",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((id, title, body, color, updated_at)) = row else {
        return Ok(None);
    };
    let assets = assets::list(conn, assets_dir, &id)?;
    Ok(Some(Memo {
        id,
        title,
        body,
        color,
        updated_at,
        assets,
    }))
}

fn update_body(conn: &Connection, id: &str, body: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE documents SET body = ?1, updated_at = ?2
             WHERE id = ?3 AND kind = 'memo' AND deleted_at IS NULL",
            params![body, now_ms(), id],
        )
        .map_err(|err| err.to_string())?;
    if changed == 0 {
        return Err("Memo not found".to_string());
    }
    Ok(())
}

fn set_color(conn: &Connection, id: &str, color: Option<&str>) -> Result<(), String> {
    if let Some(color) = color {
        if !COLORS.contains(&color) {
            return Err(format!("Unknown memo color \"{color}\""));
        }
    }
    let changed = conn
        .execute(
            "UPDATE documents SET color = ?1
             WHERE id = ?2 AND kind = 'memo' AND deleted_at IS NULL",
            params![color, id],
        )
        .map_err(|err| err.to_string())?;
    if changed == 0 {
        return Err("Memo not found".to_string());
    }
    Ok(())
}

fn preview(body: &str) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if line.starts_with("![") {
        return "Image".to_string();
    }
    line.trim_start_matches(['#', '>', '-', '*', ' '])
        .chars()
        .take(PREVIEW_CHARS)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::db::migrate;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn body_updates_keep_the_title() {
        let conn = test_db();
        let memo = documents::create_kind(&conn, "memo").unwrap();
        documents::update(&conn, &memo.id, "Named", "old").unwrap();
        update_body(&conn, &memo.id, "# New line\nmore").unwrap();
        let assets = std::env::temp_dir().join("eyja-unused-assets");
        let loaded = get(&conn, &assets, &memo.id).unwrap().unwrap();
        assert_eq!(loaded.title, "Named");
        assert_eq!(loaded.body, "# New line\nmore");
        assert_eq!(list(&conn).unwrap()[0].preview, "New line");
    }

    #[test]
    fn notes_are_not_memos() {
        let conn = test_db();
        let note = documents::create(&conn).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(update_body(&conn, &note.id, "x").is_err());
        assert!(set_color(&conn, &note.id, Some("blue")).is_err());
    }

    #[test]
    fn colors_are_checked() {
        let conn = test_db();
        let memo = documents::create_kind(&conn, "memo").unwrap();
        set_color(&conn, &memo.id, Some("green")).unwrap();
        assert_eq!(list(&conn).unwrap()[0].color.as_deref(), Some("green"));
        assert!(set_color(&conn, &memo.id, Some("orange")).is_err());
        set_color(&conn, &memo.id, None).unwrap();
        assert_eq!(list(&conn).unwrap()[0].color, None);
    }

    #[test]
    fn expired_memos_lose_their_files_but_keep_the_text() {
        let conn = test_db();
        let root = std::env::temp_dir().join(format!("eyja-memo-purge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let assets_dir = root.join("assets");
        fs::create_dir_all(assets_dir.join("a1")).unwrap();
        fs::write(assets_dir.join("a1").join("file.txt"), b"x").unwrap();

        let old = documents::create_kind(&conn, "memo").unwrap();
        let fresh = documents::create_kind(&conn, "memo").unwrap();
        conn.execute(
            "UPDATE documents SET updated_at = 10, body = 'kept' WHERE id = ?1",
            [&old.id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets (id, document_id, mime, relative_path, created_at)
             VALUES ('a1', ?1, 'text/plain', 'a1/file.txt', 1)",
            [&old.id],
        )
        .unwrap();

        assert_eq!(purge_older_than(&conn, &assets_dir, 100).unwrap(), 1);
        let remaining: Vec<String> = list(&conn).unwrap().into_iter().map(|memo| memo.id).collect();
        assert_eq!(remaining, vec![fresh.id]);
        assert!(!assets_dir.join("a1").exists());
        let body: String = conn
            .query_row("SELECT body FROM documents WHERE id = ?1", [&old.id], |row| row.get(0))
            .unwrap();
        assert_eq!(body, "kept");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn closing_a_blank_memo_discards_it() {
        let conn = test_db();
        let assets = std::env::temp_dir().join("eyja-unused-assets");
        let blank = documents::create_kind(&conn, "memo").unwrap();
        let written = documents::create_kind(&conn, "memo").unwrap();
        update_body(&conn, &written.id, "keep me").unwrap();
        let attached = documents::create_kind(&conn, "memo").unwrap();
        conn.execute(
            "INSERT INTO assets (id, document_id, mime, relative_path, created_at)
             VALUES ('a1', ?1, 'application/pdf', 'a1/x.pdf', 1)",
            [&attached.id],
        )
        .unwrap();

        assert!(discard_if_blank(&conn, &assets, &blank.id).unwrap());
        assert!(!discard_if_blank(&conn, &assets, &written.id).unwrap());
        assert!(!discard_if_blank(&conn, &assets, &attached.id).unwrap());
        let gone: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents WHERE id = ?1", [&blank.id], |row| row.get(0))
            .unwrap();
        assert_eq!(gone, 0);
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn restored_windows_keep_a_hand_tuned_size() {
        let saved: Vec<OpenWindow> = serde_json::from_str(
            r#"[{"id":"a","x":1,"y":2,"width":500,"height":420},
                {"id":"b","x":1,"y":2,"width":500,"height":40},
                {"id":"c","x":1,"y":2}]"#,
        )
        .unwrap();
        assert_eq!(restored_size(&saved[0]), Some((500.0, 420.0)));
        assert_eq!(restored_size(&saved[1]), None);
        assert_eq!(restored_size(&saved[2]), None);
    }

    #[test]
    fn retention_is_off_by_default() {
        let conn = test_db();
        let memo = documents::create_kind(&conn, "memo").unwrap();
        conn.execute("UPDATE documents SET updated_at = 1 WHERE id = ?1", [&memo.id])
            .unwrap();
        let assets = std::env::temp_dir().join("eyja-unused-assets");
        assert_eq!(purge_expired(&conn, &assets).unwrap(), 0);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }
}
