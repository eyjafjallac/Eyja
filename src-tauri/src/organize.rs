//! Tags, folders, pins, favorites and covers: how documents are sorted in the library.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::db::{now_ms, AppDb};
use crate::settings;

const MAX_TAG_CHARS: usize = 40;
const MAX_FOLDER_CHARS: usize = 80;
/// Guards the parent walk against a broken chain in the database.
const MAX_FOLDER_DEPTH: usize = 256;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: i64,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

fn sql(err: rusqlite::Error) -> String {
    err.to_string()
}

#[tauri::command]
pub fn list_tags(db: State<AppDb>) -> Result<Vec<TagCount>, String> {
    let conn = lock(&db)?;
    tag_counts(&conn)
}

/// Replaces the document's tags. Returns them as stored, so an existing tag keeps its spelling.
#[tauri::command]
pub fn set_document_tags(db: State<AppDb>, id: String, tags: Vec<String>) -> Result<Vec<String>, String> {
    let conn = lock(&db)?;
    let limit = settings::max_tags(&conn)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let stored = set_tags(&tx, &id, &tags, limit)?;
    tx.commit().map_err(sql)?;
    Ok(stored)
}

#[tauri::command]
pub fn list_folders(db: State<AppDb>) -> Result<Vec<Folder>, String> {
    let conn = lock(&db)?;
    folders(&conn)
}

#[tauri::command]
pub fn create_folder(db: State<AppDb>, name: String, parent_id: Option<String>) -> Result<Folder, String> {
    let conn = lock(&db)?;
    new_folder(&conn, &name, parent_id.as_deref())
}

#[tauri::command]
pub fn rename_folder(db: State<AppDb>, id: String, name: String) -> Result<(), String> {
    let conn = lock(&db)?;
    rename(&conn, &id, &name)
}

#[tauri::command]
pub fn move_folder(db: State<AppDb>, id: String, parent_id: Option<String>) -> Result<(), String> {
    let conn = lock(&db)?;
    reparent(&conn, &id, parent_id.as_deref())
}

/// Its documents and sub-folders move up to the parent; nothing is deleted with it.
#[tauri::command]
pub fn delete_folder(db: State<AppDb>, id: String) -> Result<(), String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    remove_folder(&tx, &id)?;
    tx.commit().map_err(sql)
}

#[tauri::command]
pub fn set_document_folder(db: State<AppDb>, id: String, folder_id: Option<String>) -> Result<(), String> {
    let conn = lock(&db)?;
    set_folder(&conn, &id, folder_id.as_deref())
}

#[tauri::command]
pub fn set_document_pinned(db: State<AppDb>, id: String, pinned: bool) -> Result<(), String> {
    let conn = lock(&db)?;
    set_pinned(&conn, &id, pinned)
}

#[tauri::command]
pub fn set_document_favorite(db: State<AppDb>, id: String, favorite: bool) -> Result<(), String> {
    let conn = lock(&db)?;
    let changed = conn
        .execute(
            "UPDATE documents SET favorite = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![favorite, id],
        )
        .map_err(sql)?;
    found(changed)
}

/// The cover is one of the document's own images, or none.
#[tauri::command]
pub fn set_document_cover(db: State<AppDb>, id: String, asset_id: Option<String>) -> Result<(), String> {
    let conn = lock(&db)?;
    set_cover(&conn, &id, asset_id.as_deref())
}

fn found(changed: usize) -> Result<(), String> {
    if changed == 0 {
        return Err("Document not found".to_string());
    }
    Ok(())
}

pub(crate) fn normalize_tag(raw: &str) -> Option<String> {
    let words: Vec<&str> = raw.trim().trim_start_matches('#').split_whitespace().collect();
    let name: String = words.join("-").chars().take(MAX_TAG_CHARS).collect();
    (!name.is_empty()).then_some(name)
}

pub(crate) fn document_tags(conn: &Connection, id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT t.name FROM document_tags dt
             JOIN tags t ON t.id = dt.tag_id
             WHERE dt.document_id = ?1
             ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(sql)?;
    let rows = statement.query_map([id], |row| row.get(0)).map_err(sql)?;
    rows.collect::<Result<Vec<String>, _>>().map_err(sql)
}

