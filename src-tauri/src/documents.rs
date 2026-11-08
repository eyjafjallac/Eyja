use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::assets;
use crate::db::{assets_dir, now_ms, AppDb};
use crate::links;
use crate::organize;

const PREVIEW_CHARS: usize = 140;
/// Only the start of each body is read for list previews.
const PREVIEW_SOURCE_CHARS: i64 = 2000;

/// One row of the library: notes and memos together.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub preview: String,
    pub color: Option<String>,
    pub folder_id: Option<String>,
    pub pinned: bool,
    pub favorite: bool,
    /// Absolute path of the cover image, when one is set and still on record.
    pub cover_path: Option<String>,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub color: Option<String>,
    pub folder_id: Option<String>,
    pub pinned: bool,
    pub favorite: bool,
    pub cover_asset_id: Option<String>,
    pub tags: Vec<String>,
    pub updated_at: i64,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_documents(app: AppHandle, db: State<AppDb>) -> Result<Vec<DocumentSummary>, String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    list(&conn, &dir)
}

#[tauri::command]
pub fn get_document(db: State<AppDb>, id: String) -> Result<Note, String> {
    let conn = lock(&db)?;
    get(&conn, &id)?.ok_or_else(|| "Note not found".to_string())
}

#[tauri::command]
pub fn create_document(db: State<AppDb>, folder_id: Option<String>) -> Result<Note, String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    let note = create(&tx)?;
    if folder_id.is_some() {
        organize::set_folder(&tx, &note.id, folder_id.as_deref())?;
    }
    let note = get(&tx, &note.id)?.ok_or_else(|| "Note not found".to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(note)
}

#[tauri::command]
pub fn update_document(
    db: State<AppDb>,
    id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    update(&tx, &id, &title, &body)?;
    tx.commit().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_document(app: AppHandle, db: State<AppDb>, id: String) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    soft_delete(&conn, &dir, &id)
}

