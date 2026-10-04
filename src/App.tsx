import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { type Asset, imageMarkdown, imageResolver, savePastedImages } from "./assets";
import { MarkdownEditor, type MarkdownEditorHandle } from "./editor/MarkdownEditor";
import { snippets } from "./editor/snippets";
import { buildPdfHtml, type ExportImage, type PaperSize } from "./export/printDocument";
import { SettingsPanel } from "./settings/SettingsPanel";

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

const HISTORY_IDLE_MS = 2 * 60 * 1000;
const HISTORY_TYPING_MS = 5 * 60 * 1000;

function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

function exportFileName(title: string) {
  const cleaned = displayTitle(title).replace(/[<>:"/\\|?*]/g, "").trim();
  return cleaned.length > 0 ? cleaned : "Untitled";
}

function formatVersionTime(ms: number) {
  return new Date(ms).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function historyKind(body: string, timelineBody: string | null) {
  if (timelineBody === null) {
    return body.length === 0 ? "none" : "pending";
  }
  return timelineBody === body ? "in" : "pending";
}

function saveLabel(status: string, kind: "none" | "pending" | "in") {
  if (status === "Saving...") return "Saving...";
  if (status !== "Saved") return status;
  if (kind === "in") return "Saved · in history";
  if (kind === "pending") return "Saved · not in history";
  return "Saved";
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
    }, 500);
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
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commitHistory]);

  const openNoteRef = useRef<(id: string) => Promise<void>>(async () => {});

  useEffect(() => {
    const unlisten = listen<string>("open-document", (event) => {
      void openNoteRef.current(event.payload).catch((err: unknown) => setError(String(err)));
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Eyja</h1>
          <button type="button" onClick={() => void createNote()}>
            New
          </button>
        </div>
        {notes.length === 0 ? (
          <p className="empty">No notes yet.</p>
        ) : (
          <ul className="note-list">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={note.id === current?.id ? "active" : ""}
                  onClick={() => void openNote(note.id)}
                >
                  {displayTitle(note.title)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="sidebar-footer">
          <button
            type="button"
            title="Open a new memo window"
            onClick={() =>
              void invoke("open_memo", { id: null }).catch((err: unknown) => setError(String(err)))
            }
          >
            Memo
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </aside>
      <main className="editor">
        {error ? <p className="error">{error}</p> : null}
        {current ? (
          <>
            <div className="editor-bar">
              <span>
                {current.kind === "memo" ? "Memo · " : ""}
                {preview
                  ? `Previewing ${formatVersionTime(preview.createdAt)}`
                  : saveLabel(status, historyKind(current.body, timelineBody))}
              </span>
              <div className="editor-actions">
                {preview ? (
                  <>
                    <button type="button" onClick={() => void restorePreview()}>
                      Restore
                    </button>
                    <button type="button" onClick={() => setPreview(null)}>
                      Back
                    </button>
                  </>
                ) : (
                  snippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      onClick={() => editorRef.current?.insert(snippet.text, snippet.cursor)}
                    >
                      {snippet.label}
                    </button>
                  ))
                )}
                {preview ? null : (
                  <div className="export-wrap">
                    <button
                      type="button"
                      className={exportOpen ? "active" : ""}
                      disabled={exporting}
                      onClick={() => setExportOpen((open) => !open)}
                    >
                      Export
                    </button>
                    {exportOpen ? (
                      <div className="export-menu">
                        <label>
                          Paper
                          <select
                            value={paper}
                            onChange={(event) => setPaper(event.target.value as PaperSize)}
                          >
                            <option value="A4">A4</option>
                            <option value="Letter">Letter</option>
                            <option value="A5">A5</option>
                          </select>
                        </label>
                        <button type="button" onClick={() => void exportCurrent("markdown")}>
                          Markdown
                        </button>
                        <button type="button" onClick={() => void exportCurrent("pdf")}>
                          PDF
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
                <button
                  type="button"
                  className={historyOpen ? "active" : ""}
                  onClick={toggleHistory}
                >
                  History
                </button>
                {preview ? null : (
                  <button type="button" onClick={() => void deleteNote()}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            <input
              className="title"
              value={current.title}
              placeholder="Title"
              aria-label="Title"
              readOnly={preview !== null}
              onChange={(event) =>
                setCurrent({ ...current, title: event.target.value })
              }
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
              placeholder="Write..."
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
          </>
        ) : (
          <p className="empty editor-empty">Select a note, or create one.</p>
        )}
      </main>
      {current && historyOpen ? (
        <aside className="history">
          <div className="history-header">
            <h2>History</h2>
          </div>
          {versions.length === 0 ? (
            <p className="empty">No versions yet. Pause, or press Ctrl+S.</p>
          ) : (
            <ul className="history-list">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    className={preview?.id === version.id ? "active" : ""}
                    title={version.checkpoint ? "Full copy" : undefined}
                    onClick={() => void showVersion(version.id)}
                  >
                    {formatVersionTime(version.createdAt)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      ) : null}
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

export default App;
