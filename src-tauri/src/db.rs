use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::{Manager, Runtime};

pub struct AppDb(pub std::sync::Mutex<Connection>);

const MIGRATION_V1: &str = "
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id),
    created_at INTEGER NOT NULL
);

CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'memo')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    folder_id TEXT REFERENCES folders(id),
    pinned_at INTEGER,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    cover_asset_id TEXT,
    color TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id),
    tag_id TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (document_id, tag_id)
);

CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    mime TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE links (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES documents(id),
    target_id TEXT NOT NULL REFERENCES documents(id),
    anchor TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    parent_id TEXT REFERENCES document_versions(id),
    created_at INTEGER NOT NULL,
    patch TEXT,
    body TEXT
);

CREATE INDEX idx_documents_updated ON documents(updated_at);
CREATE INDEX idx_documents_deleted ON documents(deleted_at);
";

pub fn storage_dir<R: Runtime, M: Manager<R>>(app: &M) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    if cfg!(debug_assertions) {
        dir.push("dev");
    }
    Ok(dir)
}

pub fn assets_dir<R: Runtime, M: Manager<R>>(app: &M) -> Result<PathBuf, String> {
    Ok(storage_dir(app)?.join("assets"))
}

pub fn open(app: &tauri::App) -> Result<Connection, Box<dyn std::error::Error>> {
    let dir = storage_dir(app)?;
    fs::create_dir_all(&dir)?;
    fs::create_dir_all(dir.join("assets"))?;

    let conn = Connection::open(dir.join("eyja.sqlite"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )?;
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    if version < 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V1)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            [now_ms()],
        )?;
        tx.commit()?;
    }
    if version < 2 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_document_versions_document
             ON document_versions(document_id);",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            [now_ms()],
        )?;
        tx.commit()?;
    }
    if version < 3 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_assets_document ON assets(document_id);
             CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind, updated_at);",
        )?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            [now_ms()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 3);
    }
}
