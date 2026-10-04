use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

use crate::db::{assets_dir, now_ms, AppDb};

pub const DIRECTORY_MIME: &str = "inode/directory";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub path: String,
    pub is_dir: bool,
}

struct Imported {
    id: String,
    mime: String,
    relative_path: String,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_assets(app: AppHandle, db: State<AppDb>, document_id: String) -> Result<Vec<Asset>, String> {
    let conn = lock(&db)?;
    list(&conn, &assets_dir(&app)?, &document_id)
}

/// Copies files and folders from disk into `assets/`. Folders stay one directory.
#[tauri::command]
pub async fn import_assets(
    app: AppHandle,
    document_id: String,
    paths: Vec<String>,
) -> Result<Vec<Asset>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = assets_dir(&app)?;
        let db = app.state::<AppDb>();
        require_document(&*lock(&db)?, &document_id)?;
        // Copy without holding the database lock; a large folder can take a while.
        let mut imported = Vec::new();
        for path in &paths {
            match import_path(&dir, Path::new(path)) {
                Ok(item) => imported.push(item),
                Err(err) => {
                    for item in &imported {
                        remove_files(&dir, &item.relative_path);
                    }
                    return Err(err);
                }
            }
        }
        let conn = lock(&db)?;
        imported
            .iter()
            .map(|item| insert(&conn, &dir, &document_id, item))
            .collect()
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Saves pasted bytes (for example a screenshot) as a new asset.
#[tauri::command]
pub fn save_asset(
    app: AppHandle,
    db: State<AppDb>,
    document_id: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<Asset, String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    require_document(&conn, &document_id)?;
    let item = import_bytes(&dir, &name, &bytes)?;
    insert(&conn, &dir, &document_id, &item)
}

#[tauri::command]
pub fn remove_asset(app: AppHandle, db: State<AppDb>, id: String) -> Result<(), String> {
    let dir = assets_dir(&app)?;
    let conn = lock(&db)?;
    let relative = relative_path(&conn, &id)?;
    conn.execute("DELETE FROM assets WHERE id = ?1", [&id])
        .map_err(|err| err.to_string())?;
    remove_files(&dir, &relative);
    Ok(())
}

#[tauri::command]
pub fn open_asset(app: AppHandle, db: State<AppDb>, id: String) -> Result<(), String> {
    let path = {
        let conn = lock(&db)?;
        safe_join(&assets_dir(&app)?, &relative_path(&conn, &id)?)?
    };
    if !path.exists() {
        return Err("This file is no longer on disk.".to_string());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

pub(crate) fn list(conn: &Connection, assets_dir: &Path, document_id: &str) -> Result<Vec<Asset>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, mime, relative_path FROM assets
             WHERE document_id = ?1
             ORDER BY created_at, rowid",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([document_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    let mut assets = Vec::new();
    for row in rows {
        let (id, mime, relative) = row.map_err(|err| err.to_string())?;
        assets.push(describe(assets_dir, id, mime, &relative)?);
    }
    Ok(assets)
}

/// Deletes the copied files of a document from disk. The rows stay so the timeline keeps its links.
pub(crate) fn remove_document_files(conn: &Connection, assets_dir: &Path, document_id: &str) -> Result<(), String> {
    let mut statement = conn
        .prepare("SELECT relative_path FROM assets WHERE document_id = ?1")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([document_id], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    for relative in rows {
        remove_files(assets_dir, &relative.map_err(|err| err.to_string())?);
    }
    Ok(())
}

pub(crate) fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Invalid asset path".to_string());
    }
    Ok(base.join(relative_path))
}

fn require_document(conn: &Connection, id: &str) -> Result<(), String> {
    conn.query_row(
        "SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |_| Ok(()),
    )
    .optional()
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "Document not found".to_string())
}

fn relative_path(conn: &Connection, id: &str) -> Result<String, String> {
    conn.query_row("SELECT relative_path FROM assets WHERE id = ?1", [id], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|err| err.to_string())?
    .ok_or_else(|| "Attachment not found".to_string())
}

fn insert(conn: &Connection, assets_dir: &Path, document_id: &str, item: &Imported) -> Result<Asset, String> {
    conn.execute(
        "INSERT INTO assets (id, document_id, mime, relative_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![item.id, document_id, item.mime, item.relative_path, now_ms()],
    )
    .map_err(|err| err.to_string())?;
    describe(assets_dir, item.id.clone(), item.mime.clone(), &item.relative_path)
}

fn describe(assets_dir: &Path, id: String, mime: String, relative: &str) -> Result<Asset, String> {
    let path = safe_join(assets_dir, relative)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| id.clone());
    Ok(Asset {
        is_dir: mime == DIRECTORY_MIME,
        id,
        name,
        mime,
        path: path.to_string_lossy().into_owned(),
    })
}

