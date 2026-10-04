use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::assets::safe_join;
use crate::db::{assets_dir, AppDb};
use crate::documents::{self, Note};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    pub id: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSource {
    pub title: String,
    pub body: String,
    pub images: Vec<ExportImage>,
}

struct AssetRecord {
    id: String,
    relative_path: String,
    mime: String,
}

#[tauri::command]
pub fn export_source(app: AppHandle, db: State<AppDb>, id: String) -> Result<ExportSource, String> {
    let conn = lock(&db)?;
    let note = require_note(&conn, &id)?;
    let titles = note_titles(&conn)?;
    let assets = note_assets(&conn, &id)?;
    let body = rewrite_wiki(&note.body, &titles);
    let assets_dir = assets_dir(&app)?;
    let images = assets
        .iter()
        .filter(|asset| body.contains(&format!("asset:{}", asset.id)))
        .filter_map(|asset| read_image(&assets_dir, asset).ok())
        .collect();
    Ok(ExportSource {
        title: note.title,
        body,
        images,
    })
}

#[tauri::command]
pub fn export_markdown(
    app: AppHandle,
    db: State<AppDb>,
    id: String,
    path: String,
) -> Result<(), String> {
    let conn = lock(&db)?;
    let dest = PathBuf::from(path);
    write_markdown(&conn, &id, &dest, &assets_dir(&app)?)
}

#[tauri::command]
pub fn export_pdf(path: String, html: String) -> Result<(), String> {
    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let browser = find_browser().ok_or_else(|| {
        "Exporting PDF needs Microsoft Edge or Google Chrome.".to_string()
    })?;
    let temp = TempDir::new().map_err(|err| err.to_string())?;
    let html_path = temp.0.join("note.html");
    let profile = temp.0.join("profile");
    fs::write(&html_path, html).map_err(|err| err.to_string())?;
    let mut command = Command::new(browser);
    command
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-first-run")
        .arg("--no-pdf-header-footer")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--print-to-pdf={}", dest.display()))
        .arg(&html_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|err| err.to_string())?;
    let finished = wait_child(&mut child, Duration::from_secs(30))?;
    if finished.is_none() {
        return Err("PDF export timed out.".to_string());
    }
    if !wait_for_pdf(&dest, Duration::from_secs(5)) {
        return Err("PDF export failed.".to_string());
    }
    Ok(())
}

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

fn require_note(conn: &Connection, id: &str) -> Result<Note, String> {
    documents::get(conn, id)?.ok_or_else(|| "Note not found".to_string())
}

fn note_titles(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT title FROM documents
             WHERE deleted_at IS NULL AND kind = 'note'",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    let mut titles = HashSet::new();
    for title in rows {
        let title = title.map_err(|err| err.to_string())?;
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            titles.insert(trimmed.to_string());
        }
    }
    Ok(titles)
}

fn note_assets(conn: &Connection, id: &str) -> Result<Vec<AssetRecord>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, relative_path, mime FROM assets
             WHERE document_id = ?1",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([id], |row| {
            Ok(AssetRecord {
                id: row.get(0)?,
                relative_path: row.get(1)?,
                mime: row.get(2)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

fn write_markdown(
    conn: &Connection,
    id: &str,
    dest: &Path,
    assets_dir: &Path,
) -> Result<(), String> {
    let note = require_note(conn, id)?;
    let titles = note_titles(conn)?;
    let assets = note_assets(conn, id)?;
    let stem = dest
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("images");
    let files_dir = dest
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{stem}_files"));
    let mut writer = AssetWriter {
        assets_dir,
        files_dir: &files_dir,
        link_prefix: format!("{stem}_files"),
        by_id: assets
            .iter()
            .map(|asset| (asset.id.clone(), asset.relative_path.clone()))
            .collect(),
        copied: HashMap::new(),
    };
    let body = rewrite_regions(&note.body, |prose| {
        rewrite_prose(prose, &titles, Some(&mut writer))
    })?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(dest, body).map_err(|err| err.to_string())?;
    Ok(())
}

fn rewrite_wiki(body: &str, titles: &HashSet<String>) -> String {
    rewrite_regions(body, |prose| rewrite_prose(prose, titles, None)).unwrap_or_else(|_| body.to_string())
}

fn rewrite_prose(prose: &str, titles: &HashSet<String>, assets: Option<&mut AssetWriter<'_>>) -> String {
    let (shielded, slots) = shield_inline(prose);
    let mut text = replace_wiki_text(&shielded, titles);
    if let Some(assets) = assets {
        text = replace_assets(&text, assets);
    }
    restore_slots(&text, &slots)
}

fn rewrite_regions(input: &str, mut rewrite: impl FnMut(&str) -> String) -> Result<String, String> {
    let lines = split_keep(input);
    let mut out = String::new();
    let mut prose = String::new();
    let mut index = 0;
    while index < lines.len() {
        if let Some(width) = opening_fence(lines[index]) {
            out.push_str(&rewrite(&prose));
            prose.clear();
            out.push_str(lines[index]);
            index += 1;
            while index < lines.len() {
                out.push_str(lines[index]);
                let closed = closing_fence(lines[index], width);
                index += 1;
                if closed {
                    break;
                }
            }
        } else {
            prose.push_str(lines[index]);
            index += 1;
        }
    }
    out.push_str(&rewrite(&prose));
    Ok(out)
}

fn replace_wiki_text(input: &str, titles: &HashSet<String>) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find("]]") {
            let inner = &after[..end];
            if !inner.contains('\n') {
                let trimmed = inner.trim();
                if trimmed.is_empty() {
                    out.push_str(&rest[start..start + 2 + end + 2]);
                } else if titles.contains(trimmed) {
                    out.push_str(trimmed);
                } else {
                    out.push_str(trimmed);
                }
                rest = &after[end + 2..];
                continue;
            }
        }
        out.push_str("[[");
        rest = &rest[start + 2..];
    }
    out.push_str(rest);
    out
}