/// Pinned documents first, newest pin first; then by last change.
pub(crate) fn list(conn: &Connection, assets_dir: &Path) -> Result<Vec<DocumentSummary>, String> {
    let mut tags = tags_by_document(conn)?;
    let mut statement = conn
        .prepare(
            "SELECT d.id, d.kind, d.title, substr(d.body, 1, ?1), d.color, d.folder_id,
                    d.pinned_at IS NOT NULL, d.favorite, a.relative_path,
                    d.created_at, d.updated_at
             FROM documents d
             LEFT JOIN assets a ON a.id = d.cover_asset_id AND a.document_id = d.id
             WHERE d.deleted_at IS NULL
             ORDER BY d.pinned_at IS NULL, d.pinned_at DESC, d.updated_at DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([PREVIEW_SOURCE_CHARS], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    let mut list = Vec::new();
    for row in rows {
        let (id, kind, title, body, color, folder_id, pinned, favorite, cover, created_at, updated_at) =
            row.map_err(|err| err.to_string())?;
        let cover_path = cover
            .and_then(|relative| assets::safe_join(assets_dir, &relative).ok())
            .map(|path| path.to_string_lossy().into_owned());
        list.push(DocumentSummary {
            tags: tags.remove(&id).unwrap_or_default(),
            preview: preview(&body, PREVIEW_CHARS),
            id,
            kind,
            title,
            color,
            folder_id,
            pinned,
            favorite,
            cover_path,
            created_at,
            updated_at,
        });
    }
    Ok(list)
}

fn tags_by_document(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut statement = conn
        .prepare(
            "SELECT dt.document_id, t.name
             FROM document_tags dt
             JOIN tags t ON t.id = dt.tag_id
             ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|err| err.to_string())?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (id, name) = row.map_err(|err| err.to_string())?;
        map.entry(id).or_default().push(name);
    }
    Ok(map)
}

/// Reads a note or a memo; both open in the editor.
pub(crate) fn get(conn: &Connection, id: &str) -> Result<Option<Note>, String> {
    let note = conn
        .query_row(
            "SELECT id, kind, title, body, color, folder_id, pinned_at IS NOT NULL, favorite,
                    cover_asset_id, updated_at
             FROM documents
             WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    title: row.get(2)?,
                    body: row.get(3)?,
                    color: row.get(4)?,
                    folder_id: row.get(5)?,
                    pinned: row.get(6)?,
                    favorite: row.get(7)?,
                    cover_asset_id: row.get(8)?,
                    tags: Vec::new(),
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(mut note) = note else {
        return Ok(None);
    };
    note.tags = organize::document_tags(conn, id)?;
    Ok(Some(note))
}

pub(crate) fn create(conn: &Connection) -> Result<Note, String> {
    create_kind(conn, "note")
}

pub(crate) fn create_kind(conn: &Connection, kind: &str) -> Result<Note, String> {
    let now = now_ms();
    let note = Note {
        id: Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        title: String::new(),
        body: String::new(),
        color: None,
        folder_id: None,
        pinned: false,
        favorite: false,
        cover_asset_id: None,
        tags: Vec::new(),
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO documents (
            id, kind, title, body, favorite, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
        params![note.id, note.kind, note.title, note.body, now],
    )
    .map_err(|err| err.to_string())?;
    Ok(note)
}

pub(crate) fn update(conn: &Connection, id: &str, title: &str, body: &str) -> Result<(), String> {
    let old_title: Option<String> = conn
        .query_row(
            "SELECT title FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(old_title) = old_title else {
        return Err("Note not found".to_string());
    };
    conn.execute(
        "UPDATE documents
         SET title = ?1, body = ?2, updated_at = ?3
         WHERE id = ?4 AND deleted_at IS NULL",
        params![title, body, now_ms(), id],
    )
    .map_err(|err| err.to_string())?;
    links::sync_document(conn, id)?;
    if old_title.trim() != title.trim() {
        links::sync_title_change(conn, id, &old_title, title)?;
    }
    Ok(())
}

/// Marks the document deleted. A memo's copied files and folders also leave the disk;
/// a note keeps its images.
pub(crate) fn soft_delete(conn: &Connection, assets_dir: &Path, id: &str) -> Result<(), String> {
    let kind: Option<String> = conn
        .query_row(
            "SELECT kind FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some(kind) = kind else {
        return Err("Note not found".to_string());
    };
    let now = now_ms();
    conn.execute(
        "UPDATE documents SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|err| err.to_string())?;
    if kind == "memo" {
        assets::remove_document_files(conn, assets_dir, id)?;
    }
    Ok(())
}

/// Removes a document that never reached the timeline, with every row that points at it.
pub(crate) fn hard_delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute_batch("SAVEPOINT hard_delete")
        .map_err(|err| err.to_string())?;
    let result = (|| {
        conn.execute("DELETE FROM document_tags WHERE document_id = ?1", [id])?;
        conn.execute("DELETE FROM links WHERE source_id = ?1 OR target_id = ?1", [id])?;
        conn.execute("DELETE FROM document_vectors WHERE document_id = ?1", [id])?;
        conn.execute("DELETE FROM document_vector_state WHERE document_id = ?1", [id])?;
        conn.execute("DELETE FROM documents WHERE id = ?1", [id])?;
        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM document_tags)", [])
    })();
    match result {
        Ok(_) => conn
            .execute_batch("RELEASE hard_delete")
            .map_err(|err| err.to_string()),
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK TO hard_delete; RELEASE hard_delete");
            Err(err.to_string())
        }
    }
}

/// The first line with text, without Markdown markers. Images read as "Image".
pub(crate) fn preview(body: &str, max_chars: usize) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("```") && !line.starts_with("$$"))
        .unwrap_or("");
    if line.starts_with("![") {
        return "Image".to_string();
    }
    strip_color_spans(line.trim_start_matches(['#', '>', '-', '*', ' ']))
        .chars()
        .take(max_chars)
        .collect()
}

