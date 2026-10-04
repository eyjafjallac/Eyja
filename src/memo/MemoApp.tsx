import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Asset,
  imageMarkdown,
  imageResolver,
  isImage,
  savePastedImages,
  withoutAssetLinks,
} from "../assets";
import { MarkdownEditor, type MarkdownEditorHandle } from "../editor/MarkdownEditor";
import { Icon, type IconName } from "./Icon";
import "./memo.css";

type MemoColor = "yellow" | "green" | "blue" | "pink" | "purple" | "gray";

const COLORS: MemoColor[] = ["yellow", "green", "blue", "pink", "purple", "gray"];

type MemoSummary = {
  id: string;
  title: string;
  preview: string;
  color: MemoColor | null;
  updatedAt: number;
};

type Memo = {
  id: string;
  title: string;
  body: string;
  color: MemoColor | null;
  updatedAt: number;
  assets: Asset[];
};

type NoteSummary = {
  id: string;
  title: string;
};

export const MEMO_LABEL_PREFIX = "memo-";

const SAVE_DELAY_MS = 400;
// Matches the height of `.memo-bar`, so a collapsed window shows only the bar.
const BAR_HEIGHT = 40;

const memoId = getCurrentWindow().label.slice(MEMO_LABEL_PREFIX.length);
const pinnedKey = `eyja.memo.pinned.${memoId}`;