fn tag_counts(conn: &Connection) -> Result<Vec<TagCount>, String> {
    let mut statement = conn
        .prepare(
            "SELECT t.name, COUNT(d.id)
             FROM tags t
             JOIN document_tags dt ON dt.tag_id = t.id
             JOIN documents d ON d.id = dt.document_id AND d.deleted_at IS NULL
             GROUP BY t.id
             ORDER BY t.name COLLATE NOCASE",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| {
            Ok(TagCount {
                name: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql)
}

/// Tags are flat names, matched without regard to case. A document already over a lowered
/// limit keeps its tags, but cannot gain more.
pub(crate) fn set_tags(conn: &Connection, id: &str, tags: &[String], limit: u32) -> Result<Vec<String>, String> {
    require_document(conn, id)?;
    let mut seen = HashSet::new();
    let names: Vec<String> = tags
        .iter()
        .filter_map(|tag| normalize_tag(tag))
        .filter(|name| seen.insert(name.to_lowercase()))
        .collect();
    let current = document_tags(conn, id)?.len();
    if names.len() > limit as usize && names.len() > current {
        return Err(format!("A document can have at most {limit} tags."));
    }
    conn.execute("DELETE FROM document_tags WHERE document_id = ?1", [id])
        .map_err(sql)?;
    for name in &names {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                [name],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?;
        let tag_id = match existing {
            Some(tag_id) => tag_id,
            None => {
                let tag_id = Uuid::new_v4().to_string();
                conn.execute("INSERT INTO tags (id, name) VALUES (?1, ?2)", params![tag_id, name])
                    .map_err(sql)?;
                tag_id
            }
        };
        conn.execute(
            "INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?1, ?2)",
            params![id, tag_id],
        )
        .map_err(sql)?;
    }
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM document_tags)", [])
        .map_err(sql)?;
    document_tags(conn, id)
}

fn require_document(conn: &Connection, id: &str) -> Result<(), String> {
    conn.query_row(
        "SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |_| Ok(()),
    )
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "Document not found".to_string())
}

pub(crate) fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<(), String> {
    let pinned_at = pinned.then(now_ms);
    let changed = conn
        .execute(
            "UPDATE documents SET pinned_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![pinned_at, id],
        )
        .map_err(sql)?;
    found(changed)
}

fn set_cover(conn: &Connection, id: &str, asset_id: Option<&str>) -> Result<(), String> {
    if let Some(asset_id) = asset_id {
        let mime: Option<String> = conn
            .query_row(
                "SELECT mime FROM assets WHERE id = ?1 AND document_id = ?2",
                params![asset_id, id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?;
        match mime {
            Some(mime) if mime.starts_with("image/") => {}
            Some(_) => return Err("Only an image can be a cover.".to_string()),
            None => return Err("Pick an image from this document.".to_string()),
        }
    }
    let changed = conn
        .execute(
            "UPDATE documents SET cover_asset_id = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![asset_id, id],
        )
        .map_err(sql)?;
    found(changed)
}

fn folders(conn: &Connection) -> Result<Vec<Folder>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, parent_id, created_at FROM folders
             ORDER BY name COLLATE NOCASE, created_at",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql)
}

fn folder_name(raw: &str) -> Result<String, String> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err("A folder needs a name.".to_string());
    }
    Ok(name.chars().take(MAX_FOLDER_CHARS).collect())
}

fn require_folder(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT parent_id FROM folders WHERE id = ?1", [id], |row| {
        row.get::<_, Option<String>>(0)
    })
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "Folder not found".to_string())
}

/// Sibling folders cannot share a name, so the tree stays readable.
fn check_unique(conn: &Connection, name: &str, parent_id: Option<&str>, skip: Option<&str>) -> Result<(), String> {
    let taken: bool = conn
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM folders
                WHERE name = ?1 COLLATE NOCASE
                  AND parent_id IS ?2
                  AND id IS NOT ?3
             )",
            params![name, parent_id, skip],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if taken {
        return Err(format!("There is already a folder named \"{name}\" here."));
    }
    Ok(())
}