fn import_path(assets_dir: &Path, source: &Path) -> Result<Imported, String> {
    let meta = fs::metadata(source).map_err(|err| format!("{}: {err}", source.display()))?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("Cannot copy {}", source.display()))?;
    if let (Ok(inner), Ok(root)) = (source.canonicalize(), assets_dir.canonicalize()) {
        if inner.starts_with(&root) || (meta.is_dir() && root.starts_with(&inner)) {
            return Err(format!("{name} is already inside Eyja's data folder."));
        }
    }
    let id = Uuid::new_v4().to_string();
    let owner = assets_dir.join(&id);
    let target = owner.join(name);
    let copied = fs::create_dir_all(&owner).and_then(|_| {
        if meta.is_dir() {
            copy_dir(source, &target)
        } else {
            fs::copy(source, &target).map(|_| ())
        }
    });
    if let Err(err) = copied {
        let _ = fs::remove_dir_all(&owner);
        return Err(format!("Could not copy {name}: {err}"));
    }
    let mime = if meta.is_dir() {
        DIRECTORY_MIME.to_string()
    } else {
        mime_for(name).to_string()
    };
    Ok(Imported {
        relative_path: format!("{id}/{name}"),
        id,
        mime,
    })
}

fn import_bytes(assets_dir: &Path, name: &str, bytes: &[u8]) -> Result<Imported, String> {
    let name = clean_name(name);
    let id = Uuid::new_v4().to_string();
    let owner = assets_dir.join(&id);
    let written = fs::create_dir_all(&owner).and_then(|_| fs::write(owner.join(&name), bytes));
    if let Err(err) = written {
        let _ = fs::remove_dir_all(&owner);
        return Err(err.to_string());
    }
    Ok(Imported {
        relative_path: format!("{id}/{name}"),
        mime: mime_for(&name).to_string(),
        id,
    })
}

fn copy_dir(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let to = target.join(entry.file_name());
        // Symlinks are skipped so a link back up the tree cannot recurse forever.
        if kind.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// Removes `assets/<asset id>/` for a copied item, or the single file for older flat paths.
fn remove_files(assets_dir: &Path, relative: &str) {
    let Some(Component::Normal(first)) = Path::new(relative).components().next() else {
        return;
    };
    let Ok(target) = safe_join(assets_dir, &first.to_string_lossy()) else {
        return;
    };
    let _ = if target.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };
}

fn clean_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|ch| !matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !ch.is_control())
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "pasted.png".to_string()
    } else {
        trimmed.to_string()
    }
}

fn mime_for(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO documents (id, kind, title, body, favorite, created_at, updated_at)
             VALUES ('m1', 'memo', '', '', 0, 1, 1)",
            [],
        )
        .unwrap();
        conn
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("eyja-assets-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("assets")).unwrap();
        root
    }

    #[test]
    fn folders_are_copied_as_one_directory() {
        let conn = test_db();
        let root = temp_root("folder");
        let source = root.join("outside").join("trip");
        fs::create_dir_all(source.join("day1")).unwrap();
        fs::write(source.join("day1").join("a.txt"), b"a").unwrap();
        fs::write(source.join("b.png"), b"b").unwrap();
        let assets = root.join("assets");

        let item = import_path(&assets, &source).unwrap();
        let asset = insert(&conn, &assets, "m1", &item).unwrap();
        assert!(asset.is_dir);
        assert_eq!(asset.name, "trip");
        fs::remove_dir_all(root.join("outside")).unwrap();
        let copied = PathBuf::from(&asset.path);
        assert_eq!(fs::read(copied.join("day1").join("a.txt")).unwrap(), b"a");
        assert_eq!(fs::read(copied.join("b.png")).unwrap(), b"b");

        remove_document_files(&conn, &assets, "m1").unwrap();
        assert!(!copied.exists());
        assert!(!assets.join(&item.id).exists());
        assert_eq!(list(&conn, &assets, "m1").unwrap().len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pasted_bytes_get_a_safe_name() {
        let root = temp_root("bytes");
        let assets = root.join("assets");
        let item = import_bytes(&assets, "..\\evil:name.png", b"png").unwrap();
        assert_eq!(item.mime, "image/png");
        assert!(item.relative_path.ends_with("/evilname.png"));
        assert_eq!(fs::read(safe_join(&assets, &item.relative_path).unwrap()).unwrap(), b"png");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn assets_folder_cannot_import_itself() {
        let root = temp_root("self");
        let assets = root.join("assets");
        assert!(import_path(&assets, &assets).is_err());
        assert!(import_path(&assets, &root).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
