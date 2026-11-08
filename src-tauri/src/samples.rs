//! Sample notes that walk through every feature, created on request from the library.

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::{now_ms, AppDb};
use crate::{documents, links, organize, settings, versions};

const HOUR_MS: i64 = 60 * 60 * 1000;
const DAY_MS: i64 = 24 * HOUR_MS;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleSet {
    pub folder_id: String,
    pub tour_id: String,
    pub created: usize,
}

struct Sample {
    title: &'static str,
    body: &'static str,
    tags: &'static [&'static str],
    pinned: bool,
    favorite: bool,
}

const TOUR: Sample = Sample {
    title: "Welcome to Eyja",
    body: TOUR_BODY,
    tags: &["sample", "tour"],
    pinned: true,
    favorite: true,
};

const FEATURES: &[Sample] = &[
    Sample {
        title: "Writing and formatting",
        body: FORMATTING_BODY,
        tags: &["sample", "editor"],
        pinned: false,
        favorite: true,
    },
    Sample {
        title: "Math with LaTeX",
        body: MATH_BODY,
        tags: &["sample", "editor", "math"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Links between notes",
        body: LINKS_BODY,
        tags: &["sample", "links"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Tags, folders and pins",
        body: ORGANIZE_BODY,
        tags: &["sample", "library"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Search: keyword and similar",
        body: SEARCH_BODY,
        tags: &["sample", "library", "search"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Version timeline",
        body: TIMELINE_FINAL,
        tags: &["sample", "history"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Split editor and tabs",
        body: SPLIT_BODY,
        tags: &["sample", "editor"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Quick memos",
        body: MEMOS_BODY,
        tags: &["sample", "memo"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Images and covers",
        body: IMAGES_BODY,
        tags: &["sample", "library"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Export to Markdown and PDF",
        body: EXPORT_BODY,
        tags: &["sample", "export"],
        pinned: false,
        favorite: false,
    },
    Sample {
        title: "Settings",
        body: SETTINGS_BODY,
        tags: &["sample", "settings"],
        pinned: false,
        favorite: false,
    },
];

fn lock(db: &AppDb) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    db.0.lock().map_err(|err| err.to_string())
}

fn sql(err: rusqlite::Error) -> String {
    err.to_string()
}

/// Creates a "Samples" folder (or "Samples (2)", ...) holding the tour, a "Features"
/// subfolder with one note per feature, and a sample memo.
#[tauri::command]
pub fn create_samples(db: State<AppDb>) -> Result<SampleSet, String> {
    let conn = lock(&db)?;
    let tx = conn.unchecked_transaction().map_err(sql)?;
    let set = create(&tx)?;
    tx.commit().map_err(sql)?;
    Ok(set)
}

fn create(conn: &Connection) -> Result<SampleSet, String> {
    let root = free_folder(conn, "Samples")?;
    let features = organize::new_folder(conn, "Features", Some(&root.id))?;
    let limit = settings::max_tags(conn)?;

    let mut ids = Vec::new();
    let tour_id = add(conn, &TOUR, &root.id, limit)?;
    ids.push(tour_id.clone());
    for sample in FEATURES {
        let id = add(conn, sample, &features.id, limit)?;
        if sample.title == "Version timeline" {
            add_history(conn, &id)?;
        }
        ids.push(id);
    }
    ids.push(add_memo(conn, &root.id, limit)?);

    // Links can only resolve once every sample exists.
    for id in &ids {
        links::sync_document(conn, id)?;
    }
    // The tour stays first among the samples when sorted by "updated".
    conn.execute(
        "UPDATE documents SET updated_at = ?1 WHERE id = ?2",
        params![now_ms() + 1, tour_id],
    )
    .map_err(sql)?;
    Ok(SampleSet {
        folder_id: root.id,
        tour_id,
        created: ids.len(),
    })
}

fn free_folder(conn: &Connection, name: &str) -> Result<organize::Folder, String> {
    let mut attempt = 1;
    loop {
        let candidate = if attempt == 1 {
            name.to_string()
        } else {
            format!("{name} ({attempt})")
        };
        match organize::new_folder(conn, &candidate, None) {
            Ok(folder) => return Ok(folder),
            Err(err) if err.starts_with("There is already a folder") && attempt < 100 => attempt += 1,
            Err(err) => return Err(err),
        }
    }
}

fn add(conn: &Connection, sample: &Sample, folder_id: &str, limit: u32) -> Result<String, String> {
    let note = documents::create(conn)?;
    documents::update(conn, &note.id, sample.title, sample.body)?;
    finish(conn, &note.id, folder_id, sample.tags, sample.pinned, sample.favorite, limit)?;
    Ok(note.id)
}

fn add_memo(conn: &Connection, folder_id: &str, limit: u32) -> Result<String, String> {
    let memo = documents::create_kind(conn, "memo")?;
    documents::update(conn, &memo.id, "", MEMO_BODY)?;
    conn.execute(
        "UPDATE documents SET color = 'yellow' WHERE id = ?1",
        [&memo.id],
    )
    .map_err(sql)?;
    finish(conn, &memo.id, folder_id, &["sample", "memo"], true, false, limit)?;
    Ok(memo.id)
}

fn finish(
    conn: &Connection,
    id: &str,
    folder_id: &str,
    tags: &[&str],
    pinned: bool,
    favorite: bool,
    limit: u32,
) -> Result<(), String> {
    organize::set_folder(conn, id, Some(folder_id))?;
    let tags: Vec<String> = tags.iter().take(limit as usize).map(|tag| tag.to_string()).collect();
    organize::set_tags(conn, id, &tags, limit)?;
    if pinned {
        organize::set_pinned(conn, id, true)?;
    }
    if favorite {
        conn.execute("UPDATE documents SET favorite = 1 WHERE id = ?1", [id])
            .map_err(sql)?;
    }
    Ok(())
}

/// Three earlier drafts, spread over the last few days, so the timeline has something to show.
fn add_history(conn: &Connection, id: &str) -> Result<(), String> {
    let now = now_ms();
    let drafts = [
        (TIMELINE_DRAFT_1, now - 2 * DAY_MS - 3 * HOUR_MS),
        (TIMELINE_DRAFT_2, now - DAY_MS - 5 * HOUR_MS),
        (TIMELINE_FINAL, now - 2 * HOUR_MS),
    ];
    for (body, at) in drafts {
        conn.execute(
            "UPDATE documents SET body = ?1 WHERE id = ?2",
            params![body, id],
        )
        .map_err(sql)?;
        if versions::record_if_changed(conn, id)? {
            conn.execute(
                "UPDATE document_versions SET created_at = ?1
                 WHERE id = (SELECT id FROM document_versions WHERE document_id = ?2
                             ORDER BY rowid DESC LIMIT 1)",
                params![at, id],
            )
            .map_err(sql)?;
        }
    }
    Ok(())
}

const TOUR_BODY: &str = r##"# A quick tour

Eyja is a place for ==notes you keep== and **memos you jot down**. Everything here is a sample: edit it, move it, or delete the whole "Samples" folder when you are done.

## Where things are

- **Library** (the home page): every note and memo, with views, folders, tags and search.
- **Editor**: opens when you click a document. Up to two sides, three tabs each.
- **Memo windows**: small floating notes, opened with `Ctrl+Shift+M` from anywhere.

## Feature notes

Each note below covers one part of Eyja. Click a link to open it.

1. [[Writing and formatting]] — headings, emphasis, ++larger words++, [colours]{.blue}, lists, tables, code.
2. [[Math with LaTeX]] — $e^{i\pi} + 1 = 0$ and display maths.
3. [[Links between notes]] — `[[ ]]` links, the reference picker, and how links are kept.
4. [[Tags, folders and pins]] — organise the library.
5. [[Search: keyword and similar]] — find by words or by likeness.
6. [[Version timeline]] — automatic versions, `Ctrl+S`, restore.
7. [[Split editor and tabs]] — two sides, drag tabs around.
8. [[Quick memos]] — floating sticky notes.
9. [[Images and covers]] — paste images, pick a cover.
10. [[Export to Markdown and PDF]] — take a note out of Eyja.
11. [[Settings]] — text, windows, memos, timeline and tags.

## Try this now

- [ ] Open [[Writing and formatting]] in the right side: click the split button at the top right.
- [ ] Add a tag to this note with **+ Tag** above the title.
- [ ] Search the library for `heat` with **Keyword**, then with **Similar**.
- [x] Load the sample notes.
"##;

const FORMATTING_BODY: &str = r##"# Writing and formatting

Eyja writes plain Markdown and shows it as you type. The marks fade out when the cursor leaves them, and come back when you click into the text.

## Emphasis

*Italic*, **bold**, ***both***, ~~struck out~~ and `inline code`.

==Highlighted words== use `==two equals==`. The highlight colour is in Settings → Text & colors.

++Larger words++ use `++two pluses++`. Select words and press the **A↑** button in the floating bubble to do the same.

## Colours

Select words, then pick a dot in the floating bubble at the bottom:

- [Amber]{.amber}, [red]{.red}, [green]{.green}, [blue]{.blue} and [violet]{.violet}.
- Or any colour from the last swatch: [like this one]{color="#0ea5e9"}.
- The first dot puts the default colour back.

In the Markdown these are `[words]{.red}` and `[words]{color="#0ea5e9"}`.

## Headings

Start a line with `#` to `######`.

#### A fourth-level heading

## Lists and tasks

- A bullet
  - A nested bullet
1. A numbered item
2. Another one

- [ ] An open task
- [x] A finished task

## Quotes

> A quoted line. The bar on the left uses the quote colour from settings.

## Tables

| Feature | Shortcut |
| --- | --- |
| Save a version | `Ctrl+S` |
| Toggle the sidebar | `Ctrl+\` |
| New memo window | `Ctrl+Shift+M` |

## Code

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

## Slash commands

Type `/` at the start of a word for a list: `/table`, `/math`, `/matrix`, `/code` and `/big`. Press `Tab` to move through the fields.

## Links

A normal web link: [Markdown guide](https://commonmark.org/help/). Links to other notes are in [[Links between notes]].

Back to [[Welcome to Eyja]].
"##;

const MATH_BODY: &str = r##"# Math with LaTeX

Write TeX between dollar signs. Eyja renders it with KaTeX, and a small preview floats above the line while you type. Click a display block to edit it in a pop-up with a live preview; Ctrl+Enter finishes and Esc cancels. Tables and code blocks open the same way.

## Inline

The heat equation $\partial_t u = \Delta u$ sits inside a sentence, and so does $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$.

## Display

$$
\mathcal{L}_{\text{sym}} = I - D^{-1/2} A D^{-1/2}
$$

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Matrices and alignment

$$
\begin{bmatrix}
2 & -1 & 0 \\
-1 & 2 & -1 \\
0 & -1 & 2
\end{bmatrix}
$$

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

## Tips

- Type `/math` or `/matrix` for a ready-made block.
- Inside a formula, start typing a command such as `\fr` for suggestions.
- Exported PDFs keep the rendered maths, see [[Export to Markdown and PDF]].

Back to [[Welcome to Eyja]].
"##;

const LINKS_BODY: &str = r##"# Links between notes

Put a note's title between double brackets to link to it: [[Welcome to Eyja]]. Click the link to open that note.

## Ways to write a link

- Plain: [[Math with LaTeX]]
- With other words shown after a bar: [[Version timeline|the timeline note]]
- To a section, after a hash: [[Writing and formatting#Tables]]

All three open the note named before the `|` or `#`.

## Making links quickly

- Type `[[` and a list of titles appears. Keep typing to filter, press `Enter` to insert.
- Or press the **[[ ]]** button in the top bar for the reference picker: search by title or tag, use the arrow keys, and press `Enter`.

## What Eyja remembers

Every link is saved together with the sentence it sits in, so a later graph view can show *why* two notes are connected. When you rename a note, links to its old title are checked again.

Links are not counted inside code, so `[[this]]` is not a link.

Back to [[Welcome to Eyja]].
"##;

const ORGANIZE_BODY: &str = r##"# Tags, folders and pins

## Tags

- Click **+ Tag** above a note's title, type a name and press `Enter` (or a comma).
- A note has at most 5 tags by default; change the number in [[Settings]].
- `Backspace` in an empty tag box removes the last tag.
- Click a tag in the library sidebar to show only notes with it.

This note has the tags *sample* and *library*.

## Folders

- Folders can sit inside folders, like **Samples → Features** here.
- Create one with the folder **+** button in the library, rename or delete it from its row.
- Drag a note from the library list onto a folder to move it; drop it on the **Folders** heading to take it out of every folder.
- In the editor, the folder name at the top left also moves the note.
- Deleting a folder keeps its notes: they move up one level.

## Pins and favourites

- **Pin** puts a note in the *Pinned* row at the top of the library. [[Welcome to Eyja]] is pinned.
- **Star** marks a favourite. [[Writing and formatting]] is a favourite.
- Both show up under *Pinned & favorites* in the library sidebar.

## Covers

A pinned note can show one of its own images as a cover, see [[Images and covers]].

Back to [[Welcome to Eyja]].
"##;

const SEARCH_BODY: &str = r##"# Search: keyword and similar

The search box at the top of the library has three modes.

## Keyword

Finds notes that contain the words you type, in the title or the text. Titles count more. It also works in the middle of words and for Chinese, for example 熱方程式 or 拉普拉斯.

Try: `laplacian`, `heat`, `熱方程式`.

## Similar

Finds notes that *read alike*, even without the exact words. It compares the letters and word pieces of your query with every note, all on your computer; nothing is downloaded.

Try typing a sentence, such as `how do I keep old drafts of a note`, and [[Version timeline]] should be near the top.

## Both

Mixes the two lists, so notes that match either way are near the top.

## Find similar notes

Each row in the library has a **find similar** button. It lists the notes closest to that one, with a similarity score.

## Sample text to search

熱方程式描述熱在物體中如何隨時間擴散。圖上的拉普拉斯算子是它的離散版本。

The heat equation describes how heat spreads through a body over time; the graph Laplacian is its discrete cousin.

Back to [[Welcome to Eyja]].
"##;

const TIMELINE_DRAFT_1: &str = r##"# Version timeline

First draft: Eyja saves versions of a note.
"##;

const TIMELINE_DRAFT_2: &str = r##"# Version timeline

Second draft: Eyja saves versions of a note while you write.

- After a pause in typing.
- During long stretches of typing.
"##;

const TIMELINE_FINAL: &str = r##"# Version timeline

Eyja keeps earlier versions of every note, so old drafts are never lost. This note already has three: open the timeline with the clock button at the top right.

## When a version is saved

- After you stop typing for **2 minutes**.
- At least every **5 minutes** while you keep typing.
- Whenever you press `Ctrl+S`.

The status pill at the top shows whether the latest text is in the timeline yet. Both intervals can be changed in [[Settings]].

## Looking back

- Click a version in the timeline to preview it. Changed lines are marked.
- **Restore** puts that version back as the current text. The text you had is saved as a version first, so nothing is lost.

## Keeping it small

Versions are stored as small differences from the one before, with a full copy now and then. In [[Settings]] you can also choose **Last per day**: today keeps every version, and each earlier day keeps only its last one.

Back to [[Welcome to Eyja]].
"##;

const SPLIT_BODY: &str = r##"# Split editor and tabs

## Two sides

- The split button at the top right opens a right side next to the note you are on.
- Each side holds up to **3 tabs**. Opening a fourth replaces the active tab on that side.
- Click inside a side to make it active; the top bar's buttons act on the active note.

## Moving tabs

- Drag a tab to reorder it, or drag it to the other side.
- The arrow at the end of a tab row moves the active tab to the other side.
- Drag a note from **Recent** in the sidebar onto a tab row to open it there.
- Drop on the right edge of the editor to open a right side.

## Try it

Open [[Math with LaTeX]] on the left and [[Writing and formatting]] on the right, then drag one tab across.

## Other shortcuts

- `Ctrl+\` hides or shows the sidebar.
- **Library** at the top of the sidebar goes back to the home page. Your tabs stay open.

Back to [[Welcome to Eyja]].
"##;

const MEMOS_BODY: &str = r##"# Quick memos

Memos are small floating notes for things you want to jot down *right now*.

## Opening a memo

- Press `Ctrl+Shift+M` anywhere, even when Eyja is in the tray.
- Or use the memo button in the library or the editor sidebar.

## In a memo window

- Pick a colour from the palette; there are six.
- Pin the window to keep it above other windows.
- Paste or drop images and files.
- Add tags with the tag button at the bottom.
- **Open in editor** turns the memo into a full tab here.

Memos also appear in the library under *Memos*. There is a yellow sample memo pinned in the Samples folder.

## Cleaning up

Empty memos disappear when you close them. In [[Settings]] you can have memos older than a number of days deleted automatically.

Back to [[Welcome to Eyja]].
"##;

const IMAGES_BODY: &str = r##"# Images and covers

## Adding images

- Paste an image from the clipboard straight into a note.
- Images are copied into Eyja, so the original file can move or disappear.
- In the Markdown an image looks like `![name](asset:...)`; Eyja shows the picture instead.

## Covers

Once a note has images, the image button in the top bar lets you pick one as the note's **cover**. It shows as a banner above the title and on the note's card in the library's *Pinned* row.

Try it: paste any picture below this line, then pick it as the cover.



Organising notes is covered in [[Tags, folders and pins]].

Back to [[Welcome to Eyja]].
"##;

const EXPORT_BODY: &str = r##"# Export to Markdown and PDF

The export button in the top bar takes a note out of Eyja.

## Markdown

Saves the note as a `.md` file with its images in a folder beside it, so other Markdown apps can open it.

## PDF

Lays the note out on pages (A4, Letter or A5) with the title at the top of each page and page numbers. Rendered maths, highlights, larger words and [coloured words]{.violet} are kept.

$$
\hat{f}(\xi) = \int_{\mathbb{R}} f(x)\, e^{-2\pi i x \xi}\, dx
$$

Try exporting this note as a PDF to see it.

Back to [[Welcome to Eyja]].
"##;

const SETTINGS_BODY: &str = r##"# Settings

Open settings with the gear at the bottom of the sidebar.

## Text & colors

Typeface (sans, serif, mono), text size, line spacing, and the colours for highlights, links and quotes. Size, typeface and spacing can also be changed from the floating bubble in the editor.

## Windows

The starting size of the main window and of memo windows.

## Quick memo

The shortcut for a new memo (default `Ctrl+Shift+M`), and how many days memos are kept.

## Timeline & tags

- Minutes of no typing before a version is saved (default 2).
- Minutes of typing before a version is saved (default 5).
- Keep every version, or only the last one of each earlier day.
- The most tags a note can have (default 5).

See [[Version timeline]] and [[Tags, folders and pins]].

Back to [[Welcome to Eyja]].
"##;

const MEMO_BODY: &str = r##"Sample memo: press Ctrl+Shift+M for a new one.

- [ ] Try a colour from the palette
- [ ] Pin this window on top
- [ ] Open it in the editor

More in [[Quick memos]].
"##;

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
    fn samples_are_filed_tagged_and_linked() {
        let conn = test_db();
        let set = create(&conn).unwrap();
        assert_eq!(set.created, FEATURES.len() + 2);

        let tour = documents::get(&conn, &set.tour_id).unwrap().unwrap();
        assert_eq!(tour.title, "Welcome to Eyja");
        assert!(tour.pinned);
        assert_eq!(tour.folder_id.as_deref(), Some(set.folder_id.as_str()));

        // Every [[link]] in the samples points at another sample.
        let titles: Vec<&str> = std::iter::once(&TOUR).chain(FEATURES).map(|sample| sample.title).collect();
        for body in std::iter::once(TOUR.body)
            .chain(FEATURES.iter().map(|sample| sample.body))
            .chain([MEMO_BODY])
        {
            for reference in links::wiki_refs(body) {
                assert!(titles.contains(&reference.title.as_str()), "{}", reference.title);
            }
        }
        let from_tour: i64 = conn
            .query_row("SELECT COUNT(DISTINCT target_id) FROM links WHERE source_id = ?1", [&set.tour_id], |row| row.get(0))
            .unwrap();
        assert_eq!(from_tour as usize, FEATURES.len());

        let timeline: String = conn
            .query_row("SELECT id FROM documents WHERE title = 'Version timeline'", [], |row| row.get(0))
            .unwrap();
        let versions: i64 = conn
            .query_row("SELECT COUNT(*) FROM document_versions WHERE document_id = ?1", [&timeline], |row| row.get(0))
            .unwrap();
        assert_eq!(versions, 3);

        // The "Similar" example in the search note.
        let hits = crate::search::similar_to_text(&conn, "how do I keep old drafts of a note", None, 3).unwrap();
        let top: Vec<String> = hits
            .iter()
            .map(|hit| documents::get(&conn, &hit.id).unwrap().unwrap().title)
            .collect();
        assert!(top.iter().any(|title| title == "Version timeline"), "{top:?}");

        // A second load goes into its own folder.
        let again = create(&conn).unwrap();
        let name: String = conn
            .query_row("SELECT name FROM folders WHERE id = ?1", [&again.folder_id], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "Samples (2)");
    }
}
