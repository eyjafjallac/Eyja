import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { livePreview, refreshPreview } from "./livePreview";

export type MarkdownEditorHandle = {
  insert: (text: string, cursor?: number) => void;
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
            keymap.of([...defaultKeymap, ...historyKeymap]),
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
              override: [wikiCompletion(() => titlesRef.current)],
            }),
            readOnlyCompartment.current.of(readOnlyExtensions(readOnlyRef.current)),
            EditorView.lineWrapping,
            EditorView.theme({
              "&": { height: "100%", backgroundColor: "transparent", color: "inherit" },
              ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6" },
              ".cm-content": { padding: "8px 20px 32px", caretColor: "currentColor" },
              "&.cm-focused": { outline: "none" },
              ".cm-placeholder": { color: "#a1a1aa" },
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
      });
    }, [value]);

    return <div ref={hostRef} className="cm-host" />;
  },
);