/// Coloured words, `[words]{.red}` or `[words]{color="#3b82f6"}`, read as `words`.
fn strip_color_spans(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let span = after.find("]{").and_then(|close| {
            let inner = &after[..close];
            let attrs = &after[close + 2..];
            let end = attrs.find('}')?;
            let attr = &attrs[..end];
            let colored = !inner.is_empty()
                && !inner.contains(['[', ']'])
                && (attr.starts_with('.') || attr.starts_with("color="));
            colored.then_some((inner, close + 2 + end + 1))
        });
        match span {
            Some((inner, used)) => {
                out.push_str(inner);
                rest = &after[used..];
            }
            None => {
                out.push('[');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn unused_assets() -> std::path::PathBuf {
        std::env::temp_dir().join("eyja-unused-assets")
    }

    #[test]
    fn create_update_and_soft_delete() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        assert_eq!(list(&conn, &unused_assets()).unwrap().len(), 1);

        update(&conn, &note.id, "Hello", "Body").unwrap();
        let loaded = get(&conn, &note.id).unwrap().unwrap();
        assert_eq!(loaded.title, "Hello");
        assert_eq!(loaded.body, "Body");
        assert_eq!(loaded.kind, "note");

        soft_delete(&conn, &unused_assets(), &note.id).unwrap();
        assert!(list(&conn, &unused_assets()).unwrap().is_empty());
        assert!(get(&conn, &note.id).unwrap().is_none());
    }

    #[test]
    fn memos_open_like_notes_and_list_with_their_kind() {
        let conn = test_db();
        let memo = create_kind(&conn, "memo").unwrap();
        update(&conn, &memo.id, "", "Quick").unwrap();
        let loaded = get(&conn, &memo.id).unwrap().unwrap();
        assert_eq!(loaded.kind, "memo");
        assert_eq!(loaded.body, "Quick");
        let listed = list(&conn, &unused_assets()).unwrap();
        assert_eq!(listed[0].kind, "memo");
        assert_eq!(listed[0].preview, "Quick");
    }

    #[test]
    fn pinned_documents_come_first() {
        let conn = test_db();
        let older = create(&conn).unwrap();
        let newer = create(&conn).unwrap();
        conn.execute("UPDATE documents SET updated_at = 1 WHERE id = ?1", [&older.id])
            .unwrap();
        conn.execute("UPDATE documents SET updated_at = 2 WHERE id = ?1", [&newer.id])
            .unwrap();
        assert_eq!(list(&conn, &unused_assets()).unwrap()[0].id, newer.id);
        organize::set_pinned(&conn, &older.id, true).unwrap();
        let listed = list(&conn, &unused_assets()).unwrap();
        assert_eq!(listed[0].id, older.id);
        assert!(listed[0].pinned);
    }

    #[test]
    fn hard_delete_clears_tags_and_links() {
        let conn = test_db();
        let target = create(&conn).unwrap();
        update(&conn, &target.id, "Target", "").unwrap();
        let memo = create_kind(&conn, "memo").unwrap();
        update(&conn, &memo.id, "", "See [[Target]].").unwrap();
        organize::set_tags(&conn, &memo.id, &["solo".to_string()], 5).unwrap();
        hard_delete(&conn, &memo.id).unwrap();
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |row| row.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM links"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM tags"), 0);
        assert_eq!(count("SELECT COUNT(*) FROM documents"), 1);
    }

    #[test]
    fn previews_skip_markers_and_fences() {
        assert_eq!(preview("\n# Title\nmore", 80), "Title");
        assert_eq!(preview("```rust\nfn main() {}\n```", 80), "fn main() {}");
        assert_eq!(preview("![pic](asset:1)", 80), "Image");
        assert_eq!(
            preview("A [red]{.red} and [blue]{color=\"#3b82f6\"} word", 80),
            "A red and blue word"
        );
        assert_eq!(preview("[[Note]] and [link](x)", 80), "[[Note]] and [link](x)");
    }
}
