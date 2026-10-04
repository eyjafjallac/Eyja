export const snippets = [
  {
    id: "table",
    label: "Table",
    text: "| Column | Column |\n| --- | --- |\n|  |  |\n",
    cursor: 36,
  },
  {
    id: "matrix",
    label: "Matrix",
    text: "$$\n\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}\n$$\n",
    cursor: 18,
  },
  {
    id: "code",
    label: "Code",
    text: "```\n\n```\n",
    cursor: 4,
  },
] as const;
