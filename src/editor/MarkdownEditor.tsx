import {
  acceptCompletion,
  autocompletion,
  type CompletionSource,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { type BlockAnchor, BlockEditor } from "./BlockEditor";
import type { EditableBlock } from "./blocks";
import { mathCompletion, slashCompletion } from "./complete";
import { promptTheme } from "./editorTheme";
import { livePreview, refreshPreview, showRendered } from "./livePreview";
import { colorAttribute, colorSpanPattern, type TextColor } from "./textColors";

export type MarkdownEditorHandle = {
  insert: (text: string, cursor?: number) => void;
  /** Wrap the selection in `++ ++`, or remove that wrapper if it is already there. */
  enlargeSelection: () => void;
  /**
   * Colour the selection as `[words]{.red}`, or recolour the span the selection sits in.
   * `null` removes the colour.
   */
  colorSelection: (color: TextColor | null, refocus?: boolean) => void;
  /** Type `[[` at the cursor and open the list of document titles. */
  insertReference: () => void;
  focus: () => void;
};

type MarkdownEditorProps = {
  value: string;
  titles: string[];
  placeholder?: string;
  readOnly?: boolean;
  resolveImage?: (src: string) => string | null;
  onChange: (value: string) => void;
  onOpenTitle: (title: string) => void;
  onPasteImages?: (files: File[]) => void;
};

function locateBlock(view: EditorView, block: EditableBlock): BlockAnchor {
  const top = view.lineBlockAt(block.from).top + view.documentTop;
  const bottom = view.lineBlockAt(Math.max(block.from, block.to - 1)).bottom + view.documentTop;
  const content = view.contentDOM.getBoundingClientRect();
  const style = getComputedStyle(view.contentDOM);
  const left = content.left + (Number.parseFloat(style.paddingLeft) || 0);
  const right = content.right - (Number.parseFloat(style.paddingRight) || 0);
  return { top, bottom, left, width: Math.min(560, Math.max(300, right - left)) };
}

function readOnlyExtensions(readOnly: boolean) {
  if (!readOnly) return [];
  return [EditorState.readOnly.of(true), EditorView.editable.of(false)];
}

function wikiCompletion(titles: () => string[]): CompletionSource {
  return (context) => {
    const match = context.matchBefore(/\[\[[^\]\n]*$/);
    if (!match) return null;
    const query = match.text.slice(2).toLowerCase();
    const options = titles()
      .filter((title) => title.toLowerCase().includes(query))
      .map((title) => ({
        label: title,
        apply: (view: EditorView, _completion: unknown, _from: number, to: number) => {
          const insert = `[[${title}]]`;
          view.dispatch({
            changes: { from: match.from, to, insert },
            selection: EditorSelection.cursor(match.from + insert.length),
          });
        },
      }));
    if (options.length === 0) return null;
    return { from: match.from + 2, options, validFor: /^[^\]\n]*$/ };
  };
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      titles,
      placeholder,
      readOnly = false,
      resolveImage,
      onChange,
      onOpenTitle,
      onPasteImages,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onOpenTitleRef = useRef(onOpenTitle);
    const onPasteImagesRef = useRef(onPasteImages);
    const resolveImageRef = useRef(resolveImage);
    const titlesRef = useRef(titles);
    const readOnlyRef = useRef(readOnly);
    const readOnlyCompartment = useRef(new Compartment());
    onChangeRef.current = onChange;
    onOpenTitleRef.current = onOpenTitle;
    onPasteImagesRef.current = onPasteImages;
    resolveImageRef.current = resolveImage;
    titlesRef.current = titles;
    readOnlyRef.current = readOnly;
    const [editing, setEditing] = useState<{ block: EditableBlock; anchor: BlockAnchor } | null>(null);

    const editBlockRef = useRef((block: EditableBlock) => {
      const view = viewRef.current;
      if (!view || readOnlyRef.current) return;
      view.requestMeasure({
        read: () => locateBlock(view, block),
        write: (anchor) => setEditing({ block, anchor }),
      });
    });

    // Follow the block while the note scrolls under the open pop-up.
    useEffect(() => {
      const view = viewRef.current;
      const block = editing?.block;
      if (!view || !block) return;
      const follow = () =>
        view.requestMeasure({
          key: "block-editor",
          read: () => locateBlock(view, block),
          write: (anchor) => setEditing((current) => (current?.block === block ? { block, anchor } : current)),
        });
      view.scrollDOM.addEventListener("scroll", follow);
      window.addEventListener("resize", follow);
      return () => {
        view.scrollDOM.removeEventListener("scroll", follow);
        window.removeEventListener("resize", follow);
      };
    }, [editing?.block]);

    /** Write the pop-up's result back; `null` removes the block. */
    const closeBlock = useCallback(
      (markdown: string | null | undefined) => {
        const view = viewRef.current;
        const block = editing?.block;
        setEditing(null);
        if (!view || !block) return;
        view.focus();
        // Skip if the note changed under the pop-up, or nothing was edited.
        if (markdown === undefined || view.state.sliceDoc(block.from, block.to) !== block.raw) return;
        if (markdown === block.raw) return;
        const doc = view.state.doc;
        if (markdown === null) {
          let { from, to } = block;
          if (doc.sliceString(to, to + 1) === "\n") to += 1;
          else if (from > 0 && doc.sliceString(from - 1, from) === "\n") from -= 1;
          view.dispatch({
            changes: { from, to },
            selection: EditorSelection.cursor(from),
            effects: showRendered.of(null),
            userEvent: "delete.block",
          });
          return;
        }
        // Leave the cursor on the line after the block, so the block stays rendered.
        const end = block.from + markdown.length;
        const hasNextLine = block.to < doc.length;
        view.dispatch({
          changes: { from: block.from, to: block.to, insert: hasNextLine ? markdown : `${markdown}\n` },
          selection: EditorSelection.cursor(end + 1),
          effects: showRendered.of(null),
          userEvent: "input.block",
        });
      },
      [editing],
    );

    useImperativeHandle(ref, () => ({
      insert(text: string, cursor?: number) {
        const view = viewRef.current;
        if (!view || readOnlyRef.current) return;
        const range = view.state.selection.main;
        const at = range.from + Math.min(cursor ?? text.length, text.length);
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          selection: EditorSelection.cursor(at),
        });
        view.focus();
      },
      enlargeSelection() {
        const view = viewRef.current;
        if (!view || readOnlyRef.current) return;
        const range = view.state.selection.main;
        if (range.empty) return;
        const doc = view.state.doc;
        const selected = doc.sliceString(range.from, range.to);
        if (/^\+\+[^\n+]+\+\+$/.test(selected)) {
          const inner = selected.slice(2, -2);
          view.dispatch({
            changes: { from: range.from, to: range.to, insert: inner },
            selection: EditorSelection.range(range.from, range.from + inner.length),
          });
          view.focus();
          return;
        }
        const before = range.from >= 2 ? doc.sliceString(range.from - 2, range.from) : "";
        const after = doc.sliceString(range.to, Math.min(doc.length, range.to + 2));
        if (before === "++" && after === "++") {
          const from = range.from - 2;
          const inner = doc.sliceString(range.from, range.to);
          view.dispatch({
            changes: { from, to: range.to + 2, insert: inner },
            selection: EditorSelection.range(from, from + inner.length),
          });
          view.focus();
          return;
        }
        if (selected.includes("\n") || selected.includes("+")) return;
        const insert = `++${selected}++`;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: EditorSelection.range(range.from + 2, range.from + 2 + selected.length),
        });
        view.focus();
      },
      colorSelection(color: TextColor | null, refocus = true) {
        const view = viewRef.current;
        if (!view || readOnlyRef.current) return;
        const range = view.state.selection.main;
        const line = view.state.doc.lineAt(range.from);
        if (range.to > line.to) return;
        const done = (from: number, to: number, insert: string, start: number, length: number) => {
          view.dispatch({
            changes: { from, to, insert },
            selection: EditorSelection.range(start, start + length),
          });
          if (refocus) view.focus();
        };
        for (const match of line.text.matchAll(colorSpanPattern())) {
          const from = line.from + (match.index ?? 0);
          const to = from + match[0].length;
          if (range.from < from || range.to > to) continue;
          const inner = match[1] ?? "";
          if (color) done(from, to, `[${inner}]{${colorAttribute(color)}}`, from + 1, inner.length);
          else done(from, to, inner, from, inner.length);
          return;
        }
        if (range.empty || !color) return;
        const selected = view.state.doc.sliceString(range.from, range.to);
        if (/[[\]\n]/.test(selected)) return;
        done(
          range.from,
          range.to,
          `[${selected}]{${colorAttribute(color)}}`,
          range.from + 1,
          selected.length,
        );
      },
      insertReference() {
        const view = viewRef.current;
        if (!view || readOnlyRef.current) return;
        const range = view.state.selection.main;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert: "[[" },
          selection: EditorSelection.cursor(range.from + 2),
        });
        view.focus();
        startCompletion(view);
      },
      focus() {
        viewRef.current?.focus();
      },
    }));

    useEffect(() => {
      const parent = hostRef.current;
      if (!parent) return;
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: value,
          extensions: [
            history(),
            Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            search({ top: true }),
            highlightSelectionMatches(),
            markdown({
              base: markdownLanguage,
              codeLanguages: languages,
              completeHTMLTags: false,
              pasteURLAsLink: false,
            }),
            placeholderExtension(placeholder ?? ""),
            livePreview({
              onOpenTitle: (title) => onOpenTitleRef.current(title),
              resolveImage: (src) => resolveImageRef.current?.(src) ?? null,
              onEditBlock: (block) => editBlockRef.current(block),
            }),
            EditorView.domEventHandlers({
              mousedown(event) {
                const target = event.target;
                if (!(target instanceof Element)) return false;
                const wiki = target.closest(".cm-wiki");
                if (!wiki) return false;
                event.preventDefault();
                onOpenTitleRef.current(wiki.getAttribute("data-title") ?? wiki.textContent ?? "");
                return true;
              },
              paste(event) {
                const handler = onPasteImagesRef.current;
                if (!handler || readOnlyRef.current) return false;
                const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                  file.type.startsWith("image/"),
                );
                if (images.length === 0) return false;
                event.preventDefault();
                handler(images);
                return true;
              },
            }),
            autocompletion({
              override: [slashCompletion, mathCompletion, wikiCompletion(() => titlesRef.current)],
              icons: false,
              maxRenderedOptions: 200,
            }),
            readOnlyCompartment.current.of(readOnlyExtensions(readOnlyRef.current)),
            EditorView.lineWrapping,
            EditorView.theme({
              "&": { height: "100%", backgroundColor: "transparent", color: "inherit" },
              ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
              ".cm-content": {
                padding: "var(--cm-padding, 8px 20px 32px)",
                caretColor: "currentColor",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-placeholder": { color: "var(--text-muted)" },
              ...promptTheme,
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !readOnlyRef.current) {
                onChangeRef.current(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // The editor is created once; later value changes are dispatched below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: readOnlyCompartment.current.reconfigure(readOnlyExtensions(readOnly)),
      });
    }, [readOnly]);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: refreshPreview.of(null) });
    }, [resolveImage]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        effects: showRendered.of(null),
      });
    }, [value]);

    return (
      <>
        <div ref={hostRef} className="cm-host" />
        {editing ? (
          <BlockEditor
            key={`${editing.block.from}:${editing.block.raw}`}
            block={editing.block}
            anchor={editing.anchor}
            onApply={(markdown) => closeBlock(markdown)}
            onCancel={() => closeBlock(undefined)}
            onRemove={() => closeBlock(null)}
          />
        ) : null}
      </>
    );
  },
);
