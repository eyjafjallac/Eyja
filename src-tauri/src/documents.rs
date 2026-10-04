use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::assets;
use crate::db::{assets_dir, now_ms, AppDb};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
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
    pub updated_at: i64,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_documents(db: State<AppDb>) -> Result<Vec<NoteSummary>, String> {
    let conn = lock(&db)?;
    list(&conn)
}

#[tauri::command]
pub fn get_document(db: State<AppDb>, id: String) -> Result<Note, String> {
    let conn = lock(&db)?;
    get(&conn, &id)?.ok_or_else(|| "Note not found".to_string())
}

#[tauri::command]
pub fn create_document(db: State<AppDb>) -> Result<Note, String> {
    let conn = lock(&db)?;
    create(&conn)
}

#[tauri::command]
pub fn update_document(
    db: State<AppDb>,
    id: String,
    title: String,
    body: String,
) -> Result<(), String> {
    let conn = lock(&db)?;
    update(&conn, &id, &title, &body)
}

#[tauri::command]
pub fn delete_document(app: AppHandle, db: State<AppDb>, id: String) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    soft_delete(&conn, &dir, &id)
}

fn list(conn: &Connection) -> Result<Vec<NoteSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, title, updated_at
             FROM documents
             WHERE deleted_at IS NULL AND kind = 'note'
             ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(NoteSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

/// Reads a note or a memo; both open in the editor.
pub(crate) fn get(conn: &Connection, id: &str) -> Result<Option<Note>, String> {
    conn.query_row(
        "SELECT id, kind, title, body, color, updated_at
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
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|err| err.to_string())
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
    let changed = conn
        .execute(
            "UPDATE documents
             SET title = ?1, body = ?2, updated_at = ?3
             WHERE id = ?4 AND deleted_at IS NULL",
            params![title, body, now_ms(), id],
        )
        .map_err(|err| err.to_string())?;
    if changed == 0 {
        return Err("Note not found".to_string());
    }
    Ok(())
}

/// Marks the document deleted. A memo's copied files and folders also leave the disk;
/// a note keeps its images.
pub(crate) fn soft_delete(conn: &Connection, assets_dir: &std::path::Path, id: &str) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn create_update_and_soft_delete() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);

        update(&conn, &note.id, "Hello", "Body").unwrap();
        let loaded = get(&conn, &note.id).unwrap().unwrap();
        assert_eq!(loaded.title, "Hello");
        assert_eq!(loaded.body, "Body");
        assert_eq!(loaded.kind, "note");

        let assets = std::env::temp_dir().join("eyja-unused-assets");
        soft_delete(&conn, &assets, &note.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(get(&conn, &note.id).unwrap().is_none());
    }

    #[test]
    fn memos_open_like_notes_but_stay_off_the_note_list() {
        let conn = test_db();
        let memo = create_kind(&conn, "memo").unwrap();
        assert!(list(&conn).unwrap().is_empty());
        update(&conn, &memo.id, "", "Quick").unwrap();
        let loaded = get(&conn, &memo.id).unwrap().unwrap();
        assert_eq!(loaded.kind, "memo");
        assert_eq!(loaded.body, "Quick");
    }
}
