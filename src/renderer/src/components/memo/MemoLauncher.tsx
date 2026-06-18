import { useState } from 'react'
import { Plus, StickyNote } from 'lucide-react'
import type { MemoColor } from '@shared/models'
import { Button } from '@/components/ui/button'
import { useMemos } from '@/hooks/useMemos'

/** Header dot color per palette key (must stay in sync with StickyMemo). */
const DOT: Record<MemoColor, string> = {
  amber: '#fbbf24',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
  purple: '#a78bfa'
}

/** First non-empty line of a memo, for the list preview. */
function preview(content: string): string {
  const line = content.split('\n').find((l) => l.trim().length > 0)
  return line?.trim() ?? 'Empty memo'
}

/**
 * Topbar control for sticky memos: create a new floating memo or re-open an
 * existing one. Self-contained (owns its own data via useMemos) so it can drop
 * into the Topbar without threading props through the app.
 */
export function MemoLauncher(): JSX.Element {
  const { memos, refresh, createMemo, openMemo } = useMemos()
  const [open, setOpen] = useState(false)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) void refresh() // memos may have changed in their own windows
  }

  return (
    <div className="relative">
      <Button size="icon" variant="ghost" onClick={toggle} title="Sticky memos">
        <StickyNote className="h-4 w-4" />
      </Button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-border bg-card p-1 shadow-lg">
            <button
              onClick={() => {
                void createMemo()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              New sticky memo
            </button>

            {memos.length > 0 && <div className="my-1 h-px bg-border" />}

            <div className="max-h-72 overflow-y-auto">
              {memos.map((memo) => (
                <button
                  key={memo.id}
                  onClick={() => {
                    void openMemo(memo.id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: DOT[memo.color] }}
                  />
                  <span className="truncate text-muted-foreground">{preview(memo.content)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
