//! Library search: keyword matches from FTS5, and similarity from lexical vectors kept in
//! sqlite-vec. The vectors hash words and character n-grams, so they need no model and work
//! offline for Chinese and English alike. Raising `VECTOR_VERSION` re-embeds everything,
//! which is how a different embedding would be swapped in later.

use std::collections::HashMap;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::AppDb;

const DIM: usize = 512;
const VECTOR_VERSION: i64 = 1;
const KEYWORD_LIMIT: usize = 100;
const SIMILAR_LIMIT: usize = 30;
/// Below this cosine similarity two documents only share common words.
const MIN_SIMILARITY: f64 = 0.08;
/// Reciprocal rank fusion constant for hybrid results.
const RRF_K: f64 = 60.0;
const SNIPPET_BEFORE: usize = 40;
const SNIPPET_AFTER: usize = 100;
const TITLE_WEIGHT: f32 = 2.0;

const STOP_WORDS: [&str; 40] = [
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
    "one", "our", "out", "has", "have", "his", "how", "its", "may", "who", "did", "get", "him",
    "this", "that", "with", "from", "they", "will", "what", "when", "then", "than", "into",
    "your", "been", "were",
];
const STOP_CHARS: &str = "的了是在和也就都而及與与或我你他她它們们這这那有不一個个上中下";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    /// Keyword: higher is a better match. Similar: cosine similarity. Hybrid: fused rank.
    pub score: f64,
    /// Text around the first keyword match; empty for similarity-only hits.
    pub snippet: String,
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

fn sql(err: rusqlite::Error) -> String {
    err.to_string()
}

/// `mode` is `keyword`, `similar` or `hybrid`.
#[tauri::command]
pub fn search_documents(db: State<AppDb>, query: String, mode: String) -> Result<Vec<SearchHit>, String> {
    let conn = lock(&db)?;
    match mode.as_str() {
        "keyword" => keyword(&conn, &query, KEYWORD_LIMIT),
        "similar" => similar_to_text(&conn, &query, None, SIMILAR_LIMIT),
        "hybrid" => hybrid(&conn, &query),
        _ => Err(format!("Unknown search mode \"{mode}\"")),
    }
}

/// Documents that read like this one.
#[tauri::command]
pub fn similar_documents(db: State<AppDb>, id: String) -> Result<Vec<SearchHit>, String> {
    let conn = lock(&db)?;
    let text: Option<(String, String)> = conn
        .query_row(
            "SELECT title, body FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(sql)
        .ok();
    let Some((title, body)) = text else {
        return Err("Document not found".to_string());
    };
    let Some(vector) = embed(&title, &body) else {
        return Ok(Vec::new());
    };
    nearest(&conn, &vector, Some(&id), SIMILAR_LIMIT)
}

fn terms(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|term| term.trim_matches('"').to_string())
        .filter(|term| !term.is_empty())
        .collect()
}

/// Every term must appear in the title or body. Terms of three or more characters go
/// through the trigram index; shorter ones (common in Chinese) fall back to LIKE.
pub(crate) fn keyword(conn: &Connection, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
    let terms = terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let (long, short): (Vec<&String>, Vec<&String>) =
        terms.iter().partition(|term| term.chars().count() >= 3);

    let mut conditions = vec!["d.deleted_at IS NULL".to_string()];
    let mut values: Vec<String> = Vec::new();
    if !long.is_empty() {
        let expression = long
            .iter()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ");
        values.push(expression);
        conditions.push(format!("documents_fts MATCH ?{}", values.len()));
    }
    for term in &short {
        let escaped = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        values.push(format!("%{escaped}%"));
        let index = values.len();
        conditions.push(format!(
            "(documents_fts.title LIKE ?{index} ESCAPE '\\' OR documents_fts.body LIKE ?{index} ESCAPE '\\')"
        ));
    }
    let (rank, order) = if long.is_empty() {
        ("0.0", "d.updated_at DESC")
    } else {
        // Title matches count ten times a body match; bm25 is lower for better matches.
        ("-bm25(documents_fts, 0.0, 10.0, 1.0)", "bm25(documents_fts, 0.0, 10.0, 1.0)")
    };
    let statement_text = format!(
        "SELECT d.id, d.body, {rank}
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.id
         WHERE {}
         ORDER BY {order}
         LIMIT {limit}",
        conditions.join(" AND ")
    );
    let mut statement = conn.prepare(&statement_text).map_err(sql)?;
    let rows = statement
        .query_map(rusqlite::params_from_iter(values.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })
        .map_err(sql)?;
    let mut hits = Vec::new();
    for row in rows {
        let (id, body, score) = row.map_err(sql)?;
        hits.push(SearchHit {
            id,
            score,
            snippet: snippet(&body, &terms),
        });
    }
    Ok(hits)
}

