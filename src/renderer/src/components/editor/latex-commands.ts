/**
 * Curated list of common LaTeX commands for the math-box autocomplete.
 *
 * `snippet` is what gets inserted (defaults to `name`). When a snippet contains
 * `{}`, the caret is placed inside the first pair so you can keep typing.
 * Kept as plain data so adding commands needs no code changes.
 */
export interface LatexCommand {
  /** The command including its backslash, e.g. "\\frac". */
  name: string
  /** Text inserted on accept; defaults to `name`. */
  snippet?: string
  /** Short hint (often the rendered symbol). */
  desc?: string
  /**
   * Caret index within `snippet` after insertion. Takes priority over the
   * default brace-seeking behaviour — used by multi-line/matrix templates.
   */
  caret?: number
}

/**
 * Build a 2×2 matrix-environment command with empty cells, placing the caret
 * in the first cell. Works for matrix/pmatrix/bmatrix/vmatrix.
 */
function matrixCmd(env: string, desc: string): LatexCommand {
  const open = `\\begin{${env}}`
  return {
    name: open,
    snippet: `${open}  &  \\\\  &  \\end{${env}}`,
    desc,
    // One space after the opening tag → start of the first cell.
    caret: open.length + 1
  }
}

export const LATEX_COMMANDS: LatexCommand[] = [
  // Structures
  { name: '\\frac', snippet: '\\frac{}{}', desc: 'fraction' },
  { name: '\\sqrt', snippet: '\\sqrt{}', desc: '√' },
  { name: '\\sqrt[n]', snippet: '\\sqrt[]{}', desc: 'nth root' },
  { name: '\\sum', snippet: '\\sum_{}^{}', desc: '∑' },
  { name: '\\prod', snippet: '\\prod_{}^{}', desc: '∏' },
  { name: '\\int', snippet: '\\int_{}^{}', desc: '∫' },
  { name: '\\lim', snippet: '\\lim_{}', desc: 'limit' },
  { name: '\\binom', snippet: '\\binom{}{}', desc: 'binomial' },
  { name: '\\vec', snippet: '\\vec{}', desc: 'vector' },
  { name: '\\hat', snippet: '\\hat{}', desc: 'hat' },
  { name: '\\bar', snippet: '\\bar{}', desc: 'bar' },
  { name: '\\overline', snippet: '\\overline{}', desc: 'overline' },
  { name: '\\text', snippet: '\\text{}', desc: 'text' },
  { name: '\\mathbb', snippet: '\\mathbb{}', desc: 'blackboard' },
  { name: '\\mathbf', snippet: '\\mathbf{}', desc: 'bold' },
  { name: '\\mathcal', snippet: '\\mathcal{}', desc: 'calligraphic' },
  // Matrices & environments (use & between columns, \\ between rows)
  matrixCmd('matrix', 'plain 2×2'),
  matrixCmd('pmatrix', '( ) matrix'),
  matrixCmd('bmatrix', '[ ] matrix'),
  matrixCmd('vmatrix', 'determinant'),
  matrixCmd('Bmatrix', '{ } matrix'),
  {
    name: '\\begin{cases}',
    snippet: '\\begin{cases}  & \\text{if } \\\\  & \\text{otherwise} \\end{cases}',
    desc: 'piecewise',
    caret: '\\begin{cases}'.length + 1
  },
  // Greek (lowercase)
  { name: '\\alpha', desc: 'α' },
  { name: '\\beta', desc: 'β' },
  { name: '\\gamma', desc: 'γ' },
  { name: '\\delta', desc: 'δ' },
  { name: '\\epsilon', desc: 'ε' },
  { name: '\\zeta', desc: 'ζ' },
  { name: '\\eta', desc: 'η' },
  { name: '\\theta', desc: 'θ' },
  { name: '\\lambda', desc: 'λ' },
  { name: '\\mu', desc: 'μ' },
  { name: '\\nu', desc: 'ν' },
  { name: '\\pi', desc: 'π' },
  { name: '\\rho', desc: 'ρ' },
  { name: '\\sigma', desc: 'σ' },
  { name: '\\tau', desc: 'τ' },
  { name: '\\phi', desc: 'φ' },
  { name: '\\chi', desc: 'χ' },
  { name: '\\psi', desc: 'ψ' },
  { name: '\\omega', desc: 'ω' },
  // Greek (uppercase)
  { name: '\\Gamma', desc: 'Γ' },
  { name: '\\Delta', desc: 'Δ' },
  { name: '\\Theta', desc: 'Θ' },
  { name: '\\Lambda', desc: 'Λ' },
  { name: '\\Pi', desc: 'Π' },
  { name: '\\Sigma', desc: 'Σ' },
  { name: '\\Phi', desc: 'Φ' },
  { name: '\\Omega', desc: 'Ω' },
  // Operators & relations
  { name: '\\infty', desc: '∞' },
  { name: '\\partial', desc: '∂' },
  { name: '\\nabla', desc: '∇' },
  { name: '\\cdot', desc: '·' },
  { name: '\\times', desc: '×' },
  { name: '\\div', desc: '÷' },
  { name: '\\pm', desc: '±' },
  { name: '\\leq', desc: '≤' },
  { name: '\\geq', desc: '≥' },
  { name: '\\neq', desc: '≠' },
  { name: '\\approx', desc: '≈' },
  { name: '\\equiv', desc: '≡' },
  { name: '\\propto', desc: '∝' },
  // Arrows & sets
  { name: '\\rightarrow', desc: '→' },
  { name: '\\Rightarrow', desc: '⇒' },
  { name: '\\leftarrow', desc: '←' },
  { name: '\\leftrightarrow', desc: '↔' },
  { name: '\\mapsto', desc: '↦' },
  { name: '\\forall', desc: '∀' },
  { name: '\\exists', desc: '∃' },
  { name: '\\in', desc: '∈' },
  { name: '\\notin', desc: '∉' },
  { name: '\\subset', desc: '⊂' },
  { name: '\\subseteq', desc: '⊆' },
  { name: '\\cup', desc: '∪' },
  { name: '\\cap', desc: '∩' },
  { name: '\\emptyset', desc: '∅' }
]

/** Filter commands by the letters typed after a backslash (no backslash). */
export function getLatexSuggestions(query: string): LatexCommand[] {
  const q = query.toLowerCase()
  if (!q) return LATEX_COMMANDS
  return LATEX_COMMANDS.filter((cmd) => cmd.name.slice(1).toLowerCase().startsWith(q))
}
