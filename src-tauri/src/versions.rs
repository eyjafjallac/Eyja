use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::db::{now_ms, AppDb};
use crate::documents::{self, Note};

const CHECKPOINT_EVERY: i64 = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSummary {
    pub id: String,
    pub created_at: i64,
    pub checkpoint: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub latest_body: Option<String>,
    pub versions: Vec<VersionSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionPreview {
    pub id: String,
    pub created_at: i64,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
enum DiffOp {
    Keep { n: usize },
    Delete { n: usize },
    Insert { lines: Vec<String> },
}

struct StoredVersion {
    id: String,
    parent_id: Option<String>,
    patch: Option<String>,
    body: Option<String>,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn history_state(db: State<AppDb>, id: String) -> Result<HistoryState, String> {
    let conn = lock(&db)?;
    load_history(&conn, &id)
}

#[tauri::command]
pub fn record_version(db: State<AppDb>, id: String) -> Result<HistoryState, String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    record_if_changed(&tx, &id)?;
    let state = load_history(&tx, &id)?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(state)
}

#[tauri::command]
pub fn get_version(db: State<AppDb>, id: String, version: String) -> Result<VersionPreview, String> {
    let conn = lock(&db)?;
    let (created_at, body) = read_version(&conn, &id, &version)?;
    Ok(VersionPreview {
        id: version,
        created_at,
        body,
    })
}

#[tauri::command]
pub fn restore_version(db: State<AppDb>, id: String, version: String) -> Result<Note, String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    let (_, body) = read_version(&tx, &id, &version)?;
    // Keep the unsaved draft on the timeline before the current text changes.
    record_if_changed(&tx, &id)?;
    write_body(&tx, &id, &body)?;
    let note = documents::get(&tx, &id)?.ok_or_else(|| "Note not found".to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(note)
}

fn load_history(conn: &Connection, id: &str) -> Result<HistoryState, String> {
    require_note(conn, id)?;
    let versions = list_versions(conn, id)?;
    let latest_body = match versions.first() {
        Some(version) => Some(version_text(conn, &version.id)?),
        None => None,
    };
    Ok(HistoryState {
        latest_body,
        versions,
    })
}

fn record_if_changed(conn: &Connection, id: &str) -> Result<bool, String> {
    let note = require_note(conn, id)?;
    let previous = latest_stored(conn, id)?;
    let previous_text = match &previous {
        Some(version) => Some(version_text(conn, &version.id)?),
        None => None,
    };
    let changed = match &previous_text {
        None => !note.body.is_empty(),
        Some(text) => text != &note.body,
    };
    if !changed {
        return Ok(false);
    }

    let checkpoint = is_checkpoint(conn, id)?;
    let parent_id = previous.as_ref().map(|version| version.id.clone());
    let (patch, body) = if checkpoint {
        (None, Some(note.body.clone()))
    } else {
        let base = previous_text.ok_or_else(|| "Missing previous version".to_string())?;
        (Some(encode_patch(&base, &note.body)?), None)
    };
    conn.execute(
        "INSERT INTO document_versions (
            id, document_id, parent_id, created_at, patch, body
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            id,
            parent_id,
            now_ms(),
            patch,
            body
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(true)
}

fn is_checkpoint(conn: &Connection, id: &str) -> Result<bool, String> {
    let checkpoints: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM document_versions
             WHERE document_id = ?1 AND body IS NOT NULL",
            [id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    if checkpoints == 0 {
        return Ok(true);
    }
    let patches: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM document_versions
             WHERE document_id = ?1
               AND body IS NULL
               AND rowid > (
                 SELECT MAX(rowid) FROM document_versions
                 WHERE document_id = ?1 AND body IS NOT NULL
               )",
            [id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    Ok(patches >= CHECKPOINT_EVERY)
}

fn list_versions(conn: &Connection, id: &str) -> Result<Vec<VersionSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, created_at, body IS NOT NULL
             FROM document_versions
             WHERE document_id = ?1
             ORDER BY rowid DESC",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([id], |row| {
            Ok(VersionSummary {
                id: row.get(0)?,
                created_at: row.get(1)?,
                checkpoint: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn read_version(conn: &Connection, document_id: &str, version_id: &str) -> Result<(i64, String), String> {
    let owner: Option<(String, i64)> = conn
        .query_row(
            "SELECT document_id, created_at FROM document_versions WHERE id = ?1",
            [version_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((owner_id, created_at)) = owner else {
        return Err("Version not found".to_string());
    };
    if owner_id != document_id {
        return Err("Version not found".to_string());
    }
    Ok((created_at, version_text(conn, version_id)?))
}

fn version_text(conn: &Connection, version_id: &str) -> Result<String, String> {
    let mut chain = Vec::new();
    let mut current = Some(version_id.to_string());
    for _ in 0..10_000 {
        let Some(id) = current else {
            break;
        };
        let row = stored_version(conn, &id)?;
        let parent = row.parent_id.clone();
        let checkpoint = row.body.is_some();
        chain.push(row);
        if checkpoint {
            break;
        }
        current = parent;
    }
    let Some(start) = chain.last().and_then(|row| row.body.clone()) else {
        return Err("Version chain has no checkpoint".to_string());
    };
    chain.reverse();
    let mut text = start;
    for row in chain.iter().skip(1) {
        let patch = row
            .patch
            .as_deref()
            .ok_or_else(|| "Version is missing a patch".to_string())?;
        text = apply_patch(&text, patch)?;
    }
    Ok(text)
}

fn stored_version(conn: &Connection, id: &str) -> Result<StoredVersion, String> {
    conn.query_row(
        "SELECT id, parent_id, patch, body FROM document_versions WHERE id = ?1",
        [id],
        |row| {
            Ok(StoredVersion {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                patch: row.get(2)?,
                body: row.get(3)?,
            })
        },
    )
    .map_err(|err| err.to_string())
}

fn latest_stored(conn: &Connection, document_id: &str) -> Result<Option<StoredVersion>, String> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM document_versions
             WHERE document_id = ?1
             ORDER BY rowid DESC
             LIMIT 1",
            [document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| err.to_string())?;
    match id {
        Some(id) => Ok(Some(stored_version(conn, &id)?)),
        None => Ok(None),
    }
}

fn require_note(conn: &Connection, id: &str) -> Result<Note, String> {
    documents::get(conn, id)?.ok_or_else(|| "Note not found".to_string())
}

fn write_body(conn: &Connection, id: &str, body: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE documents
             SET body = ?1, updated_at = ?2
             WHERE id = ?3 AND deleted_at IS NULL",
            params![body, now_ms(), id],
        )
        .map_err(|err| err.to_string())?;
    if changed == 0 {
        return Err("Note not found".to_string());
    }
    Ok(())
}

fn split_lines(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split('\n').map(str::to_string).collect()
}

fn join_lines(lines: &[String]) -> String {
    lines.join("\n")
}

fn encode_patch(before: &str, after: &str) -> Result<String, String> {
    let ops = diff_lines(&split_lines(before), &split_lines(after))?;
    serde_json::to_string(&ops).map_err(|err| err.to_string())
}

fn apply_patch(before: &str, patch: &str) -> Result<String, String> {
    let ops: Vec<DiffOp> = serde_json::from_str(patch).map_err(|err| err.to_string())?;
    let source = split_lines(before);
    let mut index = 0;
    let mut output = Vec::new();
    for op in ops {
        match op {
            DiffOp::Keep { n } | DiffOp::Delete { n } => {
                let end = index + n;
                if end > source.len() {
                    return Err("Patch does not match this version".to_string());
                }
                if matches!(op, DiffOp::Keep { .. }) {
                    output.extend_from_slice(&source[index..end]);
                }
                index = end;
            }
            DiffOp::Insert { lines } => output.extend(lines),
        }
    }
    if index != source.len() {
        return Err("Patch does not match this version".to_string());
    }
    Ok(join_lines(&output))
}

enum RawEdit {
    Equal,
    Delete,
    Insert(String),
}

fn diff_lines(before: &[String], after: &[String]) -> Result<Vec<DiffOp>, String> {
    if before.is_empty() && after.is_empty() {
        return Ok(Vec::new());
    }
    let n = i32::try_from(before.len()).map_err(|_| "Note is too long to diff".to_string())?;
    let m = i32::try_from(after.len()).map_err(|_| "Note is too long to diff".to_string())?;
    let max = n + m;
    let offset = max;
    let width = usize::try_from(2 * max + 1).map_err(|_| "Note is too long to diff".to_string())?;
    let mut v = vec![0_i32; width];
    let mut trace = Vec::new();

    for d in 0..=max {
        trace.push(v.clone());
        let mut found = false;
        let mut k = -d;
        while k <= d {
            let index = |value: i32| usize::try_from(offset + value).unwrap_or(0);
            let x = if k == -d || (k != d && v[index(k - 1)] < v[index(k + 1)]) {
                v[index(k + 1)]
            } else {
                v[index(k - 1)] + 1
            };
            let mut x = x;
            let mut y = x - k;
            while x < n && y < m && before[x as usize] == after[y as usize] {
                x += 1;
                y += 1;
            }
            v[index(k)] = x;
            if x >= n && y >= m {
                found = true;
                break;
            }
            k += 2;
        }
        if found {
            break;
        }
    }

    let mut x = n;
    let mut y = m;
    let mut reversed = Vec::new();
    for d in (0..trace.len() as i32).rev() {
        let snapshot = &trace[d as usize];
        let k = x - y;
        let index = |value: i32| usize::try_from(offset + value).unwrap_or(0);
        let prev_k = if k == -d || (k != d && snapshot[index(k - 1)] < snapshot[index(k + 1)]) {
            k + 1
        } else {
            k - 1
        };
        let prev_x = snapshot[index(prev_k)];
        let prev_y = prev_x - prev_k;
        while x > prev_x && y > prev_y {
            reversed.push(RawEdit::Equal);
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            if x == prev_x {
                let line = after
                    .get(prev_y as usize)
                    .ok_or_else(|| "Diff failed".to_string())?;
                reversed.push(RawEdit::Insert(line.clone()));
            } else {
                reversed.push(RawEdit::Delete);
                x = prev_x;
            }
            y = prev_y;
        }
    }

    reversed.reverse();
    Ok(coalesce(reversed))
}

fn coalesce(edits: Vec<RawEdit>) -> Vec<DiffOp> {
    let mut ops = Vec::new();
    for edit in edits {
        match edit {
            RawEdit::Equal => match ops.last_mut() {
                Some(DiffOp::Keep { n }) => *n += 1,
                _ => ops.push(DiffOp::Keep { n: 1 }),
            },
            RawEdit::Delete => match ops.last_mut() {
                Some(DiffOp::Delete { n }) => *n += 1,
                _ => ops.push(DiffOp::Delete { n: 1 }),
            },
            RawEdit::Insert(line) => match ops.last_mut() {
                Some(DiffOp::Insert { lines }) => lines.push(line),
                _ => ops.push(DiffOp::Insert { lines: vec![line] }),
            },
        }
    }
    ops
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::documents::{create, update};

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn roundtrip(before: &str, after: &str) {
        let patch = encode_patch(before, after).unwrap();
        let applied = apply_patch(before, &patch).unwrap();
        assert_eq!(applied, after, "patch {patch}");
    }

    #[test]
    fn patches_roundtrip_small_texts() {
        let samples = [
            "",
            "a",
            "a\n",
            "a\nb",
            "a\nb\nc",
            "same\nsame\nsame",
            "alpha\nbeta\ngamma\ndelta",
        ];
        for before in samples {
            for after in samples {
                roundtrip(before, after);
            }
        }
    }

    #[test]
    fn patches_roundtrip_edits_inside_a_note() {
        let before = "intro\n\nmiddle\nend\n";
        roundtrip(before, &before.replace("middle", "changed"));
        roundtrip(before, &format!("new\n{before}"));
        roundtrip(before, before.trim_end());
        roundtrip(before, "");
        roundtrip("", before);
    }

    #[test]
    fn empty_note_is_not_a_version() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        assert!(!record_if_changed(&conn, &note.id).unwrap());
        let state = load_history(&conn, &note.id).unwrap();
        assert!(state.versions.is_empty());
        assert!(state.latest_body.is_none());
    }

    #[test]
    fn versions_are_checkpoints_then_patches() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        let mut bodies = Vec::new();
        for index in 0..22 {
            let body = format!("version {index}\nline\n");
            update(&conn, &note.id, "Title", &body).unwrap();
            assert!(record_if_changed(&conn, &note.id).unwrap());
            bodies.push(body);
        }
        assert!(!record_if_changed(&conn, &note.id).unwrap());

        let stored: Vec<(Option<String>, Option<String>)> = {
            let mut statement = conn
                .prepare(
                    "SELECT body, patch FROM document_versions
                     WHERE document_id = ?1
                     ORDER BY rowid",
                )
                .unwrap();
            statement
                .query_map([&note.id], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(stored.len(), 22);
        for (index, (body, patch)) in stored.iter().enumerate() {
            let checkpoint = index == 0 || index == 21;
            assert_eq!(body.is_some(), checkpoint, "index {index}");
            assert_eq!(patch.is_some(), !checkpoint, "index {index}");
        }

        let listed = list_versions(&conn, &note.id).unwrap();
        assert_eq!(listed.len(), 22);
        for (index, body) in bodies.iter().enumerate() {
            let version = &listed[listed.len() - 1 - index];
            let text = version_text(&conn, &version.id).unwrap();
            assert_eq!(&text, body);
        }
    }

    #[test]
    fn restore_keeps_the_current_draft_first() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        update(&conn, &note.id, "Title", "one").unwrap();
        record_if_changed(&conn, &note.id).unwrap();
        let first = list_versions(&conn, &note.id).unwrap().pop().unwrap();

        update(&conn, &note.id, "Title", "two").unwrap();
        record_if_changed(&conn, &note.id).unwrap();
        update(&conn, &note.id, "Title", "three").unwrap();

        let (_, preview) = read_version(&conn, &note.id, &first.id).unwrap();
        assert_eq!(preview, "one");

        let tx = conn.unchecked_transaction().unwrap();
        let (_, body) = read_version(&tx, &note.id, &first.id).unwrap();
        record_if_changed(&tx, &note.id).unwrap();
        write_body(&tx, &note.id, &body).unwrap();
        tx.commit().unwrap();

        let restored = documents::get(&conn, &note.id).unwrap().unwrap();
        assert_eq!(restored.body, "one");
        assert_eq!(restored.title, "Title");
        let state = load_history(&conn, &note.id).unwrap();
        assert_eq!(state.latest_body.as_deref(), Some("three"));
        assert_eq!(state.versions.len(), 3);
    }
}
