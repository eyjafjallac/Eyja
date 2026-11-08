import { invoke } from "@tauri-apps/api/core";
import {
  type DragEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DocumentSummary, Folder, Note, Settings } from "../api";
import { Icon, SymButton } from "../memo/Icon";
import { shortAge } from "../time";
import { DocumentPane, type PaneSlots } from "./DocumentPane";

type Group = { tabs: string[]; active: string | null };
type Side = 0 | 1;

export type WorkspaceHandle = {
  /** Opens a document in the focused group, or shows it where it is already open. */
  open: (id: string) => void;
  hasTabs: () => boolean;
};

const MAX_TABS = 3;
const DRAG_TYPE = "application/x-eyja-tab";
const EMPTY: Group = { tabs: [], active: null };

type DragPayload = { id: string; from: Side | -1 };

function withActive(group: Group): Group {
  if (group.active && group.tabs.includes(group.active)) return group;
  return { ...group, active: group.tabs[0] ?? null };
}

/** The left group is never empty while the right one has tabs. */
function normalize(groups: [Group, Group]): [Group, Group] {
  const [left, right] = groups;
  if (left.tabs.length === 0 && right.tabs.length > 0) return [withActive(right), EMPTY];
  return [withActive(left), withActive(right)];
}

function without(group: Group, id: string): Group {
  const index = group.tabs.indexOf(id);
  if (index < 0) return group;
  const tabs = group.tabs.filter((tab) => tab !== id);
  const active = group.active === id ? (tabs[index] ?? tabs[index - 1] ?? null) : group.active;
  return { tabs, active };
}

function sideOf(groups: [Group, Group], id: string): Side | null {
  if (groups[0].tabs.includes(id)) return 0;
  if (groups[1].tabs.includes(id)) return 1;
  return null;
}

function readDrag(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

function hasDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(DRAG_TYPE);
}

function tabLabel(doc: DocumentSummary | undefined) {
  if (!doc) return "Untitled";
  if (doc.title.trim()) return doc.title.trim();
  if (doc.kind === "memo") return doc.preview || "Memo";
  return "Untitled";
}

export const Workspace = forwardRef<
  WorkspaceHandle,
  {
    visible: boolean;
    docs: DocumentSummary[];
    folders: Folder[];
    tagNames: string[];
    settings: Settings | null;
    onHome: () => void;
    onOpenSettings: () => void;
    onSaved: () => void;
    onMetaChanged: () => void;
  }
