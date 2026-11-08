import { followSystemTheme } from "../theme";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyEditorType, readEditorType } from "./fontSize";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import { TextBubble } from "./TextBubble";

followSystemTheme();
applyEditorType(readEditorType());

const SAMPLE = `# Heading

#### Smaller heading

A sentence with *italic*, **bold**, ~~strike~~, and ==highlight==.

++larger words++ stay in the text, and [coloured words]{.red} keep their [own colour]{color="#0ea5e9"}.

- a list item
- [ ] an open task
- [x] a finished task

> A quoted line

See [a link](https://example.com), [[Other note]] and \`inline code\`.

$$
\\mathcal{L}_{\\text{sym}} = I - D^{-1/2} A D^{-1/2}
$$

***bold italic*** stays editable text.
`;

function Preview() {
  const [body, setBody] = useState(SAMPLE);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  return (
    <div className="preview">
      <MarkdownEditor
        ref={editorRef}
        value={body}
        titles={["Other note"]}
        placeholder="Write, or type /"
        onChange={setBody}
        onOpenTitle={() => {}}
      />
      <TextBubble
        onEnlarge={() => editorRef.current?.enlargeSelection()}
        onColor={(color, refocus) => editorRef.current?.colorSelection(color, refocus)}
      />
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
  body { background: var(--bg-surface); }
  .preview { --cm-padding: 28px 42px 96px; position: relative; display: flex; flex-direction: column; height: 100vh; }
`;
document.head.append(style);

createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
