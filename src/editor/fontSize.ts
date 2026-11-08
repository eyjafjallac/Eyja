export const EDITOR_FONT_MIN = 13;
export const EDITOR_FONT_MAX = 24;
export const EDITOR_FONT_DEFAULT = 16;

export const EDITOR_FONTS = ["sans", "serif", "mono"] as const;
export type EditorFont = (typeof EDITOR_FONTS)[number];

export const EDITOR_LINE_HEIGHTS = [1.4, 1.6, 1.8] as const;
export type EditorLineHeight = (typeof EDITOR_LINE_HEIGHTS)[number];

export type EditorColors = {
  /** Empty means the theme default. */
  highlight: string;
  link: string;
  quote: string;
};

export type EditorType = {
  fontSize: number;
  font: EditorFont;
  lineHeight: EditorLineHeight;
  colors: EditorColors;
};

const SIZE_KEY = "eyja.editorFontSize";
const FONT_KEY = "eyja.editorFont";
const LEADING_KEY = "eyja.editorLineHeight";
const HIGHLIGHT_KEY = "eyja.editorHighlight";
const LINK_KEY = "eyja.editorLink";
const QUOTE_KEY = "eyja.editorQuote";
const EVENT = "eyja-editor-type";

export const DEFAULT_HIGHLIGHT = "#fde68a";

const FAMILIES: Record<EditorFont, string> = {
  sans: "var(--font-sans)",
  // Body text needs a bold weight, which the display serif used for titles does not have.
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  mono: "var(--font-mono)",
};

export function readEditorFontSize() {
  const raw = Number(localStorage.getItem(SIZE_KEY));
  if (!Number.isInteger(raw)) return EDITOR_FONT_DEFAULT;
  return Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, raw));
}

function readColor(key: string) {
  const value = localStorage.getItem(key) ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "";
}

export function readEditorType(): EditorType {
  const font = localStorage.getItem(FONT_KEY);
  const leading = Number(localStorage.getItem(LEADING_KEY));
  return {
    fontSize: readEditorFontSize(),
    font: EDITOR_FONTS.includes(font as EditorFont) ? (font as EditorFont) : "sans",
    lineHeight: EDITOR_LINE_HEIGHTS.includes(leading as EditorLineHeight)
      ? (leading as EditorLineHeight)
      : 1.6,
    colors: {
      highlight: readColor(HIGHLIGHT_KEY),
      link: readColor(LINK_KEY),
      quote: readColor(QUOTE_KEY),
    },
  };
}

/** Dark text on a light swatch, light text on a dark one. */
export function inkOn(color: string) {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const lightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return lightness > 150 ? "#1c1c1c" : "#f4f4f5";
}

function setOrClear(root: CSSStyleDeclaration, name: string, value: string) {
  if (value) root.setProperty(name, value);
  else root.removeProperty(name);
}

export function applyEditorType(type: EditorType = readEditorType()) {
  const root = document.documentElement.style;
  root.setProperty("--editor-font-size", `${type.fontSize}px`);
  root.setProperty("--editor-font-family", FAMILIES[type.font]);
  root.setProperty("--editor-line-height", String(type.lineHeight));
  const highlight = type.colors.highlight || DEFAULT_HIGHLIGHT;
  root.setProperty("--editor-highlight", highlight);
  root.setProperty("--editor-highlight-text", inkOn(highlight));
  setOrClear(root, "--editor-link", type.colors.link);
  setOrClear(root, "--editor-quote", type.colors.quote);
}

export function applyEditorFontSize(size: number) {
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
}

function publish() {
  applyEditorType();
  window.dispatchEvent(new Event(EVENT));
}

export function writeEditorFontSize(size: number) {
  const next = Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, size));
  localStorage.setItem(SIZE_KEY, String(next));
  publish();
  return next;
}

export function writeEditorFont(font: EditorFont) {
  localStorage.setItem(FONT_KEY, font);
  publish();
}

export function writeEditorLineHeight(lineHeight: EditorLineHeight) {
  localStorage.setItem(LEADING_KEY, String(lineHeight));
  publish();
}

export function writeEditorColor(which: keyof EditorColors, color: string) {
  const key = which === "highlight" ? HIGHLIGHT_KEY : which === "link" ? LINK_KEY : QUOTE_KEY;
  if (!color) localStorage.removeItem(key);
  else if (/^#[0-9a-fA-F]{6}$/.test(color)) localStorage.setItem(key, color.toLowerCase());
  publish();
}

export function watchEditorType(onChange: (type: EditorType) => void) {
  const emit = () => onChange(readEditorType());
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== SIZE_KEY &&
      event.key !== FONT_KEY &&
      event.key !== LEADING_KEY &&
      event.key !== HIGHLIGHT_KEY &&
      event.key !== LINK_KEY &&
      event.key !== QUOTE_KEY
    ) {
      return;
    }
    applyEditorType();
    emit();
  };
  window.addEventListener(EVENT, emit);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, emit);
    window.removeEventListener("storage", onStorage);
  };
}

/** The other window hears `storage`. This window updates itself in the write functions. */
export function watchEditorFontSize(onChange: (size: number) => void) {
  return watchEditorType((type) => onChange(type.fontSize));
}
