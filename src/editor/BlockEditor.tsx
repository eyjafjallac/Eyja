import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import katex from "katex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../memo/Icon";
import { blockMarkdown, type EditableBlock, tableRows } from "./blocks";
import { texCompletion } from "./complete";
import { promptTheme } from "./editorTheme";

/** Where the block sits on screen, in viewport pixels. */
export type BlockAnchor = { top: number; bottom: number; left: number; width: number };

const TITLES: Record<EditableBlock["kind"], string> = {
  math: "Math block",
  code: "Code block",
  table: "Table",
};

const MARGIN = 8;

/**
 * Small pop-up that edits one maths block, code block or table, with a live preview.
 * The block stays rendered in the note while it is open.
 */
export function BlockEditor({
  block,
  anchor,
  onApply,
  onCancel,
  onRemove,
}: {
  block: EditableBlock;
  anchor: BlockAnchor;
  onApply: (markdown: string) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(block.text);
  const [language, setLanguage] = useState(block.language);
  const [top, setTop] = useState(anchor.bottom + MARGIN);
  const boxRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ text, language, onApply, onCancel, onRemove });
  latest.current = { text, language, onApply, onCancel, onRemove };

  const finish = useRef(() => {
    const current = latest.current;
    if (block.isNew && current.text.trim() === "") current.onRemove();
    else current.onApply(blockMarkdown(block.kind, current.text, current.language));
  }).current;

  const cancel = useRef(() => {
    if (block.isNew) latest.current.onRemove();
    else latest.current.onCancel();
  }).current;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const math = block.kind === "math";
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: block.text,
        selection: EditorSelection.cursor(block.text.length),
        extensions: [
          history(),
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: () => (finish(), true) },
              ...(math ? [{ key: "Tab", run: acceptCompletion }] : []),
            ]),
          ),
          keymap.of([
            { key: "Escape", run: () => (cancel(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...(block.kind === "code" ? [indentWithTab] : []),
          ]),
          math ? autocompletion({ override: [texCompletion], icons: false, maxRenderedOptions: 200 }) : [],
          math ? EditorView.lineWrapping : [],
          EditorView.theme({
            "&": { maxHeight: "36vh", backgroundColor: "transparent", color: "inherit" },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.55" },
            ".cm-content": { padding: "8px 10px", caretColor: "currentColor" },
            ...promptTheme,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setText(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.focus();
    return () => view.destroy();
  }, [block, finish, cancel]);

  // A press anywhere else keeps the edit, like leaving a text field.
  useEffect(() => {
    const onPress = (event: MouseEvent) => {
      const box = boxRef.current;
      if (box && event.target instanceof Node && !box.contains(event.target)) finish();
    };
    document.addEventListener("mousedown", onPress, true);
    return () => document.removeEventListener("mousedown", onPress, true);
  }, [finish]);

  const width = Math.min(anchor.width, window.innerWidth - MARGIN * 2);
  const left = Math.min(Math.max(anchor.left, MARGIN), window.innerWidth - width - MARGIN);

  // Below the block when it fits, otherwise above it.
  useLayoutEffect(() => {
    const height = boxRef.current?.offsetHeight ?? 0;
    const below = anchor.bottom + MARGIN;
    const above = anchor.top - MARGIN - height;
    if (below + height <= window.innerHeight - MARGIN || above < MARGIN) {
      setTop(Math.max(MARGIN, Math.min(below, window.innerHeight - MARGIN - height)));
    } else {
      setTop(above);
    }
  }, [anchor, text]);

  const preview = useMemo(() => {
    if (block.kind === "math") {
      const html = katex.renderToString(text.trim() || "\\phantom{x}", {
        displayMode: true,
        throwOnError: false,
      });
      return <div className="block-editor-math" dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (block.kind === "table") {
      const [head, ...body] = tableRows(text);
      return (
        <table className="cm-table">
          <thead>
            <tr>{(head ?? []).map((cell, index) => <th key={index}>{cell}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    return null;
  }, [block.kind, text]);

  return createPortal(
    <div
      ref={boxRef}
      className="block-editor"
      role="dialog"
      aria-label={TITLES[block.kind]}
      style={{ top, left, width }}
    >
      <div className="block-editor-head">
        <span className="block-editor-title">{TITLES[block.kind]}</span>
        {block.kind === "code" ? (
          <input
            className="block-editor-lang"
            value={language}
            placeholder="language"
            aria-label="Code language"
            spellCheck={false}
            onChange={(event) => setLanguage(event.target.value.replace(/\s/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
              if (event.key === "Enter") finish();
            }}
          />
        ) : null}
        <span className="block-editor-hint">Ctrl+Enter to finish · Esc to cancel</span>
      </div>
      {preview ? <div className="block-editor-preview">{preview}</div> : null}
      <div ref={hostRef} className="block-editor-source" />
      <div className="block-editor-actions">
        <button type="button" className="btn block-editor-remove" onClick={onRemove}>
          <Icon name="trash" size={14} />
          Remove
        </button>
        <span className="block-editor-spacer" />
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={finish}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
