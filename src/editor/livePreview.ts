import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  showTooltip,
  type Tooltip,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { type EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import {
  blockAt,
  DISPLAY_MATH,
  type EditableBlock,
  lineAligned,
  mathAround,
  openBlockEditor,
  parseFence,
  tableRows,
} from "./blocks";
import { colorOf, colorSpanPattern } from "./textColors";
import "./livePreview.css";

type Span = { from: number; to: number; deco: Decoration; replace: boolean };
type Range = { from: number; to: number };

export type LivePreviewHandlers = {
  onOpenTitle: (title: string) => void;
  /** Turns an `asset:<id>` image source into a URL the webview can load. */
  resolveImage?: (src: string) => string | null;
  /** Edit a maths block, code block or table in a pop-up. Without it, blocks open in place. */
  onEditBlock?: (block: EditableBlock) => void;
};

/** Rebuilds the preview when something outside the document changes, such as the image list. */
export const refreshPreview = StateEffect.define<null>();

/** Keep every block rendered after a note is loaded, until the user edits. */
export const showRendered = StateEffect.define<null>();

const hide = Decoration.replace({});

/**
 * The editor measures a block widget by its border box and ignores CSS margins, so a margin
 * shifts every click below the block. The space around a block comes from this padded frame.
 */
function blockFrame(element: HTMLElement) {
  const frame = document.createElement("div");
  frame.className = "cm-block-frame";
  frame.append(element);
  return frame;
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
    return this.block ? blockFrame(element) : element;
  }

  ignoreEvent() {
    return false;
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

class CodeWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly code: string,
    private readonly block: boolean,
  ) {
    super();
  }

  eq(other: CodeWidget) {
    return (
      other.language === this.language &&
      other.code === this.code &&
      other.block === this.block
    );
  }

  toDOM(view: EditorView) {
    const box = document.createElement(this.block ? "div" : "span");
    box.className = this.block ? "cm-code-box cm-block-edit" : "cm-code-box";
    if (this.language) {
      box.classList.add("has-lang");
      const language = document.createElement("span");
      language.className = "cm-code-lang";
      language.textContent = this.language;
      box.append(language);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-code-copy";
    button.setAttribute("aria-label", "Copy code");
    button.append(copyGlyph(false));
    const keepFocus = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener("mousedown", (event) => {
      keepFocus(event);
      copyCode(this.code, button, () => view.focus());
    });
    button.addEventListener("mouseup", keepFocus);
    button.addEventListener("click", keepFocus);

    const pre = document.createElement("pre");
    pre.className = "cm-code hljs";
    const code = document.createElement("code");
    code.innerHTML = highlightCode(this.code, this.language);
    pre.append(code);

    box.append(button, pre);
    return this.block ? blockFrame(box) : box;
  }

  destroy(dom: HTMLElement) {
    const button = dom.querySelector(".cm-code-copy");
    if (!(button instanceof HTMLButtonElement)) return;
    const pending = button.dataset.copyTimer;
    if (pending) window.clearTimeout(Number(pending));
  }

  ignoreEvent(event: Event) {
    const target = event.target;
    return target instanceof Element && target.closest(".cm-code-copy") !== null;
  }
}

function copyGlyph(copied: boolean) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const add = (d: string) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  };
  if (copied) add("M4.5 10.5 8.2 14.2 15.5 6.2");
  else {
    add("M8 2.5h4v3.2H8z");
    add("M5.5 5.2h9v11.3h-9z");
  }
  return svg;
}

function markCopied(button: HTMLButtonElement, copied: boolean) {
  button.replaceChildren(copyGlyph(copied));
  button.setAttribute("aria-label", copied ? "Copied" : "Copy code");
  const pending = button.dataset.copyTimer;
  if (pending) window.clearTimeout(Number(pending));
  if (!copied) {
    delete button.dataset.copyTimer;
    return;
  }
  const timer = window.setTimeout(() => {
    button.replaceChildren(copyGlyph(false));
    button.setAttribute("aria-label", "Copy code");
    delete button.dataset.copyTimer;
  }, 1200);
  button.dataset.copyTimer = String(timer);
}