pub(crate) fn similar_to_text(conn: &Connection, query: &str, skip: Option<&str>, limit: usize) -> Result<Vec<SearchHit>, String> {
    let Some(vector) = embed("", query) else {
        return Ok(Vec::new());
    };
    nearest(conn, &vector, skip, limit)
}

fn hybrid(conn: &Connection, query: &str) -> Result<Vec<SearchHit>, String> {
    let keyword_hits = keyword(conn, query, KEYWORD_LIMIT)?;
    let similar_hits = similar_to_text(conn, query, None, SIMILAR_LIMIT)?;
    let mut fused: HashMap<String, SearchHit> = HashMap::new();
    for list in [&keyword_hits, &similar_hits] {
        for (rank, hit) in list.iter().enumerate() {
            let entry = fused.entry(hit.id.clone()).or_insert_with(|| SearchHit {
                id: hit.id.clone(),
                score: 0.0,
                snippet: String::new(),
            });
            entry.score += 1.0 / (RRF_K + rank as f64 + 1.0);
            if entry.snippet.is_empty() {
                entry.snippet = hit.snippet.clone();
            }
        }
    }
    let mut hits: Vec<SearchHit> = fused.into_values().collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    Ok(hits)
}

fn nearest(conn: &Connection, vector: &[f32], skip: Option<&str>, limit: usize) -> Result<Vec<SearchHit>, String> {
    refresh_vectors(conn)?;
    let mut statement = conn
        .prepare(
            "SELECT document_id, distance FROM document_vectors
             WHERE embedding MATCH ?1 AND k = ?2
             ORDER BY distance",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map(params![to_blob(vector), (limit + 1) as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(sql)?;
    let mut hits = Vec::new();
    for row in rows {
        let (id, distance) = row.map_err(sql)?;
        let score = 1.0 - distance;
        if Some(id.as_str()) == skip || score < MIN_SIMILARITY {
            continue;
        }
        hits.push(SearchHit {
            id,
            score,
            snippet: String::new(),
        });
    }
    hits.truncate(limit);
    Ok(hits)
}

/// Embeds documents changed since their vector was made, and drops vectors of deleted ones.
/// A trigger clears a document's state row whenever its title or body changes.
pub(crate) fn refresh_vectors(conn: &Connection) -> Result<usize, String> {
    let stale: Vec<(String, String, String, i64)> = {
        let mut statement = conn
            .prepare(
                "SELECT d.id, d.title, d.body, d.updated_at
                 FROM documents d
                 LEFT JOIN document_vector_state s ON s.document_id = d.id
                 WHERE d.deleted_at IS NULL
                   AND (s.document_id IS NULL OR s.version != ?1)",
            )
            .map_err(sql)?;
        let rows = statement
            .query_map([VECTOR_VERSION], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(sql)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql)?
    };
    let gone: Vec<String> = {
        let mut statement = conn
            .prepare(
                "SELECT s.document_id
                 FROM document_vector_state s
                 LEFT JOIN documents d ON d.id = s.document_id
                 WHERE d.id IS NULL OR d.deleted_at IS NOT NULL",
            )
            .map_err(sql)?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(sql)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(sql)?
    };
    if stale.is_empty() && gone.is_empty() {
        return Ok(0);
    }

    let tx = conn.unchecked_transaction().map_err(sql)?;
    for id in &gone {
        tx.execute("DELETE FROM document_vectors WHERE document_id = ?1", [id])
            .map_err(sql)?;
        tx.execute("DELETE FROM document_vector_state WHERE document_id = ?1", [id])
            .map_err(sql)?;
    }
    for (id, title, body, updated_at) in &stale {
        tx.execute("DELETE FROM document_vectors WHERE document_id = ?1", [id])
            .map_err(sql)?;
        if let Some(vector) = embed(title, body) {
            tx.execute(
                "INSERT INTO document_vectors (document_id, embedding) VALUES (?1, ?2)",
                params![id, to_blob(&vector)],
            )
            .map_err(sql)?;
        }
        tx.execute(
            "INSERT INTO document_vector_state (document_id, updated_at, version)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(document_id) DO UPDATE SET
                updated_at = excluded.updated_at,
                version = excluded.version",
            params![id, updated_at, VECTOR_VERSION],
        )
        .map_err(sql)?;
    }
    tx.commit().map_err(sql)?;
    Ok(stale.len() + gone.len())
}

fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x3040..=0x30FF   // Hiragana, Katakana
        | 0x3400..=0x4DBF // CJK extension A
        | 0x4E00..=0x9FFF // CJK unified ideographs
        | 0xAC00..=0xD7AF // Hangul syllables
        | 0xF900..=0xFAFF // CJK compatibility ideographs
        | 0x20000..=0x2FA1F)
}

