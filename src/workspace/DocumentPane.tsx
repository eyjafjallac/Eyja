import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_IDLE_MINUTES,
  DEFAULT_MAX_TAGS,
  DEFAULT_TYPING_MINUTES,
  type DocumentSummary,
  displayTitle,
  type Folder,
  folderPath,
  folderTree,
  type Note,
  type Settings,
  tzOffsetMinutes,
} from "../api";
import { type Asset, imageMarkdown, imageResolver, isImage, savePastedImages } from "../assets";
import { MarkdownEditor, type MarkdownEditorHandle } from "../editor/MarkdownEditor";
import { TextBubble } from "../editor/TextBubble";
import { buildPdfHtml, type ExportImage, type PaperSize } from "../export/printDocument";
import { Icon, SymButton } from "../memo/Icon";
import { TagEditor } from "../tags/TagEditor";
import { timelineTime } from "../time";
import { ReferencePicker } from "./ReferencePicker";

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

type Menu = "export" | "folder" | "cover";

export type PaneSlots = {
  left: HTMLElement | null;
  right: HTMLElement | null;
  drawer: HTMLElement | null;
};

const SAVE_DELAY_MS = 500;
// Mirrors `CHECKPOINT_EVERY` in src-tauri/src/versions.rs.
const PATCHES_PER_CHECKPOINT = 20;

/** Saves still in flight when a pane closed, so reopening the document waits for them. */
const pendingSaves = new Map<string, Promise<unknown>>();

