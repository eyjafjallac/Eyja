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
 * every window; "enlarge" acts on the selection of the editor it sits in.
 */
export function TextBubble({
  shown = true,
  compact = false,
  onEnlarge,
}: {
  shown?: boolean;
  /** Smaller bubble without typeface and line spacing, for memo windows. */
  compact?: boolean;
  onEnlarge: () => void;
}) {
  const [type, setType] = useState(readEditorType);

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
