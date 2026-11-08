import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateEffect } from "@codemirror/state";

export type BlockKind = "math" | "code" | "table";

/** A maths block, code block or table that is edited in the pop-up instead of in place. */
export type EditableBlock = {
  kind: BlockKind;
  from: number;
  to: number;
  /** The Markdown as it was when editing started, to notice changes made meanwhile. */
  raw: string;
  /** What the pop-up edits: the TeX, the code, or the table Markdown. */
  text: string;
  language: string;
  /** Inserted just now from a slash command; cancelling removes it again. */
  isNew: boolean;
};

/** Opens the block editor for the block at `pos` once the transaction is applied. */
export const openBlockEditor = StateEffect.define<{ pos: number; isNew: boolean }>({
  map: (value, changes) => ({ ...value, pos: changes.mapPos(value.pos) }),
});

export const DISPLAY_MATH = /\$\$([\s\S]+?)\$\$/g;

export function lineAligned(state: EditorState, from: number, to: number) {
  if (from >= to) return false;
  const start = state.doc.lineAt(from);
  const end = state.doc.lineAt(to - 1);
  return from === start.from && to === end.to;
}

const FENCE = /^(`{3,}|~{3,})/;

export function parseFence(source: string) {
  const lines = source.replace(/\n$/, "").split("\n");
  const opening = FENCE.exec(lines[0] ?? "")?.[1] ?? "```";
  const info = (lines[0] ?? "").slice(opening.length).trim();
  const language = info.split(/\s+/)[0] ?? "";
  const last = lines.length > 1 ? lines[lines.length - 1] : undefined;
  const closing = last !== undefined && /^(`{3,}|~{3,})\s*$/.test(last) ? 1 : 0;
  return { language, code: lines.slice(1, lines.length - closing).join("\n") };
}

/** The editable block at `pos`, if it sits on lines of its own. */
export function blockAt(state: EditorState, pos: number): EditableBlock | null {
  type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
  for (let node: Node | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== "FencedCode" && node.name !== "Table") continue;
    if (!lineAligned(state, node.from, node.to)) return null;
    const raw = state.sliceDoc(node.from, node.to);
    if (node.name === "Table") {
      return { kind: "table", from: node.from, to: node.to, raw, text: raw, language: "", isNew: false };
    }
    const { language, code } = parseFence(raw);
    return { kind: "code", from: node.from, to: node.to, raw, text: code, language, isNew: false };
  }
  const text = state.doc.toString();
  for (const match of text.matchAll(DISPLAY_MATH)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (from > pos) break;
    if (pos > to) continue;
    if (!lineAligned(state, from, to)) return null;
    const tex = (match[1] ?? "").replace(/^\n/, "").replace(/\n$/, "");
    return { kind: "math", from, to, raw: match[0], text: tex, language: "", isNew: false };
  }
  return null;
}

/** The Markdown for a block after editing. */
export function blockMarkdown(kind: BlockKind, text: string, language: string) {
  if (kind === "math") return `$$\n${text.trim()}\n$$`;
  if (kind === "table") return text.trim();
  // A longer fence keeps code that itself contains ``` intact.
  const longest = Math.max(0, ...text.split("\n").map((line) => /^\s*(`+)/.exec(line)?.[1].length ?? 0));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language.trim()}\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/** Table rows without the `| --- |` divider; the first row is the header. */
export function tableRows(source: string) {
  return source
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
}

function fenceAt(text: string, index: number) {
  return text.startsWith("```", index) && (index === 0 || text[index - 1] === "\n");
}

/**
 * The maths the position is typed into, if any: `$…$` on one line, or `$$…$$`.
 * `from`/`to` bound the TeX without its dollar signs; an unclosed span runs to the line end
 * (inline) or the next blank line (display).
 */
export function mathAround(text: string, pos: number): { from: number; to: number; display: boolean } | null {
  let fence = false;
  let inlineCode = false;
  let math: "none" | "inline" | "display" = "none";
  let start = 0;
  for (let i = 0; i < pos; i++) {
    if (!inlineCode && math === "none" && fenceAt(text, i)) {
      fence = !fence;
      i += 2;
      continue;
    }
    if (fence) continue;
    if (math === "none" && text[i] === "`") {
      inlineCode = !inlineCode;
      continue;
    }
    if (inlineCode) {
      if (text[i] === "\n") inlineCode = false;
      continue;
    }
    if (text[i] === "\\" && i + 1 < pos) {
      i += 1;
      continue;
    }
    if (text[i] === "\n" && math === "inline") math = "none";
    if (text.startsWith("$$", i)) {
      if (math === "none") {
        math = "display";
        start = i + 2;
      } else if (math === "display") {
        math = "none";
      }
      i += 1;
      continue;
    }
    if (text[i] === "$" && math !== "display") {
      if (math === "none") {
        math = "inline";
        start = i + 1;
      } else {
        math = "none";
      }
    }
  }
  if (math === "none") return null;
  if (math === "inline") {
    const lineEnd = text.indexOf("\n", pos);
    const limit = lineEnd < 0 ? text.length : lineEnd;
    let end = pos;
    while (end < limit && !(text[end] === "$" && text[end - 1] !== "\\")) end += 1;
    return { from: start, to: end, display: false };
  }
  const close = text.indexOf("$$", pos);
  const blank = text.indexOf("\n\n", pos);
  const ends = [close, blank].filter((index) => index >= 0);
  return { from: start, to: ends.length > 0 ? Math.min(...ends) : text.length, display: true };
}
