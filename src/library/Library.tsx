import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { type DragEvent, useEffect, useMemo, useState } from "react";
import {
  type DocumentSummary,
  displayTitle,
  type Folder,
  folderAndDescendants,
  folderPath,
  folderTree,
  type SearchHit,
  type SearchMode,
  type Settings,
  type TagCount,
} from "../api";
import { Icon, type IconName, SymButton } from "../memo/Icon";
import { shortAge } from "../time";
import "./library.css";

type View = "all" | "starred" | "notes" | "memos";

const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: "all", label: "All documents", icon: "list" },
  { id: "starred", label: "Pinned & favorites", icon: "star" },
  { id: "notes", label: "Notes", icon: "file" },
  { id: "memos", label: "Memos", icon: "memo" },
];

const MODES: { id: SearchMode; label: string; tip: string }[] = [
  { id: "keyword", label: "Keyword", tip: "Exact words in titles and text" },
  { id: "similar", label: "Similar", tip: "Documents that use similar words, even without an exact match" },
  { id: "hybrid", label: "Both", tip: "Keyword matches and similar documents, ranked together" },
];

const DOC_DRAG = "application/x-eyja-doc";
const SEARCH_DELAY_MS = 220;
const MAX_PINNED_CARDS = 6;

type FolderEdit = { kind: "create"; parentId: string | null } | { kind: "rename"; id: string };

function inView(doc: DocumentSummary, view: View) {
  if (view === "starred") return doc.pinned || doc.favorite;
  if (view === "notes") return doc.kind === "note";
  if (view === "memos") return doc.kind === "memo";
  return true;
}

function label(doc: DocumentSummary) {
  if (doc.title.trim()) return doc.title.trim();
  return doc.kind === "memo" ? "Memo" : displayTitle(doc.title);
}