/// Drops `(asset:...)` targets so attachment ids do not read as words.
fn without_asset_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("(asset:") {
        out.push_str(&rest[..start]);
        match rest[start..].find(')') {
            Some(end) => rest = &rest[start + end + 1..],
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn add_features(text: &str, weight: f32, counts: &mut HashMap<String, f32>) {
    let text = without_asset_ids(text).to_lowercase();
    let mut word = String::new();
    let mut cjk: Vec<char> = Vec::new();
    let flush_word = |word: &mut String, counts: &mut HashMap<String, f32>| {
        let length = word.chars().count();
        if length >= 2 && !STOP_WORDS.contains(&word.as_str()) {
            *counts.entry(format!("w:{word}")).or_default() += weight;
            if length >= 4 {
                let padded: Vec<char> = format!("^{word}$").chars().collect();
                for gram in padded.windows(3) {
                    *counts.entry(format!("t:{}", gram.iter().collect::<String>())).or_default() +=
                        weight * 0.3;
                }
            }
        }
        word.clear();
    };
    let flush_cjk = |run: &mut Vec<char>, counts: &mut HashMap<String, f32>| {
        for (index, ch) in run.iter().enumerate() {
            if !STOP_CHARS.contains(*ch) {
                *counts.entry(format!("c:{ch}")).or_default() += weight * 0.4;
            }
            if let Some(next) = run.get(index + 1) {
                *counts.entry(format!("b:{ch}{next}")).or_default() += weight;
            }
        }
        run.clear();
    };
    for ch in text.chars() {
        if is_cjk(ch) {
            flush_word(&mut word, counts);
            cjk.push(ch);
        } else if ch.is_alphanumeric() {
            flush_cjk(&mut cjk, counts);
            word.push(ch);
        } else {
            flush_word(&mut word, counts);
            flush_cjk(&mut cjk, counts);
        }
    }
    flush_word(&mut word, counts);
    flush_cjk(&mut cjk, counts);
}

fn fnv1a(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// A unit vector, or `None` when the text has nothing to compare by.
pub(crate) fn embed(title: &str, body: &str) -> Option<Vec<f32>> {
    let mut counts = HashMap::new();
    add_features(title, TITLE_WEIGHT, &mut counts);
    add_features(body, 1.0, &mut counts);
    let mut vector = vec![0.0_f32; DIM];
    for (feature, count) in counts {
        let hash = fnv1a(&feature);
        let bucket = (hash % DIM as u64) as usize;
        let sign = if hash >> 63 == 0 { 1.0 } else { -1.0 };
        // Repeating a word helps, but less each time.
        vector[bucket] += sign * (1.0 + count.ln_1p());
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm == 0.0 || !norm.is_finite() {
        return None;
    }
    for value in &mut vector {
        *value /= norm;
    }
    Some(vector)
}

/// One line of text around the first term found in the body.
fn snippet(body: &str, terms: &[String]) -> String {
    let chars: Vec<char> = body.chars().collect();
    let lower: Vec<char> = chars
        .iter()
        .map(|ch| ch.to_lowercase().next().unwrap_or(*ch))
        .collect();
    let found = terms.iter().filter_map(|term| {
        let needle: Vec<char> = term.chars().map(|ch| ch.to_lowercase().next().unwrap_or(ch)).collect();
        if needle.is_empty() || needle.len() > lower.len() {
            return None;
        }
        lower.windows(needle.len()).position(|window| window == needle.as_slice())
    });
    let Some(position) = found.min() else {
        return String::new();
    };
    let start = position.saturating_sub(SNIPPET_BEFORE);
    let end = (position + SNIPPET_AFTER).min(chars.len());
    let mut text: String = chars[start..end]
        .iter()
        .map(|ch| if ch.is_whitespace() { ' ' } else { *ch })
        .collect();
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        text.insert(0, '…');
    }
    if end < chars.len() {
        text.push('…');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::documents::{create, soft_delete, update};

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn note(conn: &Connection, title: &str, body: &str) -> String {
        let note = create(conn).unwrap();
        update(conn, &note.id, title, body).unwrap();
        note.id
    }

    fn ids(hits: &[SearchHit]) -> Vec<String> {
        hits.iter().map(|hit| hit.id.clone()).collect()
    }

    #[test]
    fn keyword_search_matches_titles_bodies_and_short_chinese_terms() {
        let conn = test_db();
        let heat = note(&conn, "Heat equation", "The 熱方程式 describes diffusion.");
        let wave = note(&conn, "Waves", "Diffusion is not the topic; 波動 is.");
        let gone = note(&conn, "Deleted diffusion", "diffusion");
        soft_delete(&conn, &std::env::temp_dir().join("eyja-unused-assets"), &gone).unwrap();

        let hits = keyword(&conn, "diffusion", 10).unwrap();
        let mut found = ids(&hits);
        found.sort();
        let mut expected = vec![heat.clone(), wave.clone()];
        expected.sort();
        assert_eq!(found, expected);
        assert!(hits.iter().all(|hit| hit.snippet.to_lowercase().contains("diffusion")));

        assert_eq!(ids(&keyword(&conn, "方程", 10).unwrap()), vec![heat.clone()]);
        assert_eq!(ids(&keyword(&conn, "波動 diffusion", 10).unwrap()), vec![wave]);
        assert_eq!(ids(&keyword(&conn, "HEAT", 10).unwrap()), vec![heat]);
        assert!(keyword(&conn, "   ", 10).unwrap().is_empty());
        assert!(keyword(&conn, "100%_", 10).unwrap().is_empty());
    }

    #[test]
    fn similar_documents_rank_shared_words_first() {
        let conn = test_db();
        let laplace = note(&conn, "Graph Laplacian", "eigenvalues of the graph laplacian and spectral clustering");
        let spectral = note(&conn, "Spectral clustering", "spectral clustering uses laplacian eigenvalues");
        let bread = note(&conn, "Sourdough", "flour water salt starter bake bread");
        let chinese = note(&conn, "熱傳導", "熱方程式描述熱的擴散");

        let hits = similar_to_text(&conn, "laplacian eigenvalues", None, 10).unwrap();
        let found = ids(&hits);
        assert!(found.contains(&laplace) && found.contains(&spectral));
        assert!(!found.contains(&bread));

        let hits = similar_to_text(&conn, "熱方程式", None, 10).unwrap();
        assert_eq!(ids(&hits).first(), Some(&chinese));

        update(&conn, &bread, "Sourdough", "spectral laplacian eigenvalues clustering graph").unwrap();
        let hits = similar_to_text(&conn, "laplacian eigenvalues", None, 10).unwrap();
        assert!(ids(&hits).contains(&bread));
    }

    #[test]
    fn vectors_follow_deletes_and_skip_empty_documents() {
        let conn = test_db();
        let kept = note(&conn, "Kept", "alpha beta gamma");
        let removed = note(&conn, "Removed", "alpha beta gamma");
        let _empty = create(&conn).unwrap();
        assert_eq!(refresh_vectors(&conn).unwrap(), 3);
        assert_eq!(refresh_vectors(&conn).unwrap(), 0);
        soft_delete(&conn, &std::env::temp_dir().join("eyja-unused-assets"), &removed).unwrap();
        let hits = similar_to_text(&conn, "alpha gamma", None, 10).unwrap();
        assert_eq!(ids(&hits), vec![kept]);
        let vectors: i64 = conn
            .query_row("SELECT COUNT(*) FROM document_vectors", [], |row| row.get(0))
            .unwrap();
        assert_eq!(vectors, 1);
    }

    #[test]
    fn hybrid_puts_documents_found_both_ways_first() {
        let conn = test_db();
        let both = note(&conn, "Laplacian notes", "laplacian eigenvalues spectral");
        let similar_only = note(&conn, "Spectral", "spectral eigenvalues graph");
        let hits = hybrid(&conn, "laplacian eigenvalues").unwrap();
        assert_eq!(ids(&hits).first(), Some(&both));
        assert!(ids(&hits).contains(&similar_only));
    }

    #[test]
    fn embeddings_are_unit_vectors() {
        let vector = embed("Title", "some body text 中文內容").unwrap();
        let norm: f32 = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-4);
        assert!(embed("", "  ![x](asset:abc) ").is_none());
        assert!(embed("", "").is_none());
    }
}
