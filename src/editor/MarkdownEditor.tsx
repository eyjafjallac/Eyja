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
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { mathCompletion, slashCompletion } from "./complete";
import { livePreview, refreshPreview, showRendered } from "./livePreview";

export type MarkdownEditorHandle = {
  insert: (text: string, cursor?: number) => void;
  /** Wrap the selection in `++ ++`, or remove that wrapper if it is already there. */
  enlargeSelection: () => void;
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

const promptTheme = {
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "6px",
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-md)",
    fontFamily: "var(--font-sans)",
    fontSize: "12.5px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "320px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "5px 8px",
    borderRadius: "6px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--text-on-accent)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "inherit",
    opacity: "0.8",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    padding: "4px 8px 4px",
    color: "var(--text-muted)",
    fontFamily: "inherit",
    fontSize: "10.5px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    opacity: "1",
    border: "0",
  },
  ".cm-completionLabel": {
    fontFamily: "var(--font-mono)",
    fontWeight: "500",
  },
  ".cm-completionDetail": {
    marginLeft: "16px",
    fontStyle: "normal",
    color: "var(--text-muted)",
  },
  ".cm-snippetField": {
    backgroundColor: "var(--accent-border)",
    borderRadius: "2px",
  },
};

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
            }),
            EditorView.domEventHandlers({
              mousedown(event) {
                const target = event.target;
                if (!(target instanceof Element)) return false;
                const wiki = target.closest(".cm-wiki");
                if (!wiki) return false;
                event.preventDefault();
                onOpenTitleRef.current(wiki.textContent ?? "");
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

    return <div ref={hostRef} className="cm-host" />;
  },
);
