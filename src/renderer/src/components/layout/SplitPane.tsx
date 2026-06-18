import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/utils'

interface SplitPaneProps {
  /** Fixed-width left pane (e.g. the sidebar). */
  left: ReactNode
  /** Flexible right pane that fills remaining space (e.g. the editor). */
  right: ReactNode
  /** localStorage key so the chosen width persists across restarts. */
  storageKey: string
  defaultLeftWidth?: number
  minLeftWidth?: number
  maxLeftWidth?: number
  /** When true the left pane is hidden entirely (collapsed sidebar). */
  collapsed?: boolean
}

/**
 * A horizontal two-pane layout with a draggable divider.
 *
 * WHY a bespoke component instead of a library: the behavior we need is small
 * (one draggable gutter, clamped width, persistence) and isolating it here means
 * every consumer just passes `left`/`right` and never reimplements drag logic.
 * It also keeps our dependency surface lean.
 */
export function SplitPane({
  left,
  right,
  storageKey,
  defaultLeftWidth = 256,
  minLeftWidth = 180,
  maxLeftWidth = 480,
  collapsed = false
}: SplitPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = usePersistentState<number>(storageKey, defaultLeftWidth)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback(
    (px: number) => Math.min(maxLeftWidth, Math.max(minLeftWidth, px)),
    [minLeftWidth, maxLeftWidth]
  )

  // Global listeners while dragging so the cursor can leave the thin gutter.
  useEffect(() => {
    if (!dragging) return

    const onMove = (e: PointerEvent): void => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setLeftWidth(clamp(e.clientX - rect.left))
    }
    const stop = (): void => setDragging(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    // Avoid text selection / wrong cursor while dragging.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, clamp, setLeftWidth])

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {!collapsed && (
        <>
          <div style={{ width: leftWidth }} className="h-full shrink-0">
            {left}
          </div>

          {/* Divider: a thin gutter with a wider invisible hit area for easy grabbing. */}
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={() => setDragging(true)}
            onDoubleClick={() => setLeftWidth(defaultLeftWidth)}
            title="Drag to resize · double-click to reset"
            className={cn(
              'group relative w-px shrink-0 cursor-col-resize bg-border transition-colors',
              dragging && 'bg-primary/50'
            )}
          >
            <span className="absolute inset-y-0 -left-1 -right-1 z-10" />
          </div>
        </>
      )}

      <div className="h-full min-w-0 flex-1">{right}</div>
    </div>
  )
}
