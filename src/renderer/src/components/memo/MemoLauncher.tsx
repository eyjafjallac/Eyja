import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, StickyNote } from 'lucide-react'
import type { MemoColor } from '@shared/models'
import { createPortal } from 'react-dom'
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
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })

  const toggleList = (): void => {
    const next = !open
    setOpen(next)
    if (next) void refresh() // memos may have changed in their own windows
  }

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={anchorRef} className="relative flex items-center gap-2">
      <Button
        variant="outline"
        onClick={() => void createMemo()}
        title="Create sticky memo"
        className="h-8 rounded-full border-primary/30 bg-background/50 hover:bg-background/80 text-primary hover:text-primary gap-1.5 px-3 text-xs font-semibold uppercase tracking-wider backdrop-blur-md shadow-sm transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        CREATE MEMO
      </Button>

      <Button
        size="icon"
        variant="ghost"
        onClick={toggleList}
        title="Open existing memos"
        className="h-8 w-8 rounded-full bg-background/40 backdrop-blur-md hover:bg-background/70"
      >
        <StickyNote className="h-4 w-4" />
      </Button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[2147483647] w-64 rounded-xl border border-white/20 glass-menu p-1.5 shadow-2xl pointer-events-auto"
            style={{ top: menuPos.top, right: menuPos.right }}
            onMouseDown={(e) => {
              // Prevent the editor from reclaiming focus while interacting with this menu.
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            {memos.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-foreground/70">No memos yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-0.5 custom-scrollbar pr-1.5 mr-0.5">
                {memos.map((memo) => (
                  <button
                    key={memo.id}
                    type="button"
                    onClick={async () => {
                      await openMemo(memo.id)
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-white/10 dark:hover:bg-black/20"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full shadow-inner"
                      style={{ backgroundColor: DOT[memo.color] }}
                    />
                    <span className="truncate font-medium opacity-80">{preview(memo.content)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