function copyCode(code: string, button: HTMLButtonElement, restoreFocus: () => void) {
  const copied = copyPlainText(code);
  restoreFocus();
  if (copied) {
    markCopied(button, true);
    return;
  }
  void navigator.clipboard.writeText(code).then(
    () => markCopied(button, true),
    () => markCopied(button, false),
  );
}

function copyPlainText(code: string) {
  const area = document.createElement("textarea");
  area.value = code;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  const previous = document.activeElement;
  document.body.append(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return copied;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly block: boolean,
  ) {
    super();
  }

  eq(other: TableWidget) {
    return other.source === this.source && other.block === this.block;
  }

  toDOM() {
    const table = document.createElement("table");
    table.className = this.block ? "cm-table cm-block-edit" : "cm-table";
    tableRows(this.source).forEach((row, index) => {
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
    return this.block ? blockFrame(table) : table;
  }

  ignoreEvent() {
    return false;
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

const setFocused = StateEffect.define<boolean>();

const editorFocused = StateField.define<boolean>({
  create: () => false,
  update(focused, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocused)) return effect.value;
    }
    return focused;
  },
});

const resting = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    if (tr.effects.some((effect) => effect.is(showRendered))) return true;
    if (tr.docChanged || tr.selection) return false;
    return value;
  },
});

const setPointerDown = StateEffect.define<boolean>();

/** True while the main mouse button is held down in the editor. */
const pointerDown = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPointerDown)) return effect.value;
    }
    return value;
  },
});

/**
 * True while editing from the keyboard. A block on lines of its own only opens as source then,
 * for example while typing a new `$$` block; a click edits it in the pop-up instead.
 */
const keyboardEditing = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (tr.effects.some((effect) => effect.is(showRendered) || effect.is(openBlockEditor))) return false;
    if (tr.isUserEvent("select.pointer")) return false;
    if (tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("select")) return true;
    return value;
  },
});

/**
 * Blocks swap between their rendered and source forms as the cursor enters and leaves them,
 * which changes their height. Doing that on mouse-down moved the text under the pointer
 * before the click finished, so the cursor landed on a lower line. The swap now waits for
 * mouse-up, and the clicked line is scrolled back under the pointer afterwards.
 */
const pointerTracker = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.release = this.release.bind(this);
    }

    press() {
      window.addEventListener("mouseup", this.release);
      window.addEventListener("blur", this.release);
      this.view.dispatch({ effects: setPointerDown.of(true) });
    }

    release() {
      window.removeEventListener("mouseup", this.release);
      window.removeEventListener("blur", this.release);
      // Let the editor finish its own mouse-up handling (the final selection) first.
      window.setTimeout(() => {
        const view = this.view;
        if (!view.state.field(pointerDown, false)) return;
        const head = view.state.selection.main.head;
        const before = view.coordsAtPos(head)?.top ?? null;
        view.dispatch({ effects: setPointerDown.of(false) });
        if (before === null) return;
        view.requestMeasure({
          read: () => view.coordsAtPos(head)?.top ?? null,
          write: (after) => {
            if (after !== null && Math.abs(after - before) > 1) view.scrollDOM.scrollTop += after - before;
          },
        });
      }, 0);
    }

    destroy() {
      window.removeEventListener("mouseup", this.release);
      window.removeEventListener("blur", this.release);
    }
  },
  {
    eventHandlers: {
      mousedown(event) {
        if (event.button === 0) this.press();
        return false;
      },
    },
  },
);

type MathTooltip = Tooltip & { tex: string };

/** A live KaTeX rendering of the maths the cursor is typing into. */
const mathPreview = StateField.define<MathTooltip | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && tr.effects.length === 0) return value;
    return mathPreviewFor(tr.state, value);
  },
  provide: (field) => showTooltip.from(field),
});

