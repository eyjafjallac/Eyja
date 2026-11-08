import { useEffect, useState } from "react";
import {
  EDITOR_FONT_MAX,
  EDITOR_FONT_MIN,
  readEditorFontSize,
  watchEditorFontSize,
  writeEditorFontSize,
} from "./fontSize";

export function FontSizeControl() {
  const [size, setSize] = useState(readEditorFontSize);

  useEffect(() => watchEditorFontSize(setSize), []);

  return (
    <div className="font-size" role="group" aria-label="Text size">
      <button
        type="button"
        className="btn icon-only"
        aria-label="Smaller text"
        disabled={size <= EDITOR_FONT_MIN}
        onClick={() => setSize(writeEditorFontSize(size - 1))}
      >
        A−
      </button>
      <span className="kbd">{size}px</span>
      <button
        type="button"
        className="btn icon-only"
        aria-label="Larger text"
        disabled={size >= EDITOR_FONT_MAX}
        onClick={() => setSize(writeEditorFontSize(size + 1))}
      >
        A+
      </button>
    </div>
  );
}
