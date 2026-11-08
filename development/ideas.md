# Ideas backlog

Ideas that are not in any phase yet. Phase 2–4 topics (import, LaTeX compile, sharing, agent, graph, sync, encryption) are already planned elsewhere and are not repeated here.

Tick an item and write the decision after `A:` when you decide; leave unsure ones unticked.

---

## Features

### Uses data the app already has

- [ ] **Backlinks panel.** The `links` table already stores every `[[link]]` with the sentence around it. A side panel "Linked from: *Note A* — '…the sentence…'" makes links two-way. First step toward the phase 4 graph.

  A:

- [ ] **Trash with restore.** Deleting only sets `deleted_at`; the note and its images stay. Add a "Trash" view in the library with Restore and Delete forever (and maybe empty after N days, like memo expiry).

  A:

- [ ] **Unlinked mentions.** Find places where a note's title appears as plain text without `[[ ]]`, with one click to turn it into a link. The FTS5 index can find these quickly.

  A:

- [ ] **Related notes.** Show the top few "similar" notes under the editor or in the backlinks panel, using the existing similarity search.

  A:

### Writing speed

- [ ] **Quick switcher (Ctrl+P).** Type part of a title to jump to any note; create it if nothing matches.

  A:

- [ ] **Command palette (Ctrl+Shift+P).** Every action (new note, export, split, toggle font, open memo…) searchable by name, with its shortcut shown.

  A:

- [ ] **Outline.** Heading list for long notes, click to jump. Also makes `[[Note#section]]` scroll to the heading instead of only opening the note.

  A:

- [ ] **Word and character count**, for the whole note and for the selection.

  A:

- [ ] **Note templates.** Mark any note as a template; "New from template" copies it, with `{{date}}` / `{{title}}` filled in.

  A:

- [ ] **Daily note.** One shortcut opens (or creates) today's note in a "Journal" folder.

  A:

### Content

- [ ] **Footnotes** `[^1]` and **callouts** `> [!note]`, rendered in place and kept in PDF export.

  A:

- [ ] **Mermaid diagrams** in ` ```mermaid ` blocks, rendered live, edited in the block pop-up with preview.

  A:

- [ ] **Inline maths pop-up.** `$…$` currently has the floating preview only; clicking rendered inline maths could open the same pop-up as display blocks.

  A:

- [ ] **Table grid editor.** In the table pop-up, edit cells in a grid (Tab to next cell, buttons to add/remove rows and columns, column alignment) instead of raw `|` text.

  A:

- [ ] **Image controls.** Click an image to see it large; set width (e.g. `![alt](asset:id){width=50%}`); caption from the alt text.

  A:

- [ ] **Paste smarter.** Pasting HTML (from a web page) becomes Markdown; pasting a URL on a selection makes a link.

  A:

### Safety and data

- [ ] **Backup to a zip.** One button that copies the SQLite file and `assets/` into a dated zip, plus an optional automatic weekly backup. Matters until sync exists.

  A:

- [ ] **Export whole folder / all notes** as Markdown files with an `assets/` folder, so data is never locked in.

  A:

- [ ] **Version diff.** In the timeline, show what changed between a version and the current text (added green, removed red) before restoring.

  A:

---

## UX / UI suggestions

### Editor

- [ ] **Keep heading size when its `##` shows.** Revealing a heading's source drops the heading style, so the line shrinks (e.g. 34px → 24px). Keeping the size and only fading the `##` in stops text below from jumping when you click a heading.

  A:

- [ ] **Open blocks from the keyboard.** The block pop-up only opens on click. Pressing Enter when the cursor is next to a rendered block (or a shortcut like Ctrl+E) could open it.

  A:

- [ ] **Text bubble only when useful.** The colour and enlarge buttons do nothing without a selection. Either show the bubble only while text is selected (Notion style), or dim those buttons and say "select text first" in the tooltip.

  A:

- [ ] **Leave room for the bubble.** The bubble floats at the bottom centre and can cover the last lines; add bottom padding to the editor equal to its height.

  A:

- [ ] **Save status.** A small "Saved" / "Saving…" / "Unsaved" hint near the title, so autosave is visible and Ctrl+S feels confirmed.

  A:

- [ ] **Focus mode.** Hide the sidebar and toolbars, centre the text column, optionally dim every paragraph except the current one. Typewriter scrolling (current line stays mid-screen) fits here too.

  A:

- [ ] **Readable line length.** Cap the text column at about 70–80 characters on wide windows, with a setting to turn it off.

  A:

- [ ] **Missing link targets.** Show `[[links]]` to notes that do not exist in a different style (dashed / muted), and offer "Create note" on click.

  A:

### Library

- [ ] **Undo instead of confirm dialogs.** For delete / move, do it immediately and show a toast "Deleted · Undo" for a few seconds. Faster than a confirm box, and safe once Trash exists.

  A:

- [ ] **Drag and drop.** Drag notes onto folders in the sidebar; drag folders into folders.

  A:

- [ ] **Multi-select.** Shift/Ctrl-click notes to tag, move, pin or delete several at once.

  A:

- [ ] **Search results with context.** Show the matching snippet with the words highlighted, and highlight them in the note after opening it.

  A:

- [ ] **Sort and view options.** Sort by updated / created / title; compact list vs. cards with covers.

  A:

### Memo

- [ ] **Memo → note.** One button turns a memo into a full note (keeping its tags and files), or appends it to an existing note.

  A:

- [ ] **Memo list in the library.** See and search all memos from the main window, not only through their small windows.

  A:

### General

- [ ] **Shortcut cheat sheet** (Ctrl+/) listing every shortcut, also reachable from settings.

  A:

- [ ] **Theme follows the system** light/dark setting, with a manual override.

  A:

- [ ] **Accessibility pass.** Visible keyboard focus rings everywhere; check the contrast of muted text and faint controls (e.g. tag remove buttons at 35% opacity); make small targets like the colour dots at least ~24px to click.

  A:

- [ ] **Remember window state.** Reopen with the same notes, split layout, scroll positions and window size as last time.

  A:

---

## My notes