struct AssetWriter<'a> {
    assets_dir: &'a Path,
    files_dir: &'a Path,
    link_prefix: String,
    by_id: HashMap<String, String>,
    copied: HashMap<String, String>,
}

impl AssetWriter<'_> {
    fn link_for(&mut self, id: &str) -> Result<String, String> {
        if let Some(link) = self.copied.get(id) {
            return Ok(link.clone());
        }
        let relative = self
            .by_id
            .get(id)
            .ok_or_else(|| "Missing image".to_string())?
            .clone();
        let source = safe_join(self.assets_dir, &relative)?;
        if !source.is_file() {
            return Err("Missing image".to_string());
        }
        let name = unique_name(self.files_dir, &source);
        fs::create_dir_all(self.files_dir).map_err(|err| err.to_string())?;
        fs::copy(&source, self.files_dir.join(&name)).map_err(|err| err.to_string())?;
        let link = format!("{}/{name}", self.link_prefix);
        self.copied.insert(id.to_string(), link.clone());
        Ok(link)
    }
}

fn replace_assets(input: &str, writer: &mut AssetWriter<'_>) -> String {
    let mut out = String::new();
    let mut rest = input;
    while let Some(start) = rest.find("![") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(marker) = after.find("](asset:") {
            let alt = &after[..marker];
            let url_at = marker + "](asset:".len();
            if !alt.contains('\n') {
                if let Some(end) = after[url_at..].find(')') {
                    let id = &after[url_at..url_at + end];
                    if !id.is_empty() && !id.chars().any(char::is_whitespace) {
                        if let Ok(link) = writer.link_for(id) {
                            out.push_str(&format!("![{alt}]({link})"));
                            rest = &after[url_at + end + 1..];
                            continue;
                        }
                    }
                }
            }
        }
        out.push_str("![");
        rest = &rest[start + 2..];
    }
    out.push_str(rest);
    out
}

fn read_image(assets_dir: &Path, asset: &AssetRecord) -> Result<ExportImage, String> {
    let path = safe_join(assets_dir, &asset.relative_path)?;
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    Ok(ExportImage {
        id: asset.id.clone(),
        mime: asset.mime.clone(),
        data_base64: base64_encode(&bytes),
    })
}