function mathPreviewFor(state: EditorState, previous: MathTooltip | null): MathTooltip | null {
  if (!state.field(editorFocused) || state.field(resting) || state.readOnly) return null;
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const text = state.doc.toString();
  const math = mathAround(text, selection.head);
  if (!math) return null;
  const tex = text.slice(math.from, math.to).trim();
  if (!tex) return null;
  const pos = math.from - (math.display ? 2 : 1);
  if (previous && previous.pos === pos && previous.tex === tex) return previous;
  const display = math.display;
  return {
    pos,
    tex,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-math-preview";
      dom.innerHTML = renderMath(tex, display);
      return { dom };
    },
  };
}

export function livePreview(handlers: LivePreviewHandlers) {
  const decorations = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, handlers, false, false);
    },
    update(value, tr) {
      const refreshed = tr.effects.some((effect) => effect.is(refreshPreview));
      const focusChanged = tr.effects.some((effect) => effect.is(setFocused));
      const loaded = tr.effects.some((effect) => effect.is(showRendered));
      const released = tr.effects.some((effect) => effect.is(setPointerDown) && !effect.value);
      const modeChanged = tr.startState.field(keyboardEditing) !== tr.state.field(keyboardEditing);
      // Hold the layout still while a click or drag is in progress.
      if (tr.state.field(pointerDown) && !tr.docChanged && !refreshed && !loaded) return value;
      if (!tr.docChanged && !tr.selection && !refreshed && !focusChanged && !loaded && !released && !modeChanged) {
        return value;
      }
      const showSource = tr.state.field(editorFocused) && !tr.state.field(resting) && !tr.state.readOnly;
      const openBlocks = showSource && (tr.state.field(keyboardEditing) || !handlers.onEditBlock);
      return buildDecorations(tr.state, handlers, showSource, openBlocks);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const blockClicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target;
      if (!handlers.onEditBlock || event.button !== 0 || view.state.readOnly) return false;
      if (!(target instanceof Element) || target.closest(".cm-code-copy")) return false;
      const box = target.closest(".cm-block-edit");
      if (!box || !view.contentDOM.contains(box)) return false;
      const block = blockAt(view.state, view.posAtDOM(box.closest(".cm-block-frame") ?? box));
      if (!block) return false;
      event.preventDefault();
      handlers.onEditBlock(block);
      return true;
    },
  });

  const blockOpener = EditorView.updateListener.of((update) => {
    if (!handlers.onEditBlock) return;
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (!effect.is(openBlockEditor)) continue;
        const block = blockAt(update.state, effect.value.pos);
        if (block) handlers.onEditBlock({ ...block, isNew: effect.value.isNew });
      }
    }
  });

  return [
    editorFocused,
    resting,
    keyboardEditing,
    pointerDown,
    blockClicks,
    pointerTracker,
    blockOpener,
    EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
    decorations,
    mathPreview,
  ];
}

