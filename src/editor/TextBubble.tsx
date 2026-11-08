import { type MouseEvent, useEffect, useState } from "react";
import { Icon } from "../memo/Icon";
import {
  EDITOR_FONT_DEFAULT,
  EDITOR_FONT_MAX,
  EDITOR_FONT_MIN,
  EDITOR_FONTS,
  EDITOR_LINE_HEIGHTS,
  type EditorFont,
  readEditorType,
  watchEditorType,
  writeEditorFont,
  writeEditorFontSize,
  writeEditorLineHeight,
} from "./fontSize";
import { TEXT_COLORS, type TextColor } from "./textColors";

const FONT_LABELS: Record<EditorFont, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

function next<T>(list: readonly T[], current: T) {
  return list[(list.indexOf(current) + 1) % list.length];
}

// Keeps focus and the selection in the editor while a bubble button is pressed.
function keepFocus(event: MouseEvent) {
  event.preventDefault();
}

/**
 * Floating glass bubble with the text controls. Size, typeface and line spacing are shared by
 * every window; "enlarge" and the colours act on the selection of the editor it sits in.
 */
export function TextBubble({
  shown = true,
  compact = false,
  onEnlarge,
  onColor,
}: {
  shown?: boolean;
  /** Smaller bubble without typeface and line spacing, for memo windows. */
  compact?: boolean;
  onEnlarge: () => void;
  /** Colour the selected words; `null` goes back to the default colour. */
  onColor: (color: TextColor | null, refocus?: boolean) => void;
}) {
  const [type, setType] = useState(readEditorType);
  const [custom, setCustom] = useState("#3b82f6");

  useEffect(() => watchEditorType(setType), []);

  const size = type.fontSize;

  return (
    <div className={shown ? "glass-bubble-wrap shown" : "glass-bubble-wrap"}>
      <div
        className={compact ? "glass-bubble compact" : "glass-bubble"}
        role="toolbar"
        aria-label="Text"
        onMouseDown={keepFocus}
      >
        <button
          type="button"
          className="glass-btn"
          data-tip="Smaller text"
          data-tip-pos="top"
          disabled={size <= EDITOR_FONT_MIN}
          onClick={() => writeEditorFontSize(size - 1)}
        >
          A−
        </button>
        <button
          type="button"
          className="glass-readout"
          data-tip={`Text size · click to reset (${EDITOR_FONT_DEFAULT}px)`}
          data-tip-pos="top"
          onClick={() => writeEditorFontSize(EDITOR_FONT_DEFAULT)}
        >
          {size}px
        </button>
        <button
          type="button"
          className="glass-btn"
          data-tip="Larger text"
          data-tip-pos="top"
          disabled={size >= EDITOR_FONT_MAX}
          onClick={() => writeEditorFontSize(size + 1)}
        >
          A+
        </button>
        <div className="glass-divider" />
        <button
          type="button"
          className="glass-btn"
          data-tip="Select words, then make them one step larger"
          data-tip-pos="top"
          aria-label="Enlarge selected words"
          onClick={onEnlarge}
        >
          <Icon name="enlarge" size={14} />
        </button>
        <div className="glass-divider" />
        <div className="color-swatches-inline" role="group" aria-label="Selected text color">
          <button
            type="button"
            className="text-color-dot default"
            data-tip="Default text color"
            data-tip-pos="top"
            aria-label="Default text color"
            onClick={() => onColor(null)}
          />
          {TEXT_COLORS.map((color) => (
            <button
              key={color.name}
              type="button"
              className="text-color-dot"
              style={{ background: color.value }}
              data-tip={`${color.label} text`}
              data-tip-pos="top"
              aria-label={`${color.label} text`}
              onClick={() => onColor(color.name)}
            />
          ))}
          <input
            type="color"
            className="custom-color-input"
            value={custom}
            data-tip="Custom text color"
            data-tip-pos="top"
            aria-label="Custom text color"
            // Let the native picker open; the toolbar otherwise cancels the press.
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              setCustom(event.target.value);
              onColor(event.target.value, false);
            }}
          />
        </div>
        {compact ? null : (
          <>
            <div className="glass-divider" />
            <button
              type="button"
              className="glass-btn"
              data-tip="Typeface (Sans / Serif / Mono)"
              data-tip-pos="top"
              onClick={() => writeEditorFont(next(EDITOR_FONTS, type.font))}
            >
              {FONT_LABELS[type.font]}
            </button>
            <button
              type="button"
              className="glass-btn"
              data-tip={`Line spacing (${EDITOR_LINE_HEIGHTS.join(" / ")})`}
              data-tip-pos="top"
              aria-label="Line spacing"
              onClick={() => writeEditorLineHeight(next(EDITOR_LINE_HEIGHTS, type.lineHeight))}
            >
              ↕ {type.lineHeight}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