pub(crate) fn new_folder(conn: &Connection, raw: &str, parent_id: Option<&str>) -> Result<Folder, String> {
    let name = folder_name(raw)?;
    if let Some(parent_id) = parent_id {
        require_folder(conn, parent_id)?;
    }
    check_unique(conn, &name, parent_id, None)?;
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name,
        parent_id: parent_id.map(str::to_string),
        created_at: now_ms(),
    };
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![folder.id, folder.name, folder.parent_id, folder.created_at],
    )
    .map_err(sql)?;
    Ok(folder)
}

fn rename(conn: &Connection, id: &str, raw: &str) -> Result<(), String> {
    let name = folder_name(raw)?;
    let parent_id = require_folder(conn, id)?;
    check_unique(conn, &name, parent_id.as_deref(), Some(id))?;
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(sql)?;
    Ok(())
}

pub(crate) fn reparent(conn: &Connection, id: &str, parent_id: Option<&str>) -> Result<(), String> {
    require_folder(conn, id)?;
    let mut cursor = parent_id.map(str::to_string);
    for _ in 0..MAX_FOLDER_DEPTH {
        let Some(current) = cursor else {
            break;
        };
        if current == id {
            return Err("A folder cannot go inside itself.".to_string());
        }
        cursor = require_folder(conn, &current)?;
    }
    let name: String = conn
        .query_row("SELECT name FROM folders WHERE id = ?1", [id], |row| row.get(0))
        .map_err(sql)?;
    check_unique(conn, &name, parent_id, Some(id))?;
    conn.execute("UPDATE folders SET parent_id = ?1 WHERE id = ?2", params![parent_id, id])
        .map_err(sql)?;
    Ok(())
}

