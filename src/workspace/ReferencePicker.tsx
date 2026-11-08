import { useEffect, useMemo, useRef, useState } from "react";
import { type DocumentSummary, type Folder, folderPath } from "../api";
import { Icon } from "../memo/Icon";

/** A searchable list of documents; picking one inserts `[[Title]]`. */
export function ReferencePicker({
  docs,
  folders,
  excludeId,
  onPick,
  onClose,
}: {
  docs: DocumentSummary[];
  folders: Folder[];
  excludeId: string;
  onPick: (title: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const named = docs.filter((doc) => doc.id !== excludeId && doc.title.trim().length > 0);
    if (!needle) return named;
    const matches = named.filter(
      (doc) =>
        doc.title.toLowerCase().includes(needle) ||
        doc.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
    // Titles that start with the query come first; the rest keep library order.
    return [
      ...matches.filter((doc) => doc.title.trim().toLowerCase().startsWith(needle)),
      ...matches.filter((doc) => !doc.title.trim().toLowerCase().startsWith(needle)),
    ];
  }, [docs, excludeId, query]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".picker-item.selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function pick(index: number) {
    const doc = items[index];
    if (doc) onPick(doc.title.trim());
  }

  return (
    <div className="picker-backdrop" onMouseDown={onClose}>
      <section
        className="picker"
        role="dialog"
        aria-label="Insert a reference"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="picker-head">
          <Icon name="reference" size={15} />
          <input
            autoFocus
            value={query}
            placeholder="Find a document to reference"
            aria-label="Find a document"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(index + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                pick(selected);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        {items.length === 0 ? (
          <p className="picker-empty">
            {query ? "No document with that title." : "No other titled documents yet."}
          </p>
        ) : (
          <ul className="picker-list" ref={listRef} role="listbox" aria-label="Documents">
            {items.map((doc, index) => {
              const path = folderPath(folders, doc.folderId).join(" / ");
              return (
                <li key={doc.id} role="option" aria-selected={index === selected}>
                  <button
                    type="button"
                    className={index === selected ? "picker-item selected" : "picker-item"}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => pick(index)}
                  >
                    <Icon name={doc.kind === "memo" ? "memo" : "file"} size={14} />
                    <span className="picker-item-title">{doc.title.trim()}</span>
                    <span className="picker-item-meta">
                      {path || (doc.kind === "memo" ? "Memo" : "")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="picker-foot">
          <span>↑↓ to move</span>
          <span>Enter to insert</span>
          <span>Esc to close</span>
        </div>
      </section>
    </div>
  );
}
