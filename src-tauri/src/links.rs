//! Keeps the `links` table in step with the `[[Title]]` references written in each body.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::now_ms;

const MAX_ANCHOR_CHARS: usize = 500;

#[derive(Debug, PartialEq)]
pub(crate) struct WikiRef {
    pub title: String,
    /// The sentence the reference sits in, as written.
    pub anchor: String,
}

fn sql(err: rusqlite::Error) -> String {
    err.to_string()
}

/// Rewrites the outgoing links of one document. Links that did not change keep their row,
/// so `created_at` stays the time the link was first written.
pub(crate) fn sync_document(conn: &Connection, source_id: &str) -> Result<(), String> {
    let body: Option<String> = conn
        .query_row(
            "SELECT body FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [source_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    let Some(body) = body else {
        return Ok(());
    };

    let mut wanted = HashSet::new();
    let mut resolved = HashMap::new();
    for reference in wiki_refs(&body) {
        if !resolved.contains_key(&reference.title) {
            let target = resolve(conn, source_id, &reference.title)?;
            resolved.insert(reference.title.clone(), target);
        }
        if let Some(Some(target)) = resolved.get(&reference.title) {
            wanted.insert((target.clone(), reference.anchor));
        }
    }

    let existing: Vec<(String, String, String)> = {
        let mut statement = conn
            .prepare("SELECT id, target_id, COALESCE(anchor, '') FROM links WHERE source_id = ?1")
            .map_err(sql)?;
        let rows = statement
            .query_map([source_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(sql)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql)?
    };
    for (id, target, anchor) in existing {
        if !wanted.remove(&(target, anchor)) {
            conn.execute("DELETE FROM links WHERE id = ?1", [id]).map_err(sql)?;
        }
    }
    let now = now_ms();
    for (target, anchor) in wanted {
        conn.execute(
            "INSERT INTO links (id, source_id, target_id, anchor, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![Uuid::new_v4().to_string(), source_id, target, anchor, now],
        )
        .map_err(sql)?;
    }
    Ok(())
}

/// After a rename, documents that mention the old or the new title link again.
pub(crate) fn sync_title_change(conn: &Connection, id: &str, old_title: &str, new_title: &str) -> Result<(), String> {
    let mut sources = HashSet::new();
    for title in [old_title.trim(), new_title.trim()] {
        if title.is_empty() {
            continue;
        }
        let mut statement = conn
            .prepare(
                "SELECT id FROM documents
                 WHERE deleted_at IS NULL AND id != ?1
                   AND instr(lower(body), lower(?2)) > 0",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map(params![id, format!("[[{title}")], |row| row.get::<_, String>(0))
            .map_err(sql)?;
        for row in rows {
            sources.insert(row.map_err(sql)?);
        }
    }
    for source in sources {
        sync_document(conn, &source)?;
    }
    Ok(())
}

/// Exact title first, then the same title in another case. Notes win over memos, then the
/// most recently changed document.
fn resolve(conn: &Connection, source_id: &str, title: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM documents
         WHERE deleted_at IS NULL AND id != ?1 AND TRIM(title) = ?2 COLLATE NOCASE
         ORDER BY TRIM(title) = ?2 DESC, kind = 'note' DESC, updated_at DESC
         LIMIT 1",
        params![source_id, title],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql)
}

/// `[[Title]]`, `[[Title|label]]` and `[[Title#section]]` outside code all point at `Title`.
pub(crate) fn wiki_refs(body: &str) -> Vec<WikiRef> {
    let mut refs = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if let Some((marker, width)) = fence {
            let run = trimmed.chars().take_while(|ch| *ch == marker).count();
            if run >= width && trimmed[run * marker.len_utf8()..].trim().is_empty() {
                fence = None;
            }
            continue;
        }
        if let Some(open) = opening_fence(trimmed) {
            fence = Some(open);
            continue;
        }
        refs.extend(line_refs(line));
    }
    refs
}

fn opening_fence(line: &str) -> Option<(char, usize)> {
    let marker = line.chars().next().filter(|ch| *ch == '`' || *ch == '~')?;
    let width = line.chars().take_while(|ch| *ch == marker).count();
    (width >= 3).then_some((marker, width))
}

fn line_refs(line: &str) -> Vec<WikiRef> {
    let chars: Vec<char> = line.chars().collect();
    let code = inline_code_spans(&chars);
    let in_code = |index: usize| code.iter().any(|(start, end)| index >= *start && index < *end);

    let mut spans = Vec::new();
    let mut index = 0;
    while index + 1 < chars.len() {
        if chars[index] == '[' && chars[index + 1] == '[' && !in_code(index) {
            let start = index;
            let mut cursor = index + 2;
            let mut closed = None;
            while cursor + 1 < chars.len() {
                if chars[cursor] == '[' {
                    break;
                }
                if chars[cursor] == ']' {
                    if chars[cursor + 1] == ']' {
                        closed = Some(cursor);
                    }
                    break;
                }
                cursor += 1;
            }
            if let Some(close) = closed {
                let inner: String = chars[start + 2..close].iter().collect();
                let title = inner.split(['|', '#']).next().unwrap_or("").trim().to_string();
                if !title.is_empty() {
                    spans.push((start, close + 2, title));
                }
                index = close + 2;
                continue;
            }
        }
        index += 1;
    }

    let in_link = |index: usize| spans.iter().any(|(start, end, _)| index >= *start && index < *end);
    spans
        .iter()
        .map(|(start, end, title)| {
            let mut from = *start;
            while from > 0 && !(ends_sentence(&chars, from - 1) && !in_link(from - 1) && !in_code(from - 1)) {
                from -= 1;
            }
            let mut to = *end;
            while to < chars.len() && !(ends_sentence(&chars, to) && !in_link(to) && !in_code(to)) {
                to += 1;
            }
            let to = (to + 1).min(chars.len());
            let sentence: String = chars[from..to].iter().collect();
            let anchor: String = sentence
                .trim()
                .trim_start_matches(['#', '>', '-', '*', '+', ' '])
                .chars()
                .take(MAX_ANCHOR_CHARS)
                .collect();
            WikiRef {
                title: title.clone(),
                anchor,
            }
        })
        .collect()
}

/// Full stops in Chinese and Japanese end a sentence on their own; Latin ones need a space
/// after them, so `v1.2` or `e.g.` inside a word does not split it.
fn ends_sentence(chars: &[char], index: usize) -> bool {
    match chars[index] {
        '。' | '！' | '？' | '；' => true,
        '.' | '!' | '?' => chars.get(index + 1).is_none_or(|next| next.is_whitespace()),
        _ => false,
    }
}

fn inline_code_spans(chars: &[char]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '`' {
            index += 1;
            continue;
        }
        let width = chars[index..].iter().take_while(|ch| **ch == '`').count();
        let mut cursor = index + width;
        let mut closed = None;
        while cursor < chars.len() {
            if chars[cursor] == '`' {
                let run = chars[cursor..].iter().take_while(|ch| **ch == '`').count();
                if run == width {
                    closed = Some(cursor + run);
                    break;
                }
                cursor += run;
            } else {
                cursor += 1;
            }
        }
        match closed {
            Some(end) => {
                spans.push((index, end));
                index = end;
            }
            None => index += width,
        }
    }
    spans
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

    fn titles(body: &str) -> Vec<String> {
        wiki_refs(body).into_iter().map(|reference| reference.title).collect()
    }

    #[test]
    fn references_outside_code_are_found() {
        let body = "See [[Alpha]] and [[Beta|the beta]].\n`[[Code]]`\n```\n[[Fenced]]\n```\nThen [[Gamma#Part]].";
        assert_eq!(titles(body), vec!["Alpha", "Beta", "Gamma"]);
        assert!(titles("[[]] and [[ ]] and [[open").is_empty());
    }

    #[test]
    fn anchor_is_the_sentence_around_the_reference() {
        let refs = wiki_refs("First idea. Then see [[Dr. Who]] for more! Last one.");
        assert_eq!(refs[0].title, "Dr. Who");
        assert_eq!(refs[0].anchor, "Then see [[Dr. Who]] for more!");

        let refs = wiki_refs("- 先看完。這裡引用[[熱方程式]]的推導。後面還有");
        assert_eq!(refs[0].anchor, "這裡引用[[熱方程式]]的推導。");

        let refs = wiki_refs("## About [[Topic]] in v1.2 notes");
        assert_eq!(refs[0].anchor, "About [[Topic]] in v1.2 notes");
    }

    #[test]
    fn links_follow_the_body_and_titles() {
        let conn = test_db();
        let source = create(&conn).unwrap();
        let target = create(&conn).unwrap();
        update(&conn, &source.id, "Source", "Read [[Target]] first. Also [[Nobody]].").unwrap();
        let count = |conn: &Connection| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM links", [], |row| row.get(0)).unwrap()
        };
        assert_eq!(count(&conn), 0);

        // Naming the target links the document that already mentioned it.
        update(&conn, &target.id, "Target", "").unwrap();
        let (to, anchor): (String, String) = conn
            .query_row("SELECT target_id, anchor FROM links", [], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap();
        assert_eq!(to, target.id);
        assert_eq!(anchor, "Read [[Target]] first.");
        let first_id: String = conn.query_row("SELECT id FROM links", [], |row| row.get(0)).unwrap();

        update(&conn, &source.id, "Source", "Read [[Target]] first. Also [[Nobody]]!").unwrap();
        let same_id: String = conn.query_row("SELECT id FROM links", [], |row| row.get(0)).unwrap();
        assert_eq!(first_id, same_id);

        update(&conn, &target.id, "Renamed", "").unwrap();
        assert_eq!(count(&conn), 0);
    }
}