function buildDecorations(
  state: EditorState,
  handlers: LivePreviewHandlers,
  showSource: boolean,
  openBlocks: boolean,
): DecorationSet {
  const spans: Span[] = [];
  const blocked: Range[] = [];
  // Blocks on lines of their own open only while editing from the keyboard; others as before.
  const blockActive = (from: number, to: number) =>
    (lineAligned(state, from, to) ? openBlocks : showSource) && coversSelection(state, from, to);

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      const active = showSource && coversSelection(state, from, to);

      if (name === "FencedCode") {
        blocked.push({ from, to });
        if (!blockActive(from, to)) {
          const { language, code } = parseFence(state.doc.sliceString(from, to));
          const block = lineAligned(state, from, to);
          spans.push({
            from,
            to,
            replace: true,
            deco: Decoration.replace({
              widget: new CodeWidget(language, code, block),
              block,
            }),
          });
        }
        return false;
      }

      if (name === "Table") {
        blocked.push({ from, to });
        if (!blockActive(from, to)) {
          const block = lineAligned(state, from, to);
          spans.push({
            from,
            to,
            replace: true,
            deco: Decoration.replace({
              widget: new TableWidget(state.doc.sliceString(from, to), block),
              block,
            }),
          });
        }
        return false;
      }

      if (name === "ListMark" || name === "QuoteMark") {
        spans.push({ from, to, replace: false, deco: marker });
        if (name === "QuoteMark") {
          const line = state.doc.lineAt(from);
          spans.push({ from: line.from, to: line.from, replace: false, deco: quoteLine });
        }
        return false;
      }

      if (name === "TaskMarker") {
        const done = /[xX]/.test(state.doc.sliceString(from, to));
        spans.push({
          from,
          to,
          replace: false,
          deco: Decoration.mark({ class: done ? "cm-task cm-task-done" : "cm-task" }),
        });
        return false;
      }

      if (name === "LinkMark" || name === "URL") {
        spans.push({ from, to, replace: false, deco: marker });
        return false;
      }

      if (name === "Autolink") {
        spans.push({ from, to, replace: false, deco: linkStyle });
        return false;
      }

      if (name === "Link") {
        // `[words]{.red}` is a coloured span, styled below, not a link.
        if (state.doc.sliceString(to, to + 1) === "{") return false;
        const raw = state.doc.sliceString(from, to);
        const label = /^\[([^\]\n]*)\]/.exec(raw);
        if (label && label[1].length > 0) {
          const labelFrom = from + 1;
          const labelTo = labelFrom + label[1].length;
          spans.push({ from: labelFrom, to: labelTo, replace: false, deco: linkStyle });
        }
      }

      if (name === "InlineCode") {
        blocked.push({ from, to });
        const ticks = /^`+/.exec(state.doc.sliceString(from, to))?.[0].length ?? 1;
        if (to - from > ticks * 2) {
          spans.push({ from, to: from + ticks, replace: false, deco: marker });
          spans.push({ from: to - ticks, to, replace: false, deco: marker });
          spans.push({
            from: from + ticks,
            to: to - ticks,
            replace: false,
            deco: inlineCodeStyle,
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
              replace: true,
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
        spans.push({ from: line.from, to: markEnd, replace: true, deco: hide });
        if (markEnd < line.to) {
          spans.push({
            from: markEnd,
            to: line.to,
            replace: false,
            deco: Decoration.mark({ class: `cm-h cm-h${level}` }),
          });
        }
        return false;
      }

      if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
        const raw = state.doc.sliceString(from, to);
        const style = inlineStyle(name, raw);
        // Keep the characters. Markers stay visible so the cursor can edit them.
        if (!style || raw.length < style.width * 2) return undefined;
        const innerFrom = from + style.width;
        const innerTo = to - style.width;
        spans.push({ from, to: innerFrom, replace: false, deco: marker });
        spans.push({ from: innerTo, to, replace: false, deco: marker });
        if (innerFrom < innerTo) {
          spans.push({
            from: innerFrom,
            to: innerTo,
            replace: false,
            deco: Decoration.mark({ class: style.className }),
          });
        }
      }

      return undefined;
    },
  });

  const text = state.doc.toString();
  for (const match of text.matchAll(DISPLAY_MATH)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || blockActive(from, to)) continue;
    blocked.push({ from, to });
    const block = lineAligned(state, from, to);
    spans.push({
      from,
      to,
      replace: true,
      deco: Decoration.replace({
        widget: new HtmlWidget(
          `math-block:${block}:${match[1]}`,
          renderMath(match[1] ?? "", true),
          block ? "cm-math cm-math-block cm-block-edit" : "cm-math cm-math-block",
          block,
        ),
        block,
      }),
    });
  }

  for (const match of text.matchAll(/(?<!\$)\$(?!\$)([^\n$]+?)\$(?!\$)/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || (showSource && coversSelection(state, from, to))) continue;
    blocked.push({ from, to });
    spans.push({
      from,
      to,
      replace: true,
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
    if (!title || overlaps(blocked, from, to) || (showSource && coversSelection(state, from, to))) continue;
    spans.push({ from, to: from + 2, replace: false, deco: marker });
    spans.push({ from: to - 2, to, replace: false, deco: marker });
    // `[[Title|alias]]` and `[[Title#section]]` open "Title".
    const target = title.split("|")[0].split("#")[0].trim();
    spans.push({
      from: from + 2,
      to: to - 2,
      replace: false,
      deco: Decoration.mark({ class: "cm-wiki", attributes: { "data-title": target || title } }),
    });
  }

  // Not added to `blocked`, so highlights and larger words still work inside a colour.
  for (const match of text.matchAll(colorSpanPattern())) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to)) continue;
    const innerTo = from + 1 + (match[1] ?? "").length;
    const editing = selectionTouches(state, from, to);
    const edge = editing ? marker : hide;
    spans.push({ from, to: from + 1, replace: !editing, deco: edge });
    spans.push({ from: innerTo, to, replace: !editing, deco: edge });
    spans.push({
      from: from + 1,
      to: innerTo,
      replace: false,
      deco: Decoration.mark({
        class: "cm-color",
        attributes: { style: `color: ${colorOf(match[2], match[3])}` },
      }),
    });
  }

  for (const match of text.matchAll(/==([^=\n]+)==/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || from + 4 >= to) continue;
    blocked.push({ from, to });
    // The word stays. The == marks only appear while the cursor is inside them.
    markPair(spans, state, from, to, highlightStyle);
  }

  for (const match of text.matchAll(/\+\+([^\n+]+)\+\+/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (overlaps(blocked, from, to) || from + 4 >= to) continue;
    blocked.push({ from, to });
    markPair(spans, state, from, to, Decoration.mark({ class: "cm-size-up" }));
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  // Replacements cannot overlap. Marks can: a later overlapping mark goes on the next layer.
  let replaceEnd = -1;
  for (const span of spans) {
    if (span.from > span.to) continue;
    if (span.from === span.to) {
      builder.add(span.from, span.from, span.deco);
      continue;
    }
    if (span.replace) {
      if (span.from < replaceEnd) continue;
      replaceEnd = span.to;
    }
    builder.add(span.from, span.to, span.deco);
  }
  return builder.finish();
}

function selectionTouches(state: EditorState, from: number, to: number) {
  const selection = state.selection.main;
  return selection.from < to && selection.to > from;
}

/** Style the inside, and hide a two-character wrapper until the cursor enters it. */
function markPair(spans: Span[], state: EditorState, from: number, to: number, inner: Decoration) {
  const editing = selectionTouches(state, from, to);
  const edge = editing ? marker : hide;
  spans.push({ from, to: from + 2, replace: !editing, deco: edge });
  spans.push({ from: to - 2, to, replace: !editing, deco: edge });
  spans.push({ from: from + 2, to: to - 2, replace: false, deco: inner });
}

const marker = Decoration.mark({ class: "cm-md-mark" });
const quoteLine = Decoration.line({ class: "cm-quote-line" });
const linkStyle = Decoration.mark({ class: "cm-link" });
const inlineCodeStyle = Decoration.mark({ class: "cm-inline-code" });
const highlightStyle = Decoration.mark({ class: "cm-highlight" });

function inlineStyle(name: string, raw: string) {
  if (name === "Strikethrough" && raw.startsWith("~~") && raw.endsWith("~~")) {
    return { width: 2, className: "cm-strike" };
  }
  if (
    name === "StrongEmphasis" &&
    ((raw.startsWith("**") && raw.endsWith("**")) || (raw.startsWith("__") && raw.endsWith("__")))
  ) {
    return { width: 2, className: "cm-strong" };
  }
  // A single marker, even when the node is `***both***` around a bold span.
  if (
    name === "Emphasis" &&
    ((raw.startsWith("*") && raw.endsWith("*")) || (raw.startsWith("_") && raw.endsWith("_")))
  ) {
    return { width: 1, className: "cm-em" };
  }
  return null;
}