function trackSave(id: string, promise: Promise<unknown>) {
  pendingSaves.set(id, promise);
  void promise.finally(() => {
    if (pendingSaves.get(id) === promise) pendingSaves.delete(id);
  });
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
  idleMinutes: number,
  typingMinutes: number,
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
      tip: `Added to the timeline after ${idleMinutes} minutes idle, ${typingMinutes} minutes of typing, or Ctrl+S`,
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

/** One open document: its draft, autosave, timeline and document actions. */
export function DocumentPane({
  id,
  active,
  docs,
  folders,
  tagNames,
  settings,
  historyOpen,
  slots,
  onToggleHistory,
  onSaved,
  onMetaChanged,
  onDeleted,
  onOpenDocument,
}: {
  id: string;
  active: boolean;
  docs: DocumentSummary[];
  folders: Folder[];
  tagNames: string[];
  settings: Settings | null;
  historyOpen: boolean;
  slots: PaneSlots;
  onToggleHistory: () => void;
  onSaved: () => void;
  onMetaChanged: () => void;
  onDeleted: (id: string) => void;
  onOpenDocument: (id: string) => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [timelineBody, setTimelineBody] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [preview, setPreview] = useState<VersionPreview | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [paper, setPaper] = useState<PaperSize>("A4");
  const [exporting, setExporting] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<Note | null>(null);
  const lastSavedRef = useRef<Draft | null>(null);
  const timerRef = useRef<number | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const timelineBodyRef = useRef<string | null>(null);
  const previewRef = useRef<VersionPreview | null>(null);
  const idleHistoryRef = useRef<number | null>(null);
  const typingHistoryRef = useRef<number | null>(null);
  const deletedRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  timelineBodyRef.current = timelineBody;
  previewRef.current = preview;

  const idleMinutes = settings?.historyIdleMinutes ?? DEFAULT_IDLE_MINUTES;
  const typingMinutes = settings?.historyTypingMinutes ?? DEFAULT_TYPING_MINUTES;
  const maxTags = settings?.maxTags ?? DEFAULT_MAX_TAGS;

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  const persist = useCallback(async (draft: Draft) => {
    const saved = lastSavedRef.current;
    if (saved && saved.title === draft.title && saved.body === draft.body) return;
    setStatus("Saving...");
    await invoke("update_document", { id: draft.id, title: draft.title, body: draft.body });
    lastSavedRef.current = draft;
    setStatus("Saved");
    onSavedRef.current();
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
    const draft = noteRef.current;
    if (!draft) return;
    await persist({ id: draft.id, title: draft.title, body: draft.body });
  }, [persist]);

  const commitHistory = useCallback(async () => {
    clearHistoryTimers();
    if (previewRef.current || deletedRef.current) return;
    await flush();
    if (previewRef.current || deletedRef.current) return;
    const state = await invoke<HistoryState>("record_version", {
      id,
      tzOffsetMinutes: tzOffsetMinutes(),
    });
    applyHistory(state);
  }, [applyHistory, clearHistoryTimers, flush, id]);

  // Load once per pane; the pane is keyed by document id.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await pendingSaves.get(id)?.catch(() => undefined);
      const [loaded, loadedAssets] = await Promise.all([
        invoke<Note>("get_document", { id }),
        invoke<Asset[]>("list_assets", { documentId: id }),
      ]);
      if (cancelled) return;
      noteRef.current = loaded;
      lastSavedRef.current = { id, title: loaded.title, body: loaded.body };
      setAssets(loadedAssets);
      setNote(loaded);
      setStatus("Saved");
      const state = await invoke<HistoryState>("history_state", { id });
      if (!cancelled) applyHistory(state);
    })().catch((err: unknown) => {
      if (!cancelled) setError(String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [applyHistory, id]);

  // Closing the tab writes the last keystrokes instead of dropping them.
  useEffect(
    () => () => {
      clearHistoryTimers();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const draft = noteRef.current;
      const saved = lastSavedRef.current;
      if (!draft || deletedRef.current) return;
      if (saved && saved.title === draft.title && saved.body === draft.body) return;
      trackSave(
        id,
        invoke("update_document", { id, title: draft.title, body: draft.body })
          .then(() => onSavedRef.current())
          .catch(() => undefined),
      );
    },
    [clearHistoryTimers, id],
  );

  useEffect(() => {
    if (!note) return;
    const saved = lastSavedRef.current;
    if (saved && saved.title === note.title && saved.body === note.body) return;
    const draft = { id: note.id, title: note.title, body: note.body };
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
  }, [note, persist]);

  useEffect(() => {
    if (!note || preview) {
      clearHistoryTimers();
      return;
    }
    if (historyKind(note.body, timelineBody) !== "pending") {
      clearHistoryTimers();
      return;
    }
    const fail = (err: unknown) => {
      setError(String(err));
      setHistoryNonce((value) => value + 1);
    };
    if (idleHistoryRef.current !== null) window.clearTimeout(idleHistoryRef.current);
    idleHistoryRef.current = window.setTimeout(() => {
      idleHistoryRef.current = null;
      void commitHistory().catch(fail);
    }, idleMinutes * 60_000);
    // The typing timer stays across keystrokes. Only the idle timer resets.
    if (typingHistoryRef.current === null) {
      typingHistoryRef.current = window.setTimeout(() => {
        typingHistoryRef.current = null;
        void commitHistory().catch(fail);
      }, typingMinutes * 60_000);
    }
    return () => {
      if (idleHistoryRef.current !== null) {
        window.clearTimeout(idleHistoryRef.current);
        idleHistoryRef.current = null;
      }
    };
  }, [
    clearHistoryTimers,
    commitHistory,
    historyNonce,
    idleMinutes,
    note,
    preview,
    timelineBody,
    typingMinutes,
  ]);

  // New interval settings take effect on the next typing stretch.
  useEffect(() => {
    if (typingHistoryRef.current !== null) {
      window.clearTimeout(typingHistoryRef.current);
      typingHistoryRef.current = null;
      setHistoryNonce((value) => value + 1);
    }
  }, [typingMinutes]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (previewRef.current) return;
        void commitHistory().catch((err: unknown) => setError(String(err)));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, commitHistory]);

  // A preview belongs to the drawer; it ends when the drawer closes or the pane loses focus.
  useEffect(() => {
    if (!active || !historyOpen) setPreview(null);
  }, [active, historyOpen]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menu]);

  const resolveImage = useMemo(() => imageResolver(assets), [assets]);
  const images = useMemo(() => assets.filter(isImage), [assets]);
  const cover = images.find((asset) => asset.id === note?.coverAssetId) ?? null;
  const titles = useMemo(
    () =>
      docs
        .filter((doc) => doc.id !== id && doc.title.trim().length > 0)
        .map((doc) => doc.title.trim()),
    [docs, id],
  );

  async function pasteImages(files: File[]) {
    if (!noteRef.current || previewRef.current) return;
    setError("");
    try {
      const saved = await savePastedImages(id, files);
      setAssets((list) => [...list, ...saved]);
      editorRef.current?.insert(`${saved.map(imageMarkdown).join("\n")}\n`);
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  function updateNote(change: Partial<Note>) {
    setNote((current) => (current ? { ...current, ...change } : current));
  }

  const setTags = (tags: string[]) =>
    run(async () => {
      const stored = await invoke<string[]>("set_document_tags", { id, tags });
      updateNote({ tags: stored });
      onMetaChanged();
    });

  const togglePinned = () =>
    run(async () => {
      if (!note) return;
      await invoke("set_document_pinned", { id, pinned: !note.pinned });
      updateNote({ pinned: !note.pinned });
      onMetaChanged();
    });

  const toggleFavorite = () =>
    run(async () => {
      if (!note) return;
      await invoke("set_document_favorite", { id, favorite: !note.favorite });
      updateNote({ favorite: !note.favorite });
      onMetaChanged();
    });

  const moveToFolder = (folderId: string | null) =>
    run(async () => {
      setMenu(null);
      await invoke("set_document_folder", { id, folderId });
      updateNote({ folderId });
      onMetaChanged();
    });

  const setCover = (assetId: string | null) =>
    run(async () => {
      setMenu(null);
      await invoke("set_document_cover", { id, assetId });
      updateNote({ coverAssetId: assetId });
      onMetaChanged();
    });

  async function deleteNote() {
    if (!note) return;
    const question =
      note.kind === "memo"
        ? "Delete this memo? Its copied files and folders are removed from disk."
        : "Delete this note?";
    if (!(await confirm(question, { kind: "warning", okLabel: "Delete" }))) return;
    await run(async () => {
      clearHistoryTimers();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      await invoke("delete_document", { id });
      deletedRef.current = true;
      onDeleted(id);
    });
  }

  async function showVersion(versionId: string) {
    await run(async () => {
      setPreview(await invoke<VersionPreview>("get_version", { id, version: versionId }));
    });
  }

  async function restorePreview() {
    if (!preview) return;
    if (
      !(await confirm("Restore this version? The current text is kept in history first.", {
        okLabel: "Restore",
      }))
    ) {
      return;
    }
    await run(async () => {
      clearHistoryTimers();
      await flush();
      const restored = await invoke<Note>("restore_version", { id, version: preview.id });
      noteRef.current = restored;
      lastSavedRef.current = { id, title: restored.title, body: restored.body };
      setPreview(null);
      setNote(restored);
      setStatus("Saved");
      applyHistory(await invoke<HistoryState>("history_state", { id }));
      onSavedRef.current();
    });
  }

  async function exportCurrent(kind: "markdown" | "pdf") {
    const current = noteRef.current;
    if (!current || previewRef.current || exporting) return;
    setMenu(null);
    const extension = kind === "markdown" ? "md" : "pdf";
    const path = await save({
      defaultPath: `${exportFileName(current.title)}.${extension}`,
      filters: [{ name: kind === "markdown" ? "Markdown" : "PDF", extensions: [extension] }],
    });
    if (!path || previewRef.current) return;
    setExporting(true);
    await run(async () => {
      await flush();
      if (previewRef.current) return;
      setStatus("Exporting...");
      if (kind === "markdown") {
        await invoke("export_markdown", { id, path });
      } else {
        const source = await invoke<{ title: string; body: string; images: ExportImage[] }>(
          "export_source",
          { id },
        );
        const html = await buildPdfHtml(source.title, source.body, source.images, paper);
        await invoke("export_pdf", { path, html });
      }
      setStatus("Exported");
    });
    setExporting(false);
  }

  function openTitle(title: string) {
    const match =
      docs.find((doc) => doc.id !== id && doc.title.trim() === title) ??
      docs.find((doc) => doc.id !== id && doc.title.trim().toLowerCase() === title.toLowerCase());
    if (!match) {
      setError(`No document named "${title}"`);
      return;
    }
    onOpenDocument(match.id);
  }

  const pill = note
    ? statusPill(status, historyKind(note.body, timelineBody), preview, idleMinutes, typingMinutes)
    : null;
  const badges = versionBadges(versions);
  const kindLabel = note?.kind === "memo" ? "memo" : "note";
  const path = note ? folderPath(folders, note.folderId) : [];

  const left: ReactNode = note ? (
    <>
      <div className="breadcrumb">
        <div className="popover-anchor" ref={menu === "folder" ? menuRef : undefined}>
          <button
            type="button"
            className="crumb-btn"
            data-tip={path.length > 1 ? `${path.join(" / ")} · Move to a folder` : "Move to a folder"}
            onClick={() => setMenu((open) => (open === "folder" ? null : "folder"))}
          >
            <Icon name="folder" size={13} />
            <span>{path.length > 0 ? path[path.length - 1] : note.kind === "memo" ? "Memos" : "Notes"}</span>
          </button>
          {menu === "folder" ? (
            <div className="export-popover popover-left folder-popover">
              <button
                type="button"
                className={note.folderId === null ? "menu-item active" : "menu-item"}
                onClick={() => void moveToFolder(null)}
              >
                <Icon name="file" size={13} />
                <span>No folder</span>
              </button>
              {folderTree(folders).map(({ folder, depth }) => (
                <button
                  key={folder.id}
                  type="button"
                  className={note.folderId === folder.id ? "menu-item active" : "menu-item"}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => void moveToFolder(folder.id)}
                >
                  <Icon name="folder" size={13} />
                  <span>{folder.name}</span>
                </button>
              ))}
              {folders.length === 0 ? (
                <p className="menu-hint">Create folders in the library.</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <span>/</span>
        <strong>{displayTitle(note.title)}</strong>
      </div>
      {pill ? (
        <span className={`status-pill ${pill.tone}`} data-tip={pill.tip}>
          <span className="dot" />
          {pill.text}
        </span>
      ) : null}
    </>
  ) : null;

  const right: ReactNode = note ? (
    <>
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
            onClick={() => setPickerOpen(true)}
          />
          <SymButton
            icon="pin"
            label={note.pinned ? "Unpin from the library top" : "Pin to the library top"}
            pressed={note.pinned}
            onClick={() => void togglePinned()}
          />
          <SymButton
            icon="star"
            label={note.favorite ? "Remove from favorites" : "Add to favorites"}
            pressed={note.favorite}
            className={note.favorite ? "star-on" : undefined}
            onClick={() => void toggleFavorite()}
          />
          <div className="popover-anchor" ref={menu === "cover" ? menuRef : undefined}>
            <SymButton
              icon="image"
              label="Cover image"
              pressed={menu === "cover"}
              onClick={() => setMenu((open) => (open === "cover" ? null : "cover"))}
            />
            {menu === "cover" ? (
              <div className="export-popover cover-popover">
                <span className="menu-title">Cover from this {kindLabel}</span>
                {images.length === 0 ? (
                  <p className="menu-hint">Paste an image into the {kindLabel} first.</p>
                ) : (
                  <div className="cover-grid">
                    {images.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className={asset.id === note.coverAssetId ? "cover-option active" : "cover-option"}
                        aria-label={`Use ${asset.name} as cover`}
                        onClick={() => void setCover(asset.id)}
                      >
                        <img src={convertFileSrc(asset.path)} alt="" />
                      </button>
                    ))}
                  </div>
                )}
                {note.coverAssetId ? (
                  <button type="button" className="btn" onClick={() => void setCover(null)}>
                    Remove cover
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="toolbar-sep" />
          <div className="popover-anchor" ref={menu === "export" ? menuRef : undefined}>
            <SymButton
              icon="export"
              label="Export (Markdown / PDF)"
              pressed={menu === "export"}
              disabled={exporting}
              onClick={() => setMenu((open) => (open === "export" ? null : "export"))}
            />
            {menu === "export" ? (
              <div className="export-popover">
                <label className="export-paper">
                  <span>PDF paper</span>
                  <select value={paper} onChange={(event) => setPaper(event.target.value as PaperSize)}>
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                    <option value="A5">A5</option>
                  </select>
                </label>
                <button type="button" className="btn export-item" onClick={() => void exportCurrent("markdown")}>
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
        onClick={onToggleHistory}
      />
      {preview ? null : (
        <SymButton
          icon="trash"
          label={`Delete ${kindLabel}`}
          danger
          onClick={() => void deleteNote()}
        />
      )}
    </>
  ) : null;

  const drawer: ReactNode = note ? (
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
          A version is added after <strong>{idleMinutes}m idle</strong> or{" "}
          <strong>{typingMinutes}m typing</strong>
        </span>
        <span>
          Full copy every <strong>{PATCHES_PER_CHECKPOINT} patches</strong>
        </span>
        {settings?.historyRetention === "daily" ? (
          <span>
            Earlier days keep only their <strong>last version</strong>
          </span>
        ) : null}
      </div>
      {versions.length === 0 ? (
        <p className="timeline-empty">No versions yet. Pause, or press Ctrl+S.</p>
      ) : (
        <ul className="timeline-list">
          {versions.map((version, index) => {
            const selected = preview?.id === version.id;
            return (
              <li key={version.id}>
                <div
                  role="button"
                  tabIndex={0}
                  className={selected ? "version-card active" : "version-card"}
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
                    <span className={version.checkpoint ? "version-badge checkpoint" : "version-badge"}>
                      {badges.get(version.id)}
                    </span>
                  </div>
                  {selected ? (
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
  ) : null;

  return (
    <section className="editor-pane">
      {error ? <p className="error-banner">{error}</p> : null}
      {note ? (
        <>
          {cover ? (
            <div className="doc-cover">
              <img src={convertFileSrc(cover.path)} alt="" />
            </div>
          ) : null}
          <div className="doc-meta-row">
            <TagEditor
              tags={note.tags}
              max={maxTags}
              suggestions={tagNames}
              disabled={preview !== null}
              onChange={(tags) => void setTags(tags)}
            />
          </div>
          <input
            className="doc-title"
            value={note.title}
            placeholder="Untitled"
            aria-label="Title"
            readOnly={preview !== null}
            onChange={(event) => {
              const title = event.target.value;
              updateNote({ title });
            }}
          />
          <MarkdownEditor
            ref={editorRef}
            value={preview ? preview.body : note.body}
            readOnly={preview !== null}
            resolveImage={resolveImage}
            onPasteImages={(files) => void pasteImages(files)}
            titles={titles}
            placeholder="Write, or type /"
            onChange={(body) => {
              if (previewRef.current) return;
              updateNote({ body });
            }}
            onOpenTitle={openTitle}
          />
          <TextBubble
            shown={active && preview === null}
            onEnlarge={() => editorRef.current?.enlargeSelection()}
            onColor={(color, refocus) => editorRef.current?.colorSelection(color, refocus)}
          />
        </>
      ) : error ? null : (
        <div className="editor-empty">
          <p>Opening…</p>
        </div>
      )}
      {active && slots.left && left ? createPortal(left, slots.left) : null}
      {active && slots.right && right ? createPortal(right, slots.right) : null}
      {active && historyOpen && slots.drawer && drawer ? createPortal(drawer, slots.drawer) : null}
      {pickerOpen && note ? (
        <ReferencePicker
          docs={docs}
          folders={folders}
          excludeId={id}
          onClose={() => {
            setPickerOpen(false);
            editorRef.current?.focus();
          }}
          onPick={(title) => {
            setPickerOpen(false);
            editorRef.current?.insert(`[[${title}]]`);
            editorRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
