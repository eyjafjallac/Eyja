import { useId, useRef, useState } from "react";

/** Flat tag pills with a "+ Tag (n/max)" entry. Names are normalized by the backend. */
export function TagEditor({
  tags,
  max,
  suggestions,
  disabled = false,
  compact = false,
  onChange,
}: {
  tags: string[];
  max: number;
  suggestions: string[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lower = new Set(tags.map((tag) => tag.toLowerCase()));
  const options = suggestions.filter((name) => !lower.has(name.toLowerCase()));
  const full = tags.length >= max;

  function commit(keepOpen: boolean) {
    const name = text.trim().replace(/^#+/, "").trim();
    setText("");
    if (!keepOpen) setAdding(false);
    if (!name || lower.has(name.toLowerCase())) return;
    onChange([...tags, name]);
    if (tags.length + 1 >= max) setAdding(false);
  }

  return (
    <div className={compact ? "tag-row compact" : "tag-row"} aria-label="Tags">
      {tags.map((tag) => (
        <span key={tag} className="tag-pill accent">
          #{tag}
          {disabled ? null : (
            <button
              type="button"
              className="tag-remove"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((item) => item !== tag))}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {disabled ? null : adding ? (
        <>
          <input
            ref={inputRef}
            className="tag-input"
            value={text}
            list={listId}
            placeholder="tag name"
            aria-label="New tag"
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit(true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setText("");
                setAdding(false);
              } else if (event.key === "Backspace" && text === "" && tags.length > 0) {
                onChange(tags.slice(0, -1));
              }
            }}
          />
          <datalist id={listId}>
            {options.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          className="tag-pill tag-add"
          disabled={full}
          title={full ? "Tag limit reached; change it in Settings" : undefined}
          onClick={() => setAdding(true)}
        >
          {full ? `Tags ${tags.length}/${max}` : `+ Tag (${tags.length}/${max})`}
        </button>
      )}
    </div>
  );
}