fn unique_name(dir: &Path, source: &Path) -> String {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    let ext = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("");
    let mut index = 2;
    loop {
        let candidate = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn shield_inline(text: &str) -> (String, Vec<String>) {
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0;
    let mut out = String::new();
    let mut slots = Vec::new();
    while index < chars.len() {
        if chars[index] == '`' {
            let mut width = 0;
            while index + width < chars.len() && chars[index + width] == '`' {
                width += 1;
            }
            if let Some(end) = find_closing(&chars, index + width, width) {
                let piece: String = chars[index..end].iter().collect();
                out.push_str(&format!("EYJASLOT{}END", slots.len()));
                slots.push(piece);
                index = end;
                continue;
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    (out, slots)
}

fn find_closing(chars: &[char], from: usize, width: usize) -> Option<usize> {
    let mut index = from;
    while index < chars.len() {
        if chars[index] == '`' {
            let mut run = 0;
            while index + run < chars.len() && chars[index + run] == '`' {
                run += 1;
            }
            if run == width {
                return Some(index + run);
            }
            index += run;
            continue;
        }
        index += 1;
    }
    None
}

fn restore_slots(text: &str, slots: &[String]) -> String {
    let mut restored = text.to_string();
    for (index, slot) in slots.iter().enumerate() {
        restored = restored.replace(&format!("EYJASLOT{index}END"), slot);
    }
    restored
}

fn split_keep(input: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, byte) in input.bytes().enumerate() {
        if byte == b'\n' {
            lines.push(&input[start..=index]);
            start = index + 1;
        }
    }
    if start < input.len() {
        lines.push(&input[start..]);
    }
    if lines.is_empty() && input.is_empty() {
        return Vec::new();
    }
    lines
}

fn opening_fence(line: &str) -> Option<usize> {
    let trimmed_nl = line.trim_end_matches(['\n', '\r']);
    let trimmed = trimmed_nl.trim_start_matches(' ');
    let indent = trimmed_nl.len() - trimmed.len();
    if indent > 3 || !trimmed.starts_with("```") {
        return None;
    }
    let width = trimmed.chars().take_while(|ch| *ch == '`').count();
    if width < 3 {
        return None;
    }
    let info = trimmed[width..].trim();
    if info.contains('`') {
        return None;
    }
    Some(width)
}

fn closing_fence(line: &str, width: usize) -> bool {
    let trimmed = line.trim_end_matches(['\n', '\r']).trim();
    let ticks = trimmed.chars().take_while(|ch| *ch == '`').count();
    ticks >= width && ticks == trimmed.chars().count()
}

fn find_browser() -> Option<PathBuf> {
    browser_candidates().into_iter().find(|path| path.is_file())
}

fn browser_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        paths.push(PathBuf::from(
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        ));
        paths.push(PathBuf::from(
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ));
    }
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from(
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ));
        paths.push(PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        paths.push(PathBuf::from("/usr/bin/microsoft-edge"));
        paths.push(PathBuf::from("/usr/bin/google-chrome"));
        paths.push(PathBuf::from("/usr/bin/chromium"));
    }
    paths
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "eyja-export-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn wait_child(child: &mut Child, timeout: Duration) -> Result<Option<bool>, String> {
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
            return Ok(Some(status.success()));
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn wait_for_pdf(path: &Path, timeout: Duration) -> bool {
    let started = Instant::now();
    loop {
        if pdf_exists(path) {
            return true;
        }
        if started.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn pdf_exists(path: &Path) -> bool {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut magic = [0; 5];
    file.read_exact(&mut magic).is_ok() && &magic == b"%PDF-"
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= input.len() {
        let value = ((input[index] as u32) << 16)
            | ((input[index + 1] as u32) << 8)
            | (input[index + 2] as u32);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push(TABLE[(value & 63) as usize] as char);
        index += 3;
    }
    let rest = input.len() - index;
    if rest == 1 {
        let value = (input[index] as u32) << 16;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let value = ((input[index] as u32) << 16) | ((input[index + 1] as u32) << 8);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
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

    #[test]
    fn wiki_links_become_titles_outside_code() {
        let mut titles = HashSet::new();
        titles.insert("Hello".to_string());
        let body = "See [[Hello]] and [[Missing]].\n\n`[[Hello]]`\n\n```\n[[Hello]]\n```\n";
        let rewritten = rewrite_wiki(body, &titles);
        assert_eq!(
            rewritten,
            "See Hello and Missing.\n\n`[[Hello]]`\n\n```\n[[Hello]]\n```\n"
        );
    }

    #[test]
    fn markdown_export_copies_images_beside_the_file() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        update(&conn, &note.id, "Trip", "Pic ![hill](asset:img1) and [[Other]].").unwrap();
        conn.execute(
            "INSERT INTO documents (id, kind, title, body, favorite, created_at, updated_at)
             VALUES ('other', 'note', 'Other', '', 0, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets (id, document_id, mime, relative_path, created_at)
             VALUES ('img1', ?1, 'image/png', 'hill.png', 1)",
            [&note.id],
        )
        .unwrap();

        let root = std::env::temp_dir().join(format!("eyja-md-{}", note.id));
        let _ = fs::remove_dir_all(&root);
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("hill.png"), b"png-bytes").unwrap();
        let dest = root.join("out").join("Trip.md");
        write_markdown(&conn, &note.id, &dest, &assets).unwrap();

        let written = fs::read_to_string(&dest).unwrap();
        assert_eq!(written, "Pic ![hill](Trip_files/hill.png) and Other.");
        assert_eq!(
            fs::read(root.join("out").join("Trip_files").join("hill.png")).unwrap(),
            b"png-bytes"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_image_stays_in_the_markdown() {
        let conn = test_db();
        let note = create(&conn).unwrap();
        update(&conn, &note.id, "Trip", "![hill](asset:missing)").unwrap();
        let root = std::env::temp_dir().join(format!("eyja-missing-{}", note.id));
        let _ = fs::remove_dir_all(&root);
        let dest = root.join("Trip.md");
        write_markdown(&conn, &note.id, &dest, &root.join("assets")).unwrap();
        assert_eq!(fs::read_to_string(dest).unwrap(), "![hill](asset:missing)");
        assert!(!root.join("Trip_files").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn base64_encodes_small_inputs() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"hi"), "aGk=");
    }

    #[test]
    fn pdf_export_writes_a_pdf_when_a_browser_exists() {
        let Some(_) = find_browser() else {
            return;
        };
        let dest = std::env::temp_dir().join(format!(
            "eyja-test-{}.pdf",
            std::process::id()
        ));
        let _ = fs::remove_file(&dest);
        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>@page{size:A4;margin:0} .page{width:210mm;height:297mm}</style></head><body><section class=\"page\"><h1>Hello</h1><p>Export</p></section></body></html>";
        export_pdf(dest.display().to_string(), html.to_string()).unwrap();
        assert!(pdf_exists(&dest));
        let _ = fs::remove_file(&dest);
    }
}
