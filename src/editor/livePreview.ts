import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { type EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import hljs from "highlight.js/lib/common";
import katex from "katex";

type Span = { from: number; to: number; deco: Decoration };
type Range = { from: number; to: number };

export type LivePreviewHandlers = {
  onOpenTitle: (title: string) => void;
  /** Turns an `asset:<id>` image source into a URL the webview can load. */
  resolveImage?: (src: string) => string | null;
};

/** Rebuilds the preview when something outside the document changes, such as the image list. */
export const refreshPreview = StateEffect.define<null>();

const hide = Decoration.replace({});

class TextWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly tag: string,
    private readonly className: string,
  ) {
    super();
  }

  eq(other: TextWidget) {
    return other.label === this.label && other.tag === this.tag;
  }

  toDOM() {
    const element = document.createElement(this.tag);
    element.className = this.className;
    element.textContent = this.label;
    return element;
  }
}

class HtmlWidget extends WidgetType {
  constructor(
    private readonly signature: string,
    private readonly html: string,
    private readonly className: string,
    private readonly block: boolean,
  ) {
    super();
  }

  eq(other: HtmlWidget) {
    return other.signature === this.signature;
  }

  toDOM() {
    const element = document.createElement(this.block ? "div" : "span");
    element.className = this.className;
    element.innerHTML = this.html;
    return element;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly src: string,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.alt === this.alt && other.src === this.src;
  }

  toDOM() {
    const figure = document.createElement("span");
    figure.className = "cm-image";
    if (/^(https?:|data:image\/|asset:\/\/)/.test(this.src)) {
      const image = document.createElement("img");
      image.alt = this.alt;
      image.src = this.src;
      figure.append(image);
      return figure;
    }
    figure.textContent = this.alt || "Image";
    return figure;
  }
}

class WikiWidget extends WidgetType {
  constructor(
    private readonly title: string,
    private readonly open: (title: string) => void,
  ) {
    super();
  }

  eq(other: WikiWidget) {
    return other.title === this.title;
  }

  toDOM() {
    const link = document.createElement("a");
    link.className = "cm-wiki";
    link.href = "#";
    link.textContent = this.title;
    link.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.open(this.title);
    });
    return link;
  }

  ignoreEvent() {
    return true;
  }
}

class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source;
  }

  toDOM() {
    const rows = this.source
      .trim()
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim()),
      )
      .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
    const table = document.createElement("table");
    table.className = "cm-table";
    rows.forEach((row, index) => {
      const container = document.createElement(index === 0 ? "thead" : "tbody");
      const tr = document.createElement("tr");
      for (const cell of row) {
        const element = document.createElement(index === 0 ? "th" : "td");
        element.textContent = cell;
        tr.append(element);
      }
      container.append(tr);
      table.append(container);
    });
    return table;
  }
}

function selectionLines(state: EditorState) {
  const selection = state.selection.main;
  return {
    from: state.doc.lineAt(selection.from).number,
    to: state.doc.lineAt(selection.to).number,
  };
}

function coversSelection(state: EditorState, from: number, to: number) {
  const lines = selectionLines(state);
  const start = state.doc.lineAt(from).number;
  const end = state.doc.lineAt(Math.max(from, to - 1)).number;
  return lines.from <= end && lines.to >= start;
}

function overlaps(ranges: Range[], from: number, to: number) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function lineAligned(state: EditorState, from: number, to: number) {
  if (from >= to) return false;
  const start = state.doc.lineAt(from);
  const end = state.doc.lineAt(to - 1);
  return from === start.from && to === end.to;
}