function firstLine(body: string) {
  const line = body.split("\n").find((text) => text.trim().length > 0)?.trim() ?? "";
  if (line.startsWith("![")) return "Image";
  return line.replace(/^[#>*\-\s]+/, "");
}

function memoLabel(title: string, preview: string) {
  return title.trim() || preview.trim() || "Empty memo";
}

function displayTitle(title: string) {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : "Untitled";
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function IconButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "memo-icon active" : "memo-icon"}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export function MemoApp() {
  const [memos, setMemos] = useState<MemoSummary[]>([]);
  const [current, setCurrent] = useState<Memo | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(() => localStorage.getItem(pinnedKey) === "1");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentRef = useRef<Memo | null>(null);
  const savedBodyRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const expandedRef = useRef<LogicalSize | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const show = useCallback((memo: Memo) => {
    currentRef.current = memo;
    savedBodyRef.current = memo.body;
    setCurrent(memo);
  }, []);

  const patch = useCallback((change: Partial<Memo>) => {
    const memo = currentRef.current;
    if (!memo) return;
    const next = { ...memo, ...change };
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const report = useCallback((err: unknown) => setError(String(err)), []);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const memo = currentRef.current;
    if (!memo || memo.body === savedBodyRef.current) return;
    const body = memo.body;
    await invoke("update_memo", { id: memo.id, body });
    savedBodyRef.current = body;
  }, []);

  /** Saves the memo and puts its text on the timeline. */
  const leave = useCallback(async () => {
    if (!currentRef.current) return;
    await flush();
    try {
      await invoke("record_version", { id: memoId });
    } catch {
      // The memo may already be gone, for example deleted from the editor.
    }
  }, [flush]);

  /** Loads the memo again unless there are unsaved edits, e.g. after it changed in the editor. */
  const reload = useCallback(async () => {
    const memo = currentRef.current;
    if (memo && (timerRef.current !== null || memo.body !== savedBodyRef.current)) return;
    let loaded: Memo;
    try {
      loaded = await invoke<Memo>("get_memo", { id: memoId });
    } catch {
      // Deleted or expired elsewhere: this window has nothing left to show.
      await getCurrentWindow().destroy();
      return;
    }
    show(loaded);
    setNotes(await invoke<NoteSummary[]>("list_documents"));
  }, [show]);

  const addAssets = useCallback(
    (added: Asset[]) => {
      const memo = currentRef.current;
      if (!memo || added.length === 0) return;
      patch({ assets: [...memo.assets, ...added] });
      const images = added.filter(isImage);
      if (images.length > 0) {
        editorRef.current?.insert(`${images.map(imageMarkdown).join("\n")}\n`);
      }
    },
    [patch],
  );

  const attachPaths = useCallback(
    async (paths: string[]) => {
      if (!currentRef.current || paths.length === 0) return;
      setBusy(true);
      setError("");
      try {
        addAssets(await invoke<Asset[]>("import_assets", { documentId: memoId, paths }));
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        setBusy(false);
      }
    },
    [addAssets],
  );

  useEffect(() => {
    const win = getCurrentWindow();
    void reload()
      .then(() => editorRef.current?.focus())
      .catch(report);
    if (localStorage.getItem(pinnedKey) === "1") {
      void win.setAlwaysOnTop(true).catch(report);
    }
    const unlisteners = [
      win.onFocusChanged(({ payload: focused }) => {
        void (focused ? reload() : flush()).catch(report);
      }),
      win.onCloseRequested(async () => {
        try {
          await leave();
        } catch {
          // Closing must not get stuck on a failed save.
        }
      }),
      getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
        } else if (payload.type === "leave") {
          setDragging(false);
        } else {
          setDragging(false);
          void attachPaths(payload.paths);
        }
      }),
    ];
    return () => {
      for (const unlisten of unlisteners) void unlisten.then((stop) => stop());
    };
  }, [attachPaths, flush, leave, reload, report]);

  const resolveImage = useMemo(() => imageResolver(current?.assets ?? []), [current?.assets]);

  function changeBody(body: string) {
    patch({ body });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush().catch(report);
    }, SAVE_DELAY_MS);
  }

  async function toggleList() {
    setPaletteOpen(false);
    if (listOpen) {
      setListOpen(false);
      return;
    }
    if (collapsed) await toggleCollapsed();
    await flush();
    setMemos(await invoke<MemoSummary[]>("list_memos"));
    setListOpen(true);
  }

  async function openOther(id: string) {
    setListOpen(false);
    if (id !== memoId) await invoke("open_memo", { id });
  }

  async function deleteMemo() {
    const memo = currentRef.current;
    if (!memo) return;
    const files = memo.assets.length > 0 ? " Its copied files and folders are removed from disk." : "";
    if (!(await confirm(`Delete this memo?${files}`, { kind: "warning", okLabel: "Delete" }))) {
      return;
    }
    await leave();
    await invoke("delete_document", { id: memoId });
    await getCurrentWindow().destroy();
  }

  async function setColor(color: MemoColor | null) {
    setPaletteOpen(false);
    await invoke("set_memo_color", { id: memoId, color });
    patch({ color });
  }

  async function togglePinned() {
    const next = !pinned;
    await getCurrentWindow().setAlwaysOnTop(next);
    localStorage.setItem(pinnedKey, next ? "1" : "0");
    setPinned(next);
  }

  async function toggleCollapsed() {
    const win = getCurrentWindow();
    setPaletteOpen(false);
    if (!collapsed) {
      const size = (await win.innerSize()).toLogical(await win.scaleFactor());
      expandedRef.current = size;
      setCollapsed(true);
      await win.setSize(new LogicalSize(size.width, BAR_HEIGHT));
    } else {
      const size =
        expandedRef.current ?? (await win.innerSize()).toLogical(await win.scaleFactor());
      setCollapsed(false);
      await win.setSize(new LogicalSize(size.width, Math.max(size.height, BAR_HEIGHT * 4)));
      editorRef.current?.focus();
    }
  }

  async function openInEditor() {
    await leave();
    await invoke("open_in_editor", { id: memoId });
    await getCurrentWindow().destroy();
  }

  async function pick(directory: boolean) {
    const picked = await open({ multiple: true, directory });
    if (!picked) return;
    await attachPaths(Array.isArray(picked) ? picked : [picked]);
  }

  async function removeAsset(asset: Asset) {
    const question = `Remove ${asset.name}? The copy inside Eyja is deleted.`;
    if (!(await confirm(question, { kind: "warning", okLabel: "Remove" }))) return;
    await invoke("remove_asset", { id: asset.id });
    const latest = currentRef.current;
    if (!latest) return;
    patch({ assets: latest.assets.filter((item) => item.id !== asset.id) });
    const body = withoutAssetLinks(latest.body, asset.id);
    if (body !== latest.body) changeBody(body);
  }

  async function pasteImages(files: File[]) {
    setBusy(true);
    try {
      addAssets(await savePastedImages(memoId, files));
    } finally {
      setBusy(false);
    }
  }

  function openTitle(title: string) {
    const note = notes.find((item) => displayTitle(item.title) === title);
    if (!note) {
      setError(`No note named "${title}"`);
      return;
    }
    void flush()
      .then(() => invoke("open_in_editor", { id: note.id }))
      .catch(report);
  }

  function run(action: () => Promise<unknown>) {
    setError("");
    void action().catch(report);
  }

  const heading = current ? memoLabel(current.title, firstLine(current.body)) : "Memo";
  // A blank memo is discarded when its window closes, so there is nothing to open.
  const blank = !current || (current.body.trim() === "" && current.assets.length === 0);

  return (
    <div className={`memo memo-${current?.color ?? "default"}`}>
      <header className="memo-bar" data-tauri-drag-region>
        <IconButton icon="list" label="All memos" active={listOpen} onClick={() => run(toggleList)} />
        <span className="memo-heading" data-tauri-drag-region>
          {heading}
        </span>
        <IconButton
          icon="plus"
          label="New memo window"
          onClick={() => run(() => invoke("open_memo", { id: null }))}
        />
        <div className="memo-palette-wrap">
          <IconButton
            icon="color"
            label="Color"
            active={paletteOpen}
            disabled={!current}
            onClick={() => setPaletteOpen((value) => !value)}
          />
          {paletteOpen ? (
            <div className="memo-palette">
              {[null, ...COLORS].map((color) => (
                <button
                  key={color ?? "default"}
                  type="button"
                  className={`memo-swatch memo-${color ?? "default"}${
                    (current?.color ?? null) === color ? " active" : ""
                  }`}
                  title={color ?? "Default"}
                  aria-label={color ?? "Default"}
                  onClick={() => run(() => setColor(color))}
                />
              ))}
            </div>
          ) : null}
        </div>
        <IconButton
          icon="pin"
          label={pinned ? "Stop keeping on top" : "Keep on top"}
          active={pinned}
          onClick={() => run(togglePinned)}
        />
        <IconButton
          icon={collapsed ? "expand" : "collapse"}
          label={collapsed ? "Expand" : "Collapse"}
          onClick={() => run(toggleCollapsed)}
        />
        <IconButton icon="close" label="Close" onClick={() => run(() => getCurrentWindow().close())} />
      </header>
      {collapsed ? null : listOpen ? (
        <ul className="memo-list">
          {memos.map((memo) => (
            <li key={memo.id}>
              <button
                type="button"
                className={`memo-${memo.color ?? "default"}${memo.id === memoId ? " active" : ""}`}
                onClick={() => run(() => openOther(memo.id))}
              >
                <span className="memo-list-label">{memoLabel(memo.title, memo.preview)}</span>
                <span className="memo-list-time">{formatTime(memo.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {error ? <p className="memo-error">{error}</p> : null}
          <div className="memo-body">
            {current ? (
              <MarkdownEditor
                ref={editorRef}
                value={current.body}
                titles={notes.map((note) => displayTitle(note.title))}
                placeholder="Jot something down. Drop files or paste images here."
                resolveImage={resolveImage}
                onChange={changeBody}
                onOpenTitle={openTitle}
                onPasteImages={(files) => run(() => pasteImages(files))}
              />
            ) : null}
          </div>
          {current && current.assets.length > 0 ? (
            <ul className="memo-files">
              {current.assets.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    className="memo-file"
                    title={asset.path}
                    onClick={() => run(() => invoke("open_asset", { id: asset.id }))}
                  >
                    <Icon name={asset.isDir ? "folder" : "file"} />
                    <span>{asset.name}</span>
                  </button>
                  <button
                    type="button"
                    className="memo-file-remove"
                    title={`Remove ${asset.name}`}
                    aria-label={`Remove ${asset.name}`}
                    onClick={() => run(() => removeAsset(asset))}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <footer className="memo-foot">
            <IconButton
              icon="file"
              label="Attach files"
              disabled={!current || busy}
              onClick={() => run(() => pick(false))}
            />
            <IconButton
              icon="folder"
              label="Attach a folder"
              disabled={!current || busy}
              onClick={() => run(() => pick(true))}
            />
            <span className="memo-status">{busy ? "Copying..." : ""}</span>
            <IconButton
              icon="open"
              label="Open in editor"
              disabled={blank}
              onClick={() => run(openInEditor)}
            />
            <IconButton
              icon="trash"
              label="Delete memo"
              disabled={!current}
              onClick={() => run(deleteMemo)}
            />
          </footer>
        </>
      )}
      {dragging && !collapsed ? <div className="memo-drop">Drop to copy into this memo</div> : null}
    </div>
  );
}
