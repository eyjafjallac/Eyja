/**
 * Coloured words are stored as Pandoc spans: `[words]{.red}` for a palette colour,
 * `[words]{color="#3b82f6"}` for any other one.
 */
export const TEXT_COLORS = [
  { name: "amber", label: "Amber", value: "#f59e0b" },
  { name: "red", label: "Red", value: "#ef4444" },
  { name: "green", label: "Green", value: "#10b981" },
  { name: "blue", label: "Blue", value: "#3b82f6" },
  { name: "violet", label: "Violet", value: "#a855f7" },
] as const;

/** A palette name such as "red", or a "#rrggbb" colour. */
export type TextColor = string;

const NAMES = TEXT_COLORS.map((color) => color.name).join("|");

/** A fresh global pattern; group 1 is the text, group 2 a palette name, group 3 a hex colour. */
export function colorSpanPattern() {
  return new RegExp(`\\[([^\\[\\]\\n]+)\\]\\{(?:\\.(${NAMES})|color="?(#[0-9a-fA-F]{6})"?)\\}`, "g");
}

export function colorAttribute(color: TextColor) {
  return color.startsWith("#") ? `color="${color.toLowerCase()}"` : `.${color}`;
}

/** The CSS colour of a matched span. */
export function colorOf(name: string | undefined, hex: string | undefined) {
  if (hex) return hex;
  return TEXT_COLORS.find((color) => color.name === name)?.value ?? "inherit";
}