export function Library({
  visible,
  docs,
  folders,
  tags,
  settings,
  hasOpenTabs,
  onOpen,
  onOpenEditor,
  onCreateNote,
  onOpenSettings,
  onChanged,
}: {
  visible: boolean;
  docs: DocumentSummary[];
  folders: Folder[];
  tags: TagCount[];
  settings: Settings | null;
  hasOpenTabs: boolean;
  onOpen: (id: string) => void;
  onOpenEditor: () => void;
  onCreateNote: (folderId: string | null) => void;
  onOpenSettings: () => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("keyword");
  const [similarTo, setSimilarTo] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<FolderEdit | null>(null);
  const [editText, setEditText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropFolder, setDropFolder] = useState<string | null>(null);

  const byId = useMemo(() => new Map(docs.map((doc) => [doc.id, doc])), [docs]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const scope = useMemo(
    () => (folderId ? folderAndDescendants(folders, folderId) : null),
    [folderId, folders],
  );

  useEffect(() => {
    if (folderId && !folders.some((folder) => folder.id === folderId)) setFolderId(null);
  }, [folderId, folders]);

  useEffect(() => {
    if (tag && !tags.some((item) => item.name === tag)) setTag(null);
  }, [tag, tags]);

  // Search runs against the backend; filters then narrow the hits here.
  useEffect(() => {
    const text = query.trim();
    if (!similarTo && !text) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const request = similarTo
        ? invoke<SearchHit[]>("similar_documents", { id: similarTo })
        : invoke<SearchHit[]>("search_documents", { query: text, mode });
      request
        .then((found) => {
          if (!cancelled) {
            setHits(found);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(String(err));
        });
    }, similarTo ? 0 : SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Saved edits change `docs`; searching again keeps results current.
  }, [docs, mode, query, similarTo]);

  const matchesFilters = (doc: DocumentSummary) =>
    inView(doc, view) &&
    (!scope || (doc.folderId !== null && scope.has(doc.folderId))) &&
    (!tag || doc.tags.some((name) => name.toLowerCase() === tag.toLowerCase()));

  const rows: { doc: DocumentSummary; hit: SearchHit | null }[] = hits
    ? hits.flatMap((hit) => {
        const doc = byId.get(hit.id);
        return doc && matchesFilters(doc) ? [{ doc, hit }] : [];
      })
    : docs.filter(matchesFilters).map((doc) => ({ doc, hit: null }));

  const searching = hits !== null;
  const pinned = searching ? [] : docs.filter((doc) => doc.pinned && matchesFilters(doc)).slice(0, MAX_PINNED_CARDS);
  const similarDoc = similarTo ? byId.get(similarTo) : undefined;
  const showScore = searching && (similarTo !== null || mode === "similar");

  const folderCount = (id: string) => {
    const ids = folderAndDescendants(folders, id);
    return docs.filter((doc) => doc.folderId !== null && ids.has(doc.folderId)).length;
  };

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      onChanged();
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  async function loadSamples() {
    setError("");
    try {
      const set = await invoke<{ folderId: string; tourId: string }>("create_samples");
      onChanged();
      setView("all");
      setTag(null);
      setFolderId(set.folderId);
      onOpen(set.tourId);
    } catch (err: unknown) {
      setError(String(err));
    }
  }

  function startEdit(next: FolderEdit) {
    setEdit(next);
    setEditText(next.kind === "rename" ? (folders.find((folder) => folder.id === next.id)?.name ?? "") : "");
    if (next.kind === "create" && next.parentId) {
      setCollapsed((set) => {
        const copy = new Set(set);
        copy.delete(next.parentId ?? "");
        return copy;
      });
    }
  }

  async function commitEdit() {
    const current = edit;
    const name = editText.trim();
    setEdit(null);
    if (!current || !name) return;
    if (current.kind === "create") {
      await run(async () => {
        const folder = await invoke<Folder>("create_folder", { name, parentId: current.parentId });
        setFolderId(folder.id);
      });
    } else {
      await run(() => invoke("rename_folder", { id: current.id, name }));
    }
  }

  async function deleteFolder(folder: Folder) {
    const ok = await confirm(
      `Delete the folder "${folder.name}"? Its documents and folders move up one level; nothing is deleted.`,
      { kind: "warning", okLabel: "Delete folder" },
    );
    if (!ok) return;
    if (folderId === folder.id) setFolderId(folder.parentId);
    await run(() => invoke("delete_folder", { id: folder.id }));
  }

  function folderDrop(target: string | null) {
    const key = target ?? "__root";
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(DOC_DRAG)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropFolder(key);
      },
      onDragLeave: () => setDropFolder((value) => (value === key ? null : value)),
      onDrop: (event: DragEvent) => {
        const id = event.dataTransfer.getData(DOC_DRAG);
        event.preventDefault();
        setDropFolder(null);
        if (id) void run(() => invoke("set_document_folder", { id, folderId: target }));
      },
    };
  }

  const toggle = (doc: DocumentSummary, field: "pinned" | "favorite") =>
    run(() =>
      field === "pinned"
        ? invoke("set_document_pinned", { id: doc.id, pinned: !doc.pinned })
        : invoke("set_document_favorite", { id: doc.id, favorite: !doc.favorite }),
    );

  function findSimilar(doc: DocumentSummary) {
    setQuery("");
    setSimilarTo(doc.id);
  }

  const heading = similarDoc
    ? `Similar to “${label(similarDoc)}”`
    : searching
      ? "Search results"
      : folderId
        ? folderPath(folders, folderId).join(" / ")
        : (VIEWS.find((item) => item.id === view)?.label ?? "Documents");

  const editInput = (
    <input
      className="folder-input"
      autoFocus
      value={editText}
      placeholder="Folder name"
      aria-label="Folder name"
      onChange={(event) => setEditText(event.target.value)}
      onBlur={() => void commitEdit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") void commitEdit();
        if (event.key === "Escape") setEdit(null);
      }}
    />
  );

  return (
    <div className="library-shell" hidden={!visible}>
      <aside className="sidebar library-sidebar">
        <div className="brand-bar">
          <div className="brand-id">
            <div className="brand-mark">E</div>
            <span>Eyja Library</span>
          </div>
          <div className="brand-actions">
            <SymButton
              icon="memo"
              label="New memo window"
              tipAlign="right"
              onClick={() =>
                void invoke("open_memo", { id: null }).catch((err: unknown) => setError(String(err)))
              }
            />
          </div>
        </div>
        <div className="library-new">
          <button type="button" className="btn btn-primary" onClick={() => onCreateNote(folderId)}>
            <Icon name="plus" size={14} />
            New note{folderId ? " here" : ""}
          </button>
        </div>
        <div className="library-scroll">
          <div className="nav-label">
            <span>Views</span>
          </div>
          <div className="tree-list">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id && !folderId ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setView(item.id);
                  setFolderId(null);
                }}
              >
                <span className="nav-item-icon">
                  <Icon name={item.icon} size={14} />
                </span>
                <span className="nav-item-title">{item.label}</span>
                <span className="nav-time">{docs.filter((doc) => inView(doc, item.id)).length}</span>
              </button>
            ))}
          </div>

          <div
            className={dropFolder === "__root" ? "nav-label with-action drop" : "nav-label with-action"}
            {...folderDrop(null)}
          >
            <span>Folders</span>
            <SymButton
              icon="folderPlus"
              size="xs"
              label="New folder"
              tipAlign="right"
              onClick={() => startEdit({ kind: "create", parentId: null })}
            />
          </div>
          <div className="tree-list">
            {edit?.kind === "create" && edit.parentId === null ? (
              <div className="folder-row editing">{editInput}</div>
            ) : null}
            {tree.map(({ folder, depth }) => {
              const hiddenByParent = (() => {
                let parent = folder.parentId;
                while (parent) {
                  if (collapsed.has(parent)) return true;
                  parent = folders.find((item) => item.id === parent)?.parentId ?? null;
                }
                return false;
              })();
              if (hiddenByParent) return null;
              const hasChildren = folders.some((item) => item.parentId === folder.id);
              const isOpen = !collapsed.has(folder.id);
              return (
                <div key={folder.id}>
                  {edit?.kind === "rename" && edit.id === folder.id ? (
                    <div className="folder-row editing" style={{ paddingLeft: 8 + depth * 14 }}>
                      {editInput}
                    </div>
                  ) : (
                    <div
                      className={[
                        "folder-row",
                        folderId === folder.id ? "active" : "",
                        dropFolder === folder.id ? "drop" : "",
                      ].join(" ")}
                      style={{ paddingLeft: 4 + depth * 14 }}
                      {...folderDrop(folder.id)}
                    >
                      <button
                        type="button"
                        className={isOpen ? "folder-twist open" : "folder-twist"}
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        style={{ visibility: hasChildren ? "visible" : "hidden" }}
                        onClick={() =>
                          setCollapsed((set) => {
                            const copy = new Set(set);
                            if (copy.has(folder.id)) copy.delete(folder.id);
                            else copy.add(folder.id);
                            return copy;
                          })
                        }
                      >
                        <Icon name="chevron" size={12} />
                      </button>
                      <button
                        type="button"
                        className="folder-name"
                        onClick={() => setFolderId(folderId === folder.id ? null : folder.id)}
                      >
                        <Icon name="folder" size={14} />
                        <span>{folder.name}</span>
                      </button>
                      <span className="folder-count">{folderCount(folder.id)}</span>
                      <span className="folder-actions">
                        <SymButton
                          icon="folderPlus"
                          size="xs"
                          label="New folder inside"
                          onClick={() => startEdit({ kind: "create", parentId: folder.id })}
                        />
                        <SymButton
                          icon="edit"
                          size="xs"
                          label="Rename"
                          onClick={() => startEdit({ kind: "rename", id: folder.id })}
                        />
                        <SymButton
                          icon="trash"
                          size="xs"
                          danger
                          label="Delete folder"
                          tipAlign="right"
                          onClick={() => void deleteFolder(folder)}
                        />
                      </span>
                    </div>
                  )}
                  {edit?.kind === "create" && edit.parentId === folder.id ? (
                    <div className="folder-row editing" style={{ paddingLeft: 22 + depth * 14 }}>
                      {editInput}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {folders.length === 0 && !edit ? (
              <p className="sidebar-empty">No folders yet. Drag documents onto a folder to file them.</p>
            ) : null}
          </div>

          <div className="nav-label">
            <span>Tags</span>
            <span>max {settings?.maxTags ?? 5} per document</span>
          </div>
          <div className="tag-cloud">
            {tags.length === 0 ? <p className="sidebar-empty">No tags yet.</p> : null}
            {tags.map((item) => (
              <button
                key={item.name}
                type="button"
                className={tag === item.name ? "tag-pill accent" : "tag-pill"}
                aria-pressed={tag === item.name}
                onClick={() => setTag(tag === item.name ? null : item.name)}
              >
                #{item.name} <span className="tag-count">{item.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-footer-left">
            <SymButton icon="settings" label="Settings" tipPos="top" tipAlign="left" onClick={onOpenSettings} />
            <SymButton
              icon="book"
              label="Load sample notes (a tour of every feature)"
              tipPos="top"
              tipAlign="left"
              onClick={() => void loadSamples()}
            />
          </div>
          {hasOpenTabs ? (
            <button type="button" className="btn btn-ghost" onClick={onOpenEditor}>
              Editor
              <Icon name="right" size={14} />
            </button>
          ) : null}
        </div>
      </aside>

      <main className="library-main">
        <section className="search-card">
          <div className="search-bar">
            <Icon name="search" size={16} />
            <input
              value={query}
              placeholder="Search notes and memos"
              aria-label="Search the library"
              onChange={(event) => {
                setSimilarTo(null);
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setSimilarTo(null);
                }
              }}
            />
            {query || similarTo ? (
              <SymButton
                icon="close"
                size="xs"
                label="Clear search"
                tipAlign="right"
                onClick={() => {
                  setQuery("");
                  setSimilarTo(null);
                }}
              />
            ) : null}
          </div>
          <div className="search-modes">
            <div className="seg-control" role="radiogroup" aria-label="Search mode">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.id}
                  className={mode === item.id ? "seg-btn active" : "seg-btn"}
                  data-tip={item.tip}
                  onClick={() => {
                    setSimilarTo(null);
                    setMode(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <span>
              {tag ? `#${tag} · ` : ""}
              {searching ? `${rows.length} found` : `${rows.length} documents`}
            </span>
          </div>
        </section>

        {error ? <p className="error-banner">{error}</p> : null}

        {pinned.length > 0 ? (
          <section>
            <div className="section-head">
              <strong>
                <Icon name="pin" size={14} /> Pinned
              </strong>
            </div>
            <div className="cards-grid">
              {pinned.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className={doc.kind === "memo" ? `note-card memo-card memo-${doc.color ?? "default"}` : "note-card"}
                  onClick={() => onOpen(doc.id)}
                >
                  {doc.coverPath ? (
                    <div className="card-cover">
                      <img src={convertFileSrc(doc.coverPath)} alt="" />
                    </div>
                  ) : null}
                  <div className="card-body">
                    <div className="card-title">
                      <span>{label(doc)}</span>
                      {doc.favorite ? <Icon name="star" size={13} /> : null}
                    </div>
                    <div className="card-excerpt">{doc.preview || "Empty"}</div>
                    {doc.tags.length > 0 ? (
                      <div className="card-tags">
                        {doc.tags.map((name) => (
                          <span key={name} className="tag-pill">
                            #{name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="doc-list-box">
          <div className="doc-list-header">
            <strong>{heading}</strong>
            <span>
              {folderId || tag || view !== "all" ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setView("all");
                    setFolderId(null);
                    setTag(null);
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </span>
          </div>
          <div className="doc-row doc-row-head" aria-hidden="true">
            <span />
            <span>Title</span>
            <span>Folder</span>
            <span>Tags</span>
            <span>{showScore ? "Similarity" : ""}</span>
            <span>Updated</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <div className="doc-empty">
              <p>
                {searching
                  ? "Nothing matches. Try other words, or the Similar mode."
                  : docs.length === 0
                    ? "No documents yet. Create a note, or press the memo shortcut anywhere."
                    : "No documents here."}
              </p>
              {docs.length === 0 ? (
                <button type="button" className="btn" onClick={() => void loadSamples()}>
                  <Icon name="book" size={14} />
                  Load sample notes
                </button>
              ) : null}
            </div>
          ) : (
            rows.map(({ doc, hit }) => (
              <div
                key={doc.id}
                className="doc-row"
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DOC_DRAG, doc.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onOpen(doc.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(doc.id);
                }}
              >
                <span className="doc-icon">
                  {doc.kind === "memo" ? (
                    <span className={`memo-dot memo-${doc.color ?? "default"}`} />
                  ) : (
                    <Icon name="file" size={15} />
                  )}
                </span>
                <div className="doc-title-cell">
                  <strong>{label(doc)}</strong>
                  <span className="doc-preview">{hit?.snippet || doc.preview}</span>
                </div>
                <span
                  className="doc-folder"
                  title={doc.folderId ? folderPath(folders, doc.folderId).join(" / ") : undefined}
                >
                  {doc.folderId ? folders.find((folder) => folder.id === doc.folderId)?.name : doc.kind === "memo" ? "Memo" : "—"}
                </span>
                <div className="doc-tags">
                  {doc.tags.map((name) => (
                    <span key={name} className={tag === name ? "tag-pill accent" : "tag-pill"}>
                      #{name}
                    </span>
                  ))}
                </div>
                <span>
                  {showScore && hit ? <span className="similarity-badge">{hit.score.toFixed(2)}</span> : null}
                </span>
                <span className="doc-time">{shortAge(doc.updatedAt)}</span>
                <span className="doc-actions" onClick={(event) => event.stopPropagation()}>
                  <SymButton
                    icon="star"
                    size="xs"
                    label={doc.favorite ? "Remove from favorites" : "Add to favorites"}
                    pressed={doc.favorite}
                    className={doc.favorite ? "star-on" : undefined}
                    onClick={() => void toggle(doc, "favorite")}
                  />
                  <SymButton
                    icon="pin"
                    size="xs"
                    label={doc.pinned ? "Unpin" : "Pin to the top"}
                    pressed={doc.pinned}
                    onClick={() => void toggle(doc, "pinned")}
                  />
                  <SymButton
                    icon="similar"
                    size="xs"
                    label="Find similar documents"
                    onClick={() => findSimilar(doc)}
                  />
                  {doc.kind === "memo" ? (
                    <SymButton
                      icon="window"
                      size="xs"
                      label="Open as a memo window"
                      tipAlign="right"
                      onClick={() =>
                        void invoke("open_memo", { id: doc.id }).catch((err: unknown) =>
                          setError(String(err)),
                        )
                      }
                    />
                  ) : null}
                </span>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
