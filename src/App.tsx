import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { type Asset, imageMarkdown, imageResolver, savePastedImages } from "./assets";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { TextBubble } from "./editor/TextBubble";
import { buildPdfHtml, type ExportImage, type PaperSize } from "./export/printDocument";
import { Icon, SymButton } from "./memo/Icon";
import { SettingsPanel } from "./settings/SettingsPanel";
import { shortAge, timelineTime } from "./time";

type NoteSummary = {
  id: string;
  title: string;
  updatedAt: number;
};

type Note = {
  id: string;
  kind: "note" | "memo";
  title: string;
  body: string;
  color: string | null;
  updatedAt: number;
};

type Draft = {
  id: string;
  title: string;
  body: string;
};

type VersionSummary = {
  id: string;
  createdAt: number;
  checkpoint: boolean;
};

type HistoryState = {
  latestBody: string | null;
  versions: VersionSummary[];
};

type VersionPreview = {
  id: string;
  createdAt: number;
  body: string;
};

const SAVE_DELAY_MS = 500;
const HISTORY_IDLE_MS = 2 * 60 * 1000;
const HISTORY_TYPING_MS = 5 * 60 * 1000;
// Mirrors `CHECKPOINT_EVERY` in src-tauri/src/versions.rs.
const PATCHES_PER_CHECKPOINT = 20;

function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

