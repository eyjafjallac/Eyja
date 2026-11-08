import {
  pickedCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { mathCompletions } from "./math";
import { slashCompletions } from "./snippets";

type Region = "text" | "code" | "math";

function fenceAt(text: string, index: number) {
  return text.startsWith("```", index) && (index === 0 || text[index - 1] === "\n");
}

// Walk the document up to the cursor so `$` and fences stay paired.
function regionAt(text: string, pos: number): Region {
  let fence = false;
  let inlineCode = false;
  let math: "none" | "inline" | "display" = "none";

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
    if (inlineCode) continue;
    if (text[i] === "\\" && i + 1 < pos) {
      i += 1;
      continue;
    }
    if (text.startsWith("$$", i)) {
      math = math === "display" ? "none" : math === "none" ? "display" : math;
      i += 1;
      continue;
    }
    if (text[i] === "$" && math !== "display") {
      math = math === "inline" ? "none" : "inline";
    }
  }

  if (fence || inlineCode) return "code";
  if (math !== "none") return "math";
  return "text";
}

export const slashCompletion: CompletionSource = (context): CompletionResult | null => {
  if (context.state.readOnly) return null;
  const text = context.state.doc.toString();
  if (regionAt(text, context.pos) !== "text") return null;
  const match = context.matchBefore(/(?:^|\s)\/[A-Za-z]*$/);
  if (!match) return null;
  const from = match.from + match.text.lastIndexOf("/");
  return {
    from,
    options: slashCompletions,
    validFor: /^\/[A-Za-z]*$/,
  };
};

// Same commands as the `\` list, matched on the name typed after `$$`.
const displayMathCompletions: readonly Completion[] = mathCompletions.map((option) => {
  const command = option.label;
  const apply = option.apply ?? command;
  return {
    ...option,
    label: command.startsWith("\\") ? command.slice(1) : command,
    displayLabel: command,
    apply: (view, completion, from, to) => {
      if (typeof apply === "string") {
        view.dispatch({
          changes: { from, to, insert: `${apply}\n$$` },
          selection: EditorSelection.cursor(from + apply.length),
          annotations: pickedCompletion.of(completion),
        });
        return;
      }
      const before = view.state.doc.length;
      apply(view, completion, from, to);
      const end = from + view.state.doc.length - before + (to - from);
      view.dispatch({ changes: { from: end, insert: "\n$$" } });
    },
  };
});

export const mathCompletion: CompletionSource = (context): CompletionResult | null => {
  if (context.state.readOnly) return null;
  const text = context.state.doc.toString();
  if (regionAt(text, context.pos) !== "math") return null;
  const match = context.matchBefore(/\\[A-Za-z]*$/);
  if (match) {
    // `\\` is a row break inside a matrix, not the start of a command.
    if (context.state.sliceDoc(match.from - 1, match.from) === "\\") return null;
    return {
      from: match.from,
      options: mathCompletions,
      validFor: /^\\[A-Za-z]*$/,
    };
  }
  // Typing `$$` opens the same list. Letters after it narrow the names.
  const display = context.matchBefore(/\$\$[A-Za-z]*$/);
  if (display) {
    return {
      from: display.from + 2,
      options: displayMathCompletions,
      validFor: /^[A-Za-z]*$/,
    };
  }
  if (!context.explicit) return null;
  return { from: context.pos, options: mathCompletions, validFor: /^$/ };
};
