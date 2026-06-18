import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { SlashCommandItem } from './slash-command-items'
import { cn } from '@/lib/utils'

interface SlashCommandMenuProps {
  items: SlashCommandItem[]
  /** Provided by TipTap's suggestion utility; runs the chosen item's command. */
  command: (item: SlashCommandItem) => void
}

/** Imperative handle so the TipTap suggestion plugin can forward key events. */
export interface SlashCommandMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/**
 * The popup list shown after typing "/". It's a normal React component; the
 * positioning + lifecycle are handled by the extension's renderer. Keeping the
 * UI here (and the editor wiring in the extension) keeps each concern small.
 */
export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    // Reset the highlight whenever the filtered list changes.
    useEffect(() => setSelected(0), [items])

    // Keep the highlighted item visible as you arrow through a long list.
    useEffect(() => {
      itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
    }, [selected])

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowUp') {
          setSelected((selected + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((selected + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          command(items[selected])
          return true
        }
        return false
      }
    }))

    if (items.length === 0) {
      return (
        <div className="w-72 rounded-md border border-border bg-card p-2 text-sm text-muted-foreground shadow-md">
          No results
        </div>
      )
    }

    return (
      <div className="max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-md">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button
              key={item.title}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              onClick={() => command(item)}
              onMouseEnter={() => setSelected(index)}
              className={cn(
                'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors',
                index === selected ? 'bg-accent text-accent-foreground' : 'text-foreground'
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    )
  }
)

SlashCommandMenu.displayName = 'SlashCommandMenu'
