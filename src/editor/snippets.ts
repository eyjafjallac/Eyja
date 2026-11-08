import { type Completion, pickedCompletion, snippetCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { openBlockEditor } from "./blocks";

/** Put a block on lines of its own at the prompt and open it in the block editor. */
function blockCompletion(label: string, detail: string, block: string): Completion {
  return {
    label,
    detail,
    apply(view: EditorView, completion: Completion, from: number, to: number) {
      const line = view.state.doc.lineAt(from);
      const lead = view.state.sliceDoc(line.from, from);
      const start = lead.trim() === "" ? line.from : from;
      const before = start === line.from ? "" : "\n";
      const after = to < line.to ? "\n" : "";
      const blockFrom = start + before.length;
      view.dispatch({
        changes: { from: start, to, insert: before + block + after },
        selection: { anchor: blockFrom + block.length },
        effects: openBlockEditor.of({ pos: blockFrom, isNew: true }),
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
    },
  };
}

// Inserted from a `/` prompt. Blocks open in the block editor; Tab moves through ${} fields.
export const slashCompletions: readonly Completion[] = [
  blockCompletion("/table", "Markdown table", "| Column | Column |\n| --- | --- |\n|  |  |"),
  blockCompletion("/math", "math block", "$$\n\n$$"),
  blockCompletion(
    "/matrix",
    "LaTeX matrix",
    "$$\n\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}\n$$",
  ),
  blockCompletion("/code", "code block", "```\n\n```"),
  snippetCompletion("++${1}++", {
    label: "/big",
    detail: "one step larger",
  }),
];
