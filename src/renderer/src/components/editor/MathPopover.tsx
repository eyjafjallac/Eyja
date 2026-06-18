import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { getLatexSuggestions, type LatexCommand } from './latex-commands'
import { cn } from '@/lib/utils'

interface MathPopoverProps {
  latex: string
  /** Viewport coordinates (px) of the clicked math node's bottom-left. */
  top: number
  left: number
  onChange: (latex: string) => void
  onDelete: () => void
  onClose: () => void
}

/** Matches a `\command` token immediately before the caret. */
const TOKEN_RE = /\\([a-zA-Z]*)$/

/**
 * Floating LaTeX editor for a clicked math node, with command autocomplete.
 *
 * WHY this exists: TipTap's math nodes are non-editable atoms — they only
 * expose an onClick hook and no editing surface. This popover gives one: edits
 * apply live to the node, and typing a backslash (e.g. `\fra`) suggests LaTeX
 * commands (`\frac`), inserting brace-aware snippets so you can keep typing.
 */
export function MathPopover({
  latex,
  top,
  left,
  onChange,
  onDelete,
  onClose
}: MathPopoverProps): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Autocomplete state.
  const [suggestions, setSuggestions] = useState<LatexCommand[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  // After accepting a snippet we need to reposition the caret post-render.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  const open = suggestions.length > 0

  useEffect(() => {
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [])

  // Restore the caret after a value change triggered by accepting a snippet.
  useLayoutEffect(() => {
    if (pendingCaret != null && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(pendingCaret, pendingCaret)
      setPendingCaret(null)
    }
  }, [pendingCaret, latex])

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  /** Recompute suggestions from the value + caret position. */
  const refreshSuggestions = (value: string, caret: number): void => {
    const match = value.slice(0, caret).match(TOKEN_RE)
    if (match) {
      setSuggestions(getLatexSuggestions(match[1]))
      setActiveIndex(0)
    } else {
      setSuggestions([])
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    onChange(value)
    refreshSuggestions(value, e.target.selectionStart)
  }

  /** Replace the active `\token` with the chosen command's snippet. */
  const accept = (cmd: LatexCommand): void => {
    const el = textareaRef.current
    if (!el) return
    const caret = el.selectionStart
    const before = latex.slice(0, caret)
    const match = before.match(TOKEN_RE)
    if (!match) return

    const start = caret - match[0].length
    const insertion = cmd.snippet ?? cmd.name
    const newValue = latex.slice(0, start) + insertion + latex.slice(caret)
    onChange(newValue)

    // Caret priority: explicit offset (matrices) → first empty "{}" → end.
    const braceIdx = insertion.indexOf('{}')
    const offset = cmd.caret ?? (braceIdx >= 0 ? braceIdx + 1 : insertion.length)
    setPendingCaret(start + offset)
    setSuggestions([])
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((activeIndex + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((activeIndex - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[activeIndex])
        return
      }
      if (e.key === 'Escape') {
        // First Escape dismisses suggestions; the popover stays open.
        e.preventDefault()
        setSuggestions([])
        return
      }
    }

    // No suggestion list open: Enter/Escape close the popover.
    if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div
        className="fixed z-50 w-80 rounded-md border border-border bg-card p-2 shadow-lg"
        style={{ top: top + 6, left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">LaTeX</span>
          <button
            onClick={onDelete}
            title="Delete equation"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={latex}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => refreshSuggestions(e.currentTarget.value, e.currentTarget.selectionStart)}
          onClick={(e) => refreshSuggestions(e.currentTarget.value, e.currentTarget.selectionStart)}
          rows={2}
          spellCheck={false}
          placeholder="e.g. \frac{a}{b}"
          className="w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />

        {open ? (
          <div className="mt-1 max-h-48 overflow-y-auto rounded border border-border">
            {suggestions.map((cmd, index) => (
              <button
                key={cmd.name}
                ref={(el) => {
                  itemRefs.current[index] = el
                }}
                // preventDefault keeps focus in the textarea so the caret survives.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(cmd)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-2 py-1 text-left font-mono text-xs transition-colors',
                  index === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground'
                )}
              >
                <span className="truncate">{cmd.name}</span>
                {cmd.desc && <span className="shrink-0 text-muted-foreground">{cmd.desc}</span>}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Type \ for commands · Enter or Esc to close
          </p>
        )}
      </div>
    </div>
  )
}
