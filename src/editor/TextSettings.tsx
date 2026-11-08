import { useEffect, useState } from "react";
import { themeValue } from "../theme";
import { FontSizeControl } from "./FontSizeControl";
import {
  DEFAULT_HIGHLIGHT,
  EDITOR_FONTS,
  EDITOR_LINE_HEIGHTS,
  type EditorColors,
  type EditorFont,
  type EditorLineHeight,
  readEditorType,
  watchEditorType,
  writeEditorColor,
  writeEditorFont,
  writeEditorLineHeight,
} from "./fontSize";

const FONT_LABELS: Record<EditorFont, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

const LEADING_LABELS: Record<EditorLineHeight, string> = {
  1.4: "Tight",
  1.6: "Normal",
  1.8: "Relaxed",
};

function themeColor(kind: "link" | "quote") {
  return themeValue(kind === "link" ? "--accent" : "--border-strong");
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="setting-color">
      <span>{label}</span>
      <input
        type="color"
        className="color-input"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Segments<T extends string | number>({
  label,
  options,
  value,
  format,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  format: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <div className="seg-control" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? "seg-btn active" : "seg-btn"}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}

export function TextSettings() {
  const [type, setType] = useState(readEditorType);

  useEffect(() => watchEditorType(setType), []);

  return (
    <>
      <div className="setting-group">
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-title">Font</span>
            <span className="setting-desc">Typeface for notes and memos</span>
          </div>
          <Segments
            label="Font"
            options={EDITOR_FONTS}
            value={type.font}
            format={(font) => FONT_LABELS[font]}
            onChange={writeEditorFont}
          />
        </div>
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-title">Line spacing</span>
            <span className="setting-desc">Vertical rhythm of paragraphs and lists</span>
          </div>
          <Segments
            label="Line spacing"
            options={EDITOR_LINE_HEIGHTS}
            value={type.lineHeight}
            format={(lineHeight) => `${LEADING_LABELS[lineHeight]} (${lineHeight})`}
            onChange={writeEditorLineHeight}
          />
        </div>
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-title">Text size</span>
            <span className="setting-desc">Shared by every note and memo window</span>
          </div>
          <FontSizeControl />
        </div>
      </div>
      <div className="setting-group">
        <div className="setting-item">
          <div className="setting-info">
            <span className="setting-title">Markdown colors</span>
            <span className="setting-desc">
              Highlight is the <code>==marked==</code> text. Link covers <code>[[notes]]</code> and
              web links.
            </span>
          </div>
          <div className="setting-controls">
            <ColorField
              label="Highlight"
              value={type.colors.highlight || DEFAULT_HIGHLIGHT}
              onChange={(color) => writeEditorColor("highlight", color)}
            />
            <ColorField
              label="Link"
              value={type.colors.link || themeColor("link")}
              onChange={(color) => writeEditorColor("link", color)}
            />
            <ColorField
              label="Quote"
              value={type.colors.quote || themeColor("quote")}
              onChange={(color) => writeEditorColor("quote", color)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                (
                  ["highlight", "link", "quote"] as const satisfies readonly (keyof EditorColors)[]
                ).forEach((which) => writeEditorColor(which, ""));
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