function exportFileName(title: string) {
  const cleaned = displayTitle(title).replace(/[<>:"/\\|?*]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

function historyKind(body: string, timelineBody: string | null) {
  if (timelineBody === null) {
    return body.length === 0 ? "none" : "pending";
  }
  return timelineBody === body ? "in" : "pending";
}

type StatusPill = { tone: "saved" | "pending" | "preview"; text: string; tip: string };

function statusPill(
  status: string,
  kind: "none" | "pending" | "in",
  preview: VersionPreview | null,
): StatusPill | null {
  if (preview) {
    return {
      tone: "preview",
      text: `Previewing ${timelineTime(preview.createdAt)}`,
      tip: "Read-only. Restore it from the timeline, or go back to the current text.",
    };
  }
  if (status === "Saving..." || status === "Exporting...") {
    return { tone: "pending", text: status, tip: "Writing to disk" };
  }
  if (status === "Exported") {
    return { tone: "saved", text: status, tip: "The export file was written" };
  }
  if (status !== "Saved") return null;
  if (kind === "in") {
    return { tone: "saved", text: "Saved · in history", tip: "Matches the latest version on the timeline" };
  }
  if (kind === "pending") {
    return {
      tone: "pending",
      text: "Saved · not in history",
      tip: "Added to the timeline after 2 minutes idle, 5 minutes of typing, or Ctrl+S",
    };
  }
  return { tone: "saved", text: "Saved", tip: "Nothing to add to the timeline yet" };
}

/** Badge per version: full copies are checkpoints, the rest are numbered patches after one. */
function versionBadges(versions: VersionSummary[]) {
  const badges = new Map<string, string>();
  let patch = 0;
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const version = versions[index];
    if (version.checkpoint) {
      patch = 0;
      badges.set(version.id, "Checkpoint");
    } else {
      patch += 1;
      badges.set(version.id, `Patch #${patch}`);
    }
  }
  return badges;
}

function App() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [current, setCurrent] = useState<Note | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [timelineBody, setTimelineBody] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [exporting, setExporting] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const exportRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<Note | null>(null);
  const lastSavedRef = useRef<Draft | null>(null);
  const timerRef = useRef<number | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const timelineBodyRef = useRef<string | null>(null);
  const previewRef = useRef<VersionPreview | null>(null);
  const idleHistoryRef = useRef<number | null>(null);
  const typingHistoryRef = useRef<number | null>(null);
  timelineBodyRef.current = timelineBody;
  previewRef.current = preview;

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const refresh = useCallback(async () => {
    const listed = await invoke<NoteSummary[]>("list_documents");
    setNotes(listed);
    return listed;
  }, []);

  const persist = useCallback(async (draft: Draft) => {
    const saved = lastSavedRef.current;
    if (
      saved &&
      saved.id === draft.id &&
      saved.title === draft.title &&
      saved.body === draft.body
    ) {
      return;
    }
    setStatus("Saving...");
    await invoke("update_document", {
      id: draft.id,
      title: draft.title,
      body: draft.body,
    });
    lastSavedRef.current = draft;
    setStatus("Saved");
    const listed = await invoke<NoteSummary[]>("list_documents");
    setNotes(listed);
  }, []);

  const clearHistoryTimers = useCallback(() => {
    if (idleHistoryRef.current !== null) {
      window.clearTimeout(idleHistoryRef.current);
      idleHistoryRef.current = null;
    }
    if (typingHistoryRef.current !== null) {
      window.clearTimeout(typingHistoryRef.current);
      typingHistoryRef.current = null;
    }
  }, []);

  const applyHistory = useCallback((state: HistoryState) => {
    timelineBodyRef.current = state.latestBody;
    setTimelineBody(state.latestBody);
    setVersions(state.versions);
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const draft = currentRef.current;
    if (!draft) {
      return;
    }
    await persist(draft);
  }, [persist]);

  const commitHistory = useCallback(
    async (id: string) => {
      clearHistoryTimers();
      if (previewRef.current || currentRef.current?.id !== id) return;
      await flush();
      if (previewRef.current || currentRef.current?.id !== id) return;
      const state = await invoke<HistoryState>("record_version", { id });
      if (currentRef.current?.id !== id) return;
      applyHistory(state);
    },
    [applyHistory, clearHistoryTimers, flush],
  );

  useEffect(() => {
    if (!current) {
      return;
    }
    const saved = lastSavedRef.current;
    if (
      saved &&
      saved.id === current.id &&
      saved.title === current.title &&
      saved.body === current.body
    ) {
      return;
    }
    const draft = {
      id: current.id,
      title: current.title,
      body: current.body,
    };
    timerRef.current = window.setTimeout(() => {
        void persist(draft).catch((err: unknown) => {
        setError(String(err));
        setStatus("");
      });
    }, SAVE_DELAY_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [current, persist]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(String(err)));
  }, [refresh]);

  useEffect(() => {
    if (!current || preview) {
      clearHistoryTimers();
      return;
    }
    if (historyKind(current.body, timelineBody) !== "pending") {
      clearHistoryTimers();
      return;
    }
    const id = current.id;
    if (idleHistoryRef.current !== null) {
      window.clearTimeout(idleHistoryRef.current);
    }
    idleHistoryRef.current = window.setTimeout(() => {
      idleHistoryRef.current = null;
      void commitHistory(id).catch((err: unknown) => {
        setError(String(err));
        setHistoryNonce((value) => value + 1);
      });
    }, HISTORY_IDLE_MS);
    // The 5-minute timer stays across keystrokes. Only the idle timer resets.
    if (typingHistoryRef.current === null) {
      typingHistoryRef.current = window.setTimeout(() => {
        typingHistoryRef.current = null;
        void commitHistory(id).catch((err: unknown) => {
          setError(String(err));
          setHistoryNonce((value) => value + 1);
        });
      }, HISTORY_TYPING_MS);
    }
    return () => {
      if (idleHistoryRef.current !== null) {
        window.clearTimeout(idleHistoryRef.current);
        idleHistoryRef.current = null;
      }
    };
  }, [clearHistoryTimers, commitHistory, current, historyNonce, preview, timelineBody]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const draft = currentRef.current;
        if (!draft || previewRef.current) return;
        void commitHistory(draft.id).catch((err: unknown) => setError(String(err)));
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitHistory]);

  useEffect(() => {
    if (!exportOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [exportOpen]);

  const openNoteRef = useRef<(id: string) => Promise<void>>(async () => {});

  useEffect(() => {
    const open = (id: string) =>
      void openNoteRef.current(id).catch((err: unknown) => setError(String(err)));
    const unlisten = listen<string>("open-document", (event) => open(event.payload));
    // A memo can ask for the editor while this window is closed; it is handed over here.
    void invoke<string | null>("take_pending_document").then((id) => {
      if (id) open(id);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  const resolveImage = useMemo(() => imageResolver(assets), [assets]);

  async function pasteImages(files: File[]) {
    const note = currentRef.current;
    if (!note || previewRef.current) return;
    setError("");
    try {
      const saved = await savePastedImages(note.id, files);
      if (currentRef.current?.id !== note.id) return;
      setAssets((list) => [...list, ...saved]);
      editorRef.current?.insert(`${saved.map(imageMarkdown).join("\n")}\n`);
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function openNote(id: string) {
    setError("");
    clearHistoryTimers();
    setPreview(null);
    await flush();
    const [note, noteAssets] = await Promise.all([
      invoke<Note>("get_document", { id }),
      invoke<Asset[]>("list_assets", { documentId: id }),
    ]);
    currentRef.current = note;
    lastSavedRef.current = {
      id: note.id,
      title: note.title,
      body: note.body,
    };
    timelineBodyRef.current = null;
    setTimelineBody(null);
    setVersions([]);
    setAssets(noteAssets);
    setCurrent(note);
    setStatus("Saved");
    try {
      const state = await invoke<HistoryState>("history_state", { id: note.id });
      if (currentRef.current?.id !== note.id) return;
      applyHistory(state);
    } catch (err: unknown) {
      setError(String(err));
    }
  }
  openNoteRef.current = openNote;

  async function createNote() {
    setError("");
    clearHistoryTimers();
    setPreview(null);
    await flush();
    const note = await invoke<Note>("create_document");
    currentRef.current = note;
    lastSavedRef.current = {
      id: note.id,
      title: note.title,
      body: note.body,
    };
    timelineBodyRef.current = null;
    setTimelineBody(null);
    setVersions([]);
    setAssets([]);
    setCurrent(note);
    setStatus("Saved");
    await refresh();
  }

  async function deleteNote() {
    if (!current) {
      return;
    }
    const question =
      current.kind === "memo"
        ? "Delete this memo? Its copied files and folders are removed from disk."
        : "Delete this note?";
    if (!(await confirm(question, { kind: "warning", okLabel: "Delete" }))) {
      return;
    }
    setError("");
    const id = current.id;
    clearHistoryTimers();
    setPreview(null);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await invoke("delete_document", { id });
    currentRef.current = null;
    lastSavedRef.current = null;
    timelineBodyRef.current = null;
    setTimelineBody(null);
    setVersions([]);
    setAssets([]);
    setCurrent(null);
    setStatus("");
    await refresh();
  }

  async function showVersion(versionId: string) {
    if (!current) return;
    setError("");
    try {
      const next = await invoke<VersionPreview>("get_version", {
        id: current.id,
        version: versionId,
      });
      if (currentRef.current?.id !== current.id) return;
      setPreview(next);
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function restorePreview() {
    if (!current || !preview) return;
    if (
      !(await confirm("Restore this version? The current text is kept in history first.", {
        okLabel: "Restore",
      }))
    ) {
      return;
    }
    setError("");
    clearHistoryTimers();
    try {
      await flush();
      const note = await invoke<Note>("restore_version", {
        id: current.id,
        version: preview.id,
      });
      currentRef.current = note;
      lastSavedRef.current = {
        id: note.id,
        title: note.title,
        body: note.body,
      };
      setPreview(null);
      setCurrent(note);
      setStatus("Saved");
      const state = await invoke<HistoryState>("history_state", { id: note.id });
      if (currentRef.current?.id !== note.id) return;
      applyHistory(state);
      await refresh();
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  function toggleHistory() {
    if (historyOpen) setPreview(null);
    setHistoryOpen((open) => !open);
  }

  async function exportCurrent(kind: "markdown" | "pdf") {
    const note = currentRef.current;
    if (!note || previewRef.current || exporting) return;
    setExportOpen(false);
    const extension = kind === "markdown" ? "md" : "pdf";
    const path = await save({
      defaultPath: `${exportFileName(note.title)}.${extension}`,
      filters: [
        {
          name: kind === "markdown" ? "Markdown" : "PDF",
          extensions: [extension],
        },
      ],
    });
    if (!path || previewRef.current || currentRef.current?.id !== note.id) return;
    setExporting(true);
    setError("");
    try {
      await flush();
      if (previewRef.current || currentRef.current?.id !== note.id) return;
      setStatus("Exporting...");
      if (kind === "markdown") {
        await invoke("export_markdown", { id: note.id, path });
      } else {
        const source = await invoke<{ title: string; body: string; images: ExportImage[] }>(
          "export_source",
          { id: note.id },
        );
        const html = await buildPdfHtml(source.title, source.body, source.images, paper);
        await invoke("export_pdf", { path, html });
      }
      if (currentRef.current?.id === note.id) setStatus("Exported");
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setExporting(false);
    }
  }

  const pill = current
    ? statusPill(status, historyKind(current.body, timelineBody), preview)
    : null;
  const badges = versionBadges(versions);
  const kindLabel = current?.kind === "memo" ? "memo" : "note";

  return (
    <div className="shell">
      {sidebarOpen ? (
        <aside className="sidebar">
          <div className="brand-bar">
            <div className="brand-id">
              <div className="brand-mark">E</div>
              <span>Eyja</span>
            </div>
            <div className="brand-actions">
              <SymButton icon="plus" label="New note" onClick={() => void createNote()} />
              <SymButton
                icon="memo"
                label="New memo window"
                tipAlign="right"
                onClick={() =>
                  void invoke("open_memo", { id: null }).catch((err: unknown) =>
                    setError(String(err)),
                  )
                }
              />
            </div>
          </div>
          <div className="nav-label">
            <span>Recent</span>
            <span>{notes.length}</span>
          </div>
          {notes.length === 0 ? (
            <p className="sidebar-empty">No notes yet.</p>
          ) : (
            <ul className="recent-list">
              {notes.map((note) => {
                const active = note.id === current?.id;
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      className={active ? "nav-item active" : "nav-item"}
                      onClick={() => void openNote(note.id)}
                    >
                      <span className="nav-item-icon">
                        {active ? <span className="nav-dot" /> : <Icon name="file" size={14} />}
                      </span>
                      <span className="nav-item-title">{displayTitle(note.title)}</span>
                      <span className="nav-time">{shortAge(note.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="sidebar-footer">
            <SymButton
              icon="settings"
              label="Settings"
              tipPos="top"
              tipAlign="left"
              onClick={() => setSettingsOpen(true)}
            />
          </div>
        </aside>
      ) : null}
      <main className="workspace">
        <header className="workspace-topbar">
          <div className="topbar-left">
            <SymButton
              icon="sidebar"
              label="Toggle sidebar (Ctrl+\)"
              tipAlign="left"
              onClick={() => setSidebarOpen((open) => !open)}
            />
            {current ? (
              <div className="breadcrumb">
                <span>{current.kind === "memo" ? "Memos" : "Notes"}</span>
                <span>/</span>
                <strong>{displayTitle(current.title)}</strong>
              </div>
            ) : null}
            {pill ? (
              <span className={`status-pill ${pill.tone}`} data-tip={pill.tip}>
                <span className="dot" />
                {pill.text}
              </span>
            ) : null}
          </div>
          {current ? (
            <div className="symbol-toolbar" role="toolbar" aria-label="Document actions">
              {preview ? (
                <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>
                  <Icon name="back" size={14} />
                  Back to current
                </button>
              ) : (
                <>
                  <SymButton
                    icon="reference"
                    label="Insert [[document]] reference"
                    onClick={() => editorRef.current?.insertReference()}
                  />
                  <div className="toolbar-sep" />
                  <div className="popover-anchor" ref={exportRef}>
                    <SymButton
                      icon="export"
                      label="Export (Markdown / PDF)"
                      pressed={exportOpen}
                      disabled={exporting}
                      onClick={() => setExportOpen((open) => !open)}
                    />
                    {exportOpen ? (
                      <div className="export-popover">
                        <label className="export-paper">
                          <span>PDF paper</span>
                          <select
                            value={paper}
                            onChange={(event) => setPaper(event.target.value as PaperSize)}
                          >
                            <option value="A4">A4</option>
                            <option value="Letter">Letter</option>
                            <option value="A5">A5</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn export-item"
                          onClick={() => void exportCurrent("markdown")}
                        >
                          <span>Export Markdown</span>
                          <span className="kbd">.md</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary export-item"
                          onClick={() => void exportCurrent("pdf")}
                        >
                          <span>Export rendered PDF</span>
                          <span className="kbd">{paper}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              <SymButton
                icon="history"
                label="Version timeline (Ctrl+S saves a version)"
                pressed={historyOpen}
                tipAlign={preview ? "right" : undefined}
                onClick={toggleHistory}
              />
              {preview ? null : (
                <>
                  <div className="toolbar-sep" />
                  <SymButton
                    icon="trash"
                    label={`Delete ${kindLabel}`}
                    danger
                    tipAlign="right"
                    onClick={() => void deleteNote()}
                  />
                </>
              )}
            </div>
          ) : null}
        </header>
        {error ? <p className="error-banner">{error}</p> : null}
        <section className="editor-pane">
          {current ? (
            <>
              <input
                className="doc-title"
                value={current.title}
                placeholder="Untitled"
                aria-label="Title"
                readOnly={preview !== null}
                onChange={(event) => setCurrent({ ...current, title: event.target.value })}
              />
              <MarkdownEditor
                ref={editorRef}
                value={preview ? preview.body : current.body}
                readOnly={preview !== null}
                resolveImage={resolveImage}
                onPasteImages={(files) => void pasteImages(files)}
                titles={notes
                  .filter((note) => note.id !== current.id)
                  .map((note) => displayTitle(note.title))}
                placeholder="Write, or type /"
                onChange={(body) => {
                  if (previewRef.current) return;
                  setCurrent({ ...current, body });
                }}
                onOpenTitle={(title) => {
                  const match = notes.find(
                    (note) => displayTitle(note.title) === title && note.id !== current.id,
                  );
                  if (!match) {
                    setError(`No note named "${title}"`);
                    return;
                  }
                  void openNote(match.id);
                }}
              />
              <TextBubble
                shown={preview === null}
                onEnlarge={() => editorRef.current?.enlargeSelection()}
              />
            </>
          ) : (
            <div className="editor-empty">
              <p>Select a note, or create one.</p>
              <button type="button" className="btn btn-primary" onClick={() => void createNote()}>
                <Icon name="plus" size={14} />
                New note
              </button>
            </div>
          )}
        </section>
      </main>
      {current && historyOpen ? (
        <aside className="history-drawer">
          <div className="drawer-header">
            <div className="drawer-title">
              <Icon name="history" size={14} />
              <span>Version timeline</span>
            </div>
            <span className="kbd">Ctrl+S</span>
          </div>
          <div className="timeline-rules">
            <strong>Auto-save and versions</strong>
            <span>
              Drafts save after a <strong>{SAVE_DELAY_MS}ms</strong> pause
            </span>
            <span>
              A version is added after <strong>{HISTORY_IDLE_MS / 60000}m idle</strong> or{" "}
              <strong>{HISTORY_TYPING_MS / 60000}m typing</strong>
            </span>
            <span>
              Full copy every <strong>{PATCHES_PER_CHECKPOINT} patches</strong>
            </span>
          </div>
          {versions.length === 0 ? (
            <p className="timeline-empty">No versions yet. Pause, or press Ctrl+S.</p>
          ) : (
            <ul className="timeline-list">
              {versions.map((version, index) => {
                const active = preview?.id === version.id;
                return (
                  <li key={version.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={active ? "version-card active" : "version-card"}
                      onClick={() => void showVersion(version.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void showVersion(version.id);
                        }
                      }}
                    >
                      <div className="version-top">
                        <span>
                          {timelineTime(version.createdAt)}
                          {index === 0 ? <span className="version-latest"> · Latest</span> : null}
                        </span>
                        <span
                          className={
                            version.checkpoint ? "version-badge checkpoint" : "version-badge"
                          }
                        >
                          {badges.get(version.id)}
                        </span>
                      </div>
                      {active ? (
                        <button
                          type="button"
                          className="btn btn-primary version-restore"
                          onClick={(event) => {
                            event.stopPropagation();
                            void restorePreview();
                          }}
                        >
                          Restore this version
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      ) : null}
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

export default App;
