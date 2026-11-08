import { snippetCompletion, type Completion } from "@codemirror/autocomplete";

// Inserted from a `/` prompt. Tab moves through the ${} fields.
export const slashCompletions: readonly Completion[] = [
  snippetCompletion("| ${1:Column} | ${2:Column} |\n| --- | --- |\n| ${3} | ${4} |\n", {
    label: "/table",
    detail: "Markdown table",
  }),
  snippetCompletion("$$\n${1}\n$$\n", {
    label: "/math",
    detail: "math block",
  }),
  snippetCompletion(
    "$$\n\\begin{bmatrix}\n${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}\n\\end{bmatrix}\n$$\n",
    {
      label: "/matrix",
      detail: "LaTeX matrix",
    },
  ),
  snippetCompletion("```${1}\n${2}\n```\n", {
    label: "/code",
    detail: "code block",
  }),
  snippetCompletion("++${1}++", {
    label: "/big",
    detail: "one step larger",
  }),
];