pub(crate) fn remove_folder(conn: &Connection, id: &str) -> Result<(), String> {
    let parent_id = require_folder(conn, id)?;
    conn.execute(
        "UPDATE documents SET folder_id = ?1 WHERE folder_id = ?2",
        params![parent_id, id],
    )
    .map_err(sql)?;
    let children: Vec<(String, String)> = {
        let mut statement = conn
            .prepare("SELECT id, name FROM folders WHERE parent_id = ?1")
            .map_err(sql)?;
        let rows = statement
            .query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(sql)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql)?
    };
    for (child, name) in children {
        // A moved-up child that clashes with a sibling gets a suffix instead of failing.
        let mut candidate = name.clone();
        let mut suffix = 2;
        while check_unique(conn, &candidate, parent_id.as_deref(), Some(&child)).is_err() {
            candidate = format!("{name} ({suffix})");
            suffix += 1;
        }
        conn.execute(
            "UPDATE folders SET parent_id = ?1, name = ?2 WHERE id = ?3",
            params![parent_id, candidate, child],
        )
        .map_err(sql)?;
    }
    conn.execute("DELETE FROM folders WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

pub(crate) fn set_folder(conn: &Connection, id: &str, folder_id: Option<&str>) -> Result<(), String> {
    if let Some(folder_id) = folder_id {
        require_folder(conn, folder_id)?;
    }
    let changed = conn
        .execute(
            "UPDATE documents SET folder_id = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![folder_id, id],
        )
        .map_err(sql)?;
    found(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::documents::{create, create_kind, get, soft_delete};

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        conn
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn tags_are_flat_shared_and_case_insensitive() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        let memo = create_kind(&conn, "memo").unwrap();
        let stored = set_tags(&conn, &note.id, &strings(&["#Math", " homework ", "math"]), 5).unwrap();
        assert_eq!(stored, strings(&["homework", "Math"]));
        let stored = set_tags(&conn, &memo.id, &strings(&["MATH", "quick idea"]), 5).unwrap();
        assert_eq!(stored, strings(&["Math", "quick-idea"]));
        assert_eq!(
            tag_counts(&conn).unwrap(),
            vec![
                TagCount { name: "homework".into(), count: 1 },
                TagCount { name: "Math".into(), count: 2 },
                TagCount { name: "quick-idea".into(), count: 1 },
            ]
        );
        assert_eq!(get(&conn, &memo.id).unwrap().unwrap().tags, strings(&["Math", "quick-idea"]));

        set_tags(&conn, &memo.id, &[], 5).unwrap();
        let names: Vec<String> = tag_counts(&conn).unwrap().into_iter().map(|tag| tag.name).collect();
        assert_eq!(names, strings(&["homework", "Math"]));
    }

    #[test]
    fn tag_limit_blocks_growth_but_keeps_existing_tags() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        set_tags(&conn, &note.id, &strings(&["a", "b", "c"]), 5).unwrap();
        assert!(set_tags(&conn, &note.id, &strings(&["a", "b", "c", "d"]), 3).is_err());
        assert_eq!(set_tags(&conn, &note.id, &strings(&["a", "b", "c"]), 2).unwrap().len(), 3);
        assert_eq!(set_tags(&conn, &note.id, &strings(&["a", "b"]), 2).unwrap().len(), 2);
    }

    #[test]
    fn deleted_documents_drop_out_of_tag_counts() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        set_tags(&conn, &note.id, &strings(&["gone"]), 5).unwrap();
        soft_delete(&conn, &std::env::temp_dir().join("eyja-unused-assets"), &note.id).unwrap();
        assert!(tag_counts(&conn).unwrap().is_empty());
    }

    #[test]
    fn folders_nest_without_cycles() {
        let conn = test_db();
        let math = new_folder(&conn, "Math", None).unwrap();
        let algebra = new_folder(&conn, "  Linear   algebra ", Some(&math.id)).unwrap();
        assert_eq!(algebra.name, "Linear algebra");
        assert!(new_folder(&conn, "math", None).is_err());
        assert!(new_folder(&conn, "Math", Some(&math.id)).is_ok());
        assert!(reparent(&conn, &math.id, Some(&algebra.id)).is_err());
        assert!(reparent(&conn, &math.id, Some(&math.id)).is_err());
        reparent(&conn, &algebra.id, None).unwrap();
        assert_eq!(require_folder(&conn, &algebra.id).unwrap(), None);
    }

    #[test]
    fn deleting_a_folder_moves_its_contents_up() {
        let conn = test_db();
        let top = new_folder(&conn, "Top", None).unwrap();
        let middle = new_folder(&conn, "Middle", Some(&top.id)).unwrap();
        let inner = new_folder(&conn, "Inner", Some(&middle.id)).unwrap();
        new_folder(&conn, "Inner", Some(&top.id)).unwrap();
        let note = create(&conn).unwrap();
        set_folder(&conn, &note.id, Some(&middle.id)).unwrap();

        remove_folder(&conn, &middle.id).unwrap();
        assert_eq!(get(&conn, &note.id).unwrap().unwrap().folder_id, Some(top.id.clone()));
        let moved = folders(&conn).unwrap().into_iter().find(|folder| folder.id == inner.id).unwrap();
        assert_eq!(moved.parent_id, Some(top.id));
        assert_eq!(moved.name, "Inner (2)");
    }

    #[test]
    fn cover_must_be_an_image_of_the_same_document() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        let other = create(&conn).unwrap();
        for (id, owner, mime) in [("img", &note.id, "image/png"), ("pdf", &note.id, "application/pdf"), ("theirs", &other.id, "image/png")] {
            conn.execute(
                "INSERT INTO assets (id, document_id, mime, relative_path, created_at)
                 VALUES (?1, ?2, ?3, ?1, 0)",
                params![id, owner, mime],
            )
            .unwrap();
        }
        assert!(set_cover(&conn, &note.id, Some("pdf")).is_err());
        assert!(set_cover(&conn, &note.id, Some("theirs")).is_err());
        set_cover(&conn, &note.id, Some("img")).unwrap();
        assert_eq!(get(&conn, &note.id).unwrap().unwrap().cover_asset_id.as_deref(), Some("img"));
        set_cover(&conn, &note.id, None).unwrap();
        assert!(get(&conn, &note.id).unwrap().unwrap().cover_asset_id.is_none());
    }
}