>(function Workspace(
  { visible, docs, folders, tagNames, settings, onHome, onOpenSettings, onSaved, onMetaChanged },
  ref,
) {
  const [groups, setGroupsState] = useState<[Group, Group]>([EMPTY, EMPTY]);
  const [focus, setFocus] = useState<Side>(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [left, setLeft] = useState<HTMLElement | null>(null);
  const [right, setRight] = useState<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState<HTMLElement | null>(null);
  const groupsRef = useRef(groups);
  const focusRef = useRef(focus);
  groupsRef.current = groups;
  focusRef.current = focus;

  const byId = useMemo(() => new Map(docs.map((doc) => [doc.id, doc])), [docs]);
  const recent = useMemo(() => [...docs].sort((a, b) => b.updatedAt - a.updatedAt), [docs]);
  const split = groups[1].tabs.length > 0;
  const slots: PaneSlots = { left, right, drawer };

  const setGroups = useCallback((next: [Group, Group], nextFocus?: Side) => {
    const normalized = normalize(next);
    groupsRef.current = normalized;
    setGroupsState(normalized);
    let side = nextFocus ?? focusRef.current;
    if (normalized[side].tabs.length === 0) side = 0;
    focusRef.current = side;
    setFocus(side);
  }, []);

  const open = useCallback(
    (id: string, target?: Side) => {
      const current = groupsRef.current;
      const where = sideOf(current, id);
      if (where !== null && (target === undefined || target === where)) {
        const next: [Group, Group] = [...current];
        next[where] = { ...next[where], active: id };
        setGroups(next, where);
        return;
      }
      let side = target ?? focusRef.current;
      if (side === 1 && current[0].tabs.length === 0) side = 0;
      const next: [Group, Group] = [without(current[0], id), without(current[1], id)];
      const group = next[side];
      if (group.tabs.length < MAX_TABS) {
        next[side] = { tabs: [...group.tabs, id], active: id };
      } else {
        // A full group swaps its visible tab for the new document.
        const index = Math.max(0, group.tabs.indexOf(group.active ?? ""));
        const tabs = [...group.tabs];
        tabs[index] = id;
        next[side] = { tabs, active: id };
      }
      setGroups(next, side);
    },
    [setGroups],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: (id) => open(id),
      hasTabs: () => groupsRef.current[0].tabs.length > 0,
    }),
    [open],
  );

  const close = useCallback(
    (id: string) => {
      const current = groupsRef.current;
      setGroups([without(current[0], id), without(current[1], id)]);
    },
    [setGroups],
  );

  function activate(side: Side, id: string) {
    const next: [Group, Group] = [...groupsRef.current];
    next[side] = { ...next[side], active: id };
    setGroups(next, side);
  }

  /** Moves a tab to `side` before `index`; across groups only while that side has room. */
  function move(payload: DragPayload, side: Side, index?: number) {
    const current = groupsRef.current;
    const from = sideOf(current, payload.id);
    if (from !== side && current[side].tabs.length >= MAX_TABS) {
      setNotice(`Each side holds ${MAX_TABS} tabs. Close one there first.`);
      return;
    }
    const next: [Group, Group] = [without(current[0], payload.id), without(current[1], payload.id)];
    const tabs = [...next[side].tabs];
    const at = index === undefined ? tabs.length : Math.min(index, tabs.length);
    tabs.splice(at, 0, payload.id);
    next[side] = { tabs, active: payload.id };
    setGroups(next, side);
  }

  async function createNote(side?: Side) {
    setNotice("");
    try {
      const note = await invoke<Note>("create_document", { folderId: null });
      onSaved();
      open(note.id, side);
    } catch (err: unknown) {
      setNotice(String(err));
    }
  }

  function toggleSplit() {
    const current = groupsRef.current;
    if (split) {
      setGroups([current[0], EMPTY], 0);
      return;
    }
    const other = recent.find((doc) => !current[0].tabs.includes(doc.id));
    if (other) open(other.id, 1);
    else void createNote(1);
  }

  useEffect(() => {
    if (!visible) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function dragStart(event: DragEvent, payload: DragPayload) {
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  function dragEnd() {
    setDragging(false);
    setDropTarget(null);
  }

  function dropProps(side: Side, key: string, index?: number) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!hasDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((target) => (target === key ? null : target)),
      onDrop: (event: DragEvent) => {
        const payload = readDrag(event);
        event.preventDefault();
        event.stopPropagation();
        dragEnd();
        if (payload) move(payload, side, index);
      },
    };
  }

  const empty = groups[0].tabs.length === 0;

  return (
    <div className="shell" hidden={!visible}>
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
                  void invoke("open_memo", { id: null }).catch((err: unknown) => setNotice(String(err)))
                }
              />
            </div>
          </div>
          <div className="sidebar-nav">
            <button type="button" className="nav-item" onClick={onHome}>
              <span className="nav-item-icon">
                <Icon name="home" size={14} />
              </span>
              <span className="nav-item-title">Library</span>
            </button>
          </div>
          <div className="nav-label">
            <span>Recent</span>
            <span>{recent.length}</span>
          </div>
          {recent.length === 0 ? (
            <p className="sidebar-empty">No documents yet.</p>
          ) : (
            <ul className="recent-list">
              {recent.map((doc) => {
                const shown = groups.some((group) => group.active === doc.id);
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className={shown ? "nav-item active" : "nav-item"}
                      draggable
                      onDragStart={(event) => dragStart(event, { id: doc.id, from: -1 })}
                      onDragEnd={dragEnd}
                      onClick={() => open(doc.id)}
                    >
                      <span className="nav-item-icon">
                        {shown ? (
                          <span className="nav-dot" />
                        ) : (
                          <Icon name={doc.kind === "memo" ? "memo" : "file"} size={14} />
                        )}
                      </span>
                      <span className="nav-item-title">{tabLabel(doc)}</span>
                      <span className="nav-time">{shortAge(doc.updatedAt)}</span>
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
              onClick={onOpenSettings}
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
              onClick={() => setSidebarOpen((value) => !value)}
            />
            <div className="topbar-slot" ref={setLeft} />
          </div>
          <div className="symbol-toolbar" role="toolbar" aria-label="Document actions">
            <div className="topbar-slot" ref={setRight} />
            {empty ? null : <div className="toolbar-sep" />}
            <SymButton
              icon="split"
              label={split ? "Close the right side" : "Split: open another document on the right"}
              pressed={split}
              disabled={empty}
              tipAlign="right"
              onClick={toggleSplit}
            />
          </div>
        </header>
        {notice ? <p className="error-banner">{notice}</p> : null}
        {empty ? (
          <div className="editor-empty">
            <p>Open a document from the library, or start a new one.</p>
            <div className="editor-empty-actions">
              <button type="button" className="btn" onClick={onHome}>
                <Icon name="home" size={14} />
                Library
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void createNote()}>
                <Icon name="plus" size={14} />
                New note
              </button>
            </div>
          </div>
        ) : (
          <div className={split ? "split-grid" : "split-grid single"}>
            {([0, 1] as Side[]).map((side) => {
              const group = groups[side];
              if (side === 1 && !split) return null;
              return (
                <section
                  key={side}
                  className={focus === side ? "editor-group is-active-pane" : "editor-group"}
                  onPointerDownCapture={() => {
                    if (focusRef.current !== side) {
                      focusRef.current = side;
                      setFocus(side);
                    }
                  }}
                >
                  <div
                    className={dropTarget === `strip-${side}` ? "tab-strip drop" : "tab-strip"}
                    {...dropProps(side, `strip-${side}`)}
                  >
                    <div className="tabs" role="tablist">
                      {group.tabs.map((id, index) => {
                        const doc = byId.get(id);
                        const isActive = group.active === id;
                        const key = `tab-${side}-${id}`;
                        return (
                          <div
                            key={id}
                            role="tab"
                            aria-selected={isActive}
                            tabIndex={0}
                            draggable
                            className={[
                              "tab",
                              isActive ? "active" : "",
                              dropTarget === key ? "drop-before" : "",
                            ].join(" ")}
                            title={tabLabel(doc)}
                            onClick={() => activate(side, id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") activate(side, id);
                            }}
                            onAuxClick={(event) => {
                              if (event.button === 1) close(id);
                            }}
                            onDragStart={(event) => dragStart(event, { id, from: side })}
                            onDragEnd={dragEnd}
                            {...dropProps(side, key, index)}
                          >
                            {doc?.kind === "memo" ? <Icon name="memo" size={12} /> : null}
                            <span className="tab-title">{tabLabel(doc)}</span>
                            <button
                              type="button"
                              className="tab-close"
                              aria-label={`Close ${tabLabel(doc)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                close(id);
                              }}
                            >
                              <Icon name="close" size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="tab-strip-right">
                      <span className="tab-limit-badge">
                        {group.tabs.length}/{MAX_TABS}
                      </span>
                      {group.active ? (
                        <SymButton
                          icon={side === 0 ? "right" : "left"}
                          size="xs"
                          label={side === 0 ? "Move this tab to the right side" : "Move this tab to the left side"}
                          tipAlign="right"
                          disabled={side === 0 && group.tabs.length === 1 && !split}
                          onClick={() => {
                            if (group.active) move({ id: group.active, from: side }, side === 0 ? 1 : 0);
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                  {group.active ? (
                    <DocumentPane
                      key={group.active}
                      id={group.active}
                      active={focus === side}
                      docs={docs}
                      folders={folders}
                      tagNames={tagNames}
                      settings={settings}
                      historyOpen={historyOpen}
                      slots={slots}
                      onToggleHistory={() => setHistoryOpen((value) => !value)}
                      onSaved={onSaved}
                      onMetaChanged={onMetaChanged}
                      onDeleted={(id) => {
                        close(id);
                        onSaved();
                      }}
                      onOpenDocument={(id) => open(id, side)}
                    />
                  ) : null}
                </section>
              );
            })}
            {dragging && !split ? (
              <div
                className={dropTarget === "split-zone" ? "split-drop-zone drop" : "split-drop-zone"}
                {...dropProps(1, "split-zone")}
              >
                <Icon name="split" size={18} />
                <span>Drop to open on the right</span>
              </div>
            ) : null}
          </div>
        )}
      </main>
      <div className="drawer-slot" ref={setDrawer} />
    </div>
  );
});