function highlightCode(code: string, language: string) {
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

function renderMath(tex: string, display: boolean) {
  return katex.renderToString(tex.trim(), {
    displayMode: display,
    throwOnError: false,
  });
}

function parseFence(source: string) {
  const lines = source.replace(/\n$/, "").split("\n");
  const info = lines[0]?.replace(/^```/, "").trim() ?? "";
  const language = info.split(/\s+/)[0] ?? "";
  const last = lines[lines.length - 1];
  const closing = last?.startsWith("```") ? 1 : 0;
  return { language, code: lines.slice(1, lines.length - closing).join("\n") };
}

export function livePreview(handlers: LivePreviewHandlers) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, handlers);
    },
    update(decorations, transaction) {
      const refreshed = transaction.effects.some((effect) => effect.is(refreshPreview));
      if (!transaction.docChanged && !transaction.selection && !refreshed) return decorations;
      return buildDecorations(transaction.state, handlers);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildDecorations(
  state: EditorState,
  handlers: LivePreviewHandlers,
): DecorationSet {
  const spans: Span[] = [];
  const blocked: Range[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      const active = coversSelection(state, from, to);

      if (name === "FencedCode") {
        blocked.push({ from, to });
        if (!active) {
          const { language, code } = parseFence(state.doc.sliceString(from, to));
          const block = lineAligned(state, from, to);
          spans.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new HtmlWidget(
                `code:${language}:${code}`,
                `<pre class="cm-code hljs"><code>${highlightCode(code, language)}</code></pre>`,
                "cm-block",
                block,
              ),
              block,
            }),
          });
        }
        return false;
      }

      if (name === "Table") {
        blocked.push({ from, to });
        if (!active) {
          const block = lineAligned(state, from, to);
          spans.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new TableWidget(state.doc.sliceString(from, to)),
              block,
            }),
          });
        }
        return false;
      }

      if (name === "InlineCode") {
        blocked.push({ from, to });
        if (!active) {
          const code = state.doc
            .sliceString(from, to)
            .replace(/^`+/, "")
            .replace(/`+$/, "");
          spans.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new TextWidget(code, "code", "cm-inline-code"),
            }),
          });
        }
        return false;
      }

      if (name === "Image") {
        blocked.push({ from, to });
        if (!active) {
          const raw = state.doc.sliceString(from, to);
          const parsed = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(raw);
          if (parsed) {
            const src = parsed[2] ?? "";
            spans.push({
              from,
              to,
              deco: Decoration.replace({
                widget: new ImageWidget(parsed[1] ?? "", handlers.resolveImage?.(src) ?? src),
              }),
            });
          }
        }
        return false;
      }

      if (/^ATXHeading[1-6]$/.test(name)) {
        if (active) return false;
        const line = state.doc.lineAt(from);
        const marks = /^(#{1,6}\s+)/.exec(line.text);
        if (!marks) return false;
        const markEnd = line.from + marks[1].length;
        const level = marks[1].trim().length;
        spans.push({ from: line.from, to: markEnd, deco: hide });
        if (markEnd < line.to) {
          spans.push({
            from: markEnd,
            to: line.to,
            deco: Decoration.mark({ class: `cm-h cm-h${level}` }),
          });
        }
        return false;
      }

      if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
        if (active) return false;
        const raw = state.doc.sliceString(from, to);
        if (raw.includes("$")) return;
        const label = raw.replace(/^(?:\*\*|__|\*|_|~~)/, "").replace(/(?:\*\*|__|\*|_|~~)$/, "");
        const tag = name === "StrongEmphasis" ? "strong" : name === "Strikethrough" ? "s" : "em";
        spans.push({
          from,
          to,
          deco: Decoration.replace({
            widget: new TextWidget(label, tag, "cm-inline"),
          }),
        });
        return false;
      }

      return undefined;
    },
  });

  const text = state.doc.toString();
  for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || coversSelection(state, from, to)) continue;
    blocked.push({ from, to });
    const block = lineAligned(state, from, to);
    spans.push({
      from,
      to,
      deco: Decoration.replace({
        widget: new HtmlWidget(
          `math-block:${match[1]}`,
          renderMath(match[1] ?? "", true),
          "cm-math cm-math-block",
          block,
        ),
        block,
      }),
    });
  }

  for (const match of text.matchAll(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || coversSelection(state, from, to)) continue;
    blocked.push({ from, to });
    spans.push({
      from,
      to,
      deco: Decoration.replace({
        widget: new HtmlWidget(
          `math:${match[1]}`,
          renderMath(match[1] ?? "", false),
          "cm-math",
          false,
        ),
      }),
    });
  }

  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const title = (match[1] ?? "").trim();
    if (!title || overlaps(blocked, from, to) || coversSelection(state, from, to)) continue;
    spans.push({
      from,
      to,
      deco: Decoration.replace({
        widget: new WikiWidget(title, handlers.onOpenTitle),
      }),
    });
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let cursor = 0;
  for (const span of spans) {
    if (span.from < cursor || span.from >= span.to) continue;
    builder.add(span.from, span.to, span.deco);
    cursor = span.to;
  }
  return builder.finish();
}
