import { useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Trash2, X } from 'lucide-react'
import type { Memo, MemoColor } from '@shared/models'
import { publishMemoSync } from '@/lib/memo-sync'

interface StickyMemoProps {
  memoId: string
}

/** Pastel sticky palettes — fixed colors (theme-independent) with dark text. */
const PALETTE: Record<MemoColor, { bg: [number, number, number]; header: [number, number, number]; text: string }> = {
  amber: { bg: [254, 243, 199], header: [253, 230, 138], text: '#451a03' },
  green: { bg: [220, 252, 231], header: [187, 247, 208], text: '#052e16' },
  blue: { bg: [219, 234, 254], header: [191, 219, 254], text: '#172554' },
  pink: { bg: [252, 231, 243], header: [251, 207, 232], text: '#500724' },
  purple: { bg: [237, 233, 254], header: [221, 214, 254], text: '#2e1065' }
}

const COLOR_KEYS = Object.keys(PALETTE) as MemoColor[]

// Frameless-window drag regions are driven by this non-standard CSS property.
const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/**
 * A single floating sticky memo (rendered in its own always-on-top window).
 *
 * It is intentionally lightweight — a plain textarea, not the full block
 * editor — because memos are quick scratch notes. Edits autosave (debounced)
 * to SQLite via IPC; the colored header is the only OS drag handle.
 */
export function StickyMemo({ memoId }: StickyMemoProps): JSX.Element {
  const [memo, setMemo] = useState<Memo | null>(null)
  const [content, setContent] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [memoOpacity, setMemoOpacity] = useState(100)

  // Keep memo opacity synced with settings. Clamp to avoid invisible windows.
  useEffect(() => {
    const clampOpacity = (value: number): number => Math.min(100, Math.max(20, value))

    try {
      const stored = window.localStorage.getItem('eyja.memoOpacity')
      if (stored) {
         const val = clampOpacity(JSON.parse(stored))
         if (val !== memoOpacity) setMemoOpacity(val)
      }
    } catch {
      // ignore
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'eyja.memoOpacity' && e.newValue) {
        setMemoOpacity(clampOpacity(JSON.parse(e.newValue)))
      }
    }
    window.addEventListener('storage', handleStorage)
    
    // Fallback: poll local storage since electron windows might not perfectly sync storage events
    const interval = setInterval(() => {
      try {
        const stored = window.localStorage.getItem('eyja.memoOpacity')
        if (stored) {
          const val = clampOpacity(JSON.parse(stored))
          if (val !== memoOpacity) setMemoOpacity(val)
        }
      } catch {}
    }, 1000)

    return () => {
      window.removeEventListener('storage', handleStorage)
      clearInterval(interval)
    }
  }, [memoOpacity])
  // Tracks the last value persisted, so we don't re-save on initial load.
  const lastSaved = useRef('')

  useEffect(() => {
    void window.api.memos.get(memoId).then((m) => {
      if (m) {
        setMemo(m)
        setContent(m.content)
        lastSaved.current = m.content
      } else {
        setNotFound(true)
      }
    })
  }, [memoId])

  // Debounced autosave of the memo body.
  useEffect(() => {
    if (!memo || content === lastSaved.current) return
    const timer = setTimeout(() => {
      void window.api.memos.update({ id: memoId, content }).then(() => {
        lastSaved.current = content
        publishMemoSync({ type: 'updated', id: memoId })
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [content, memo, memoId])

  const togglePin = (): void => {
    if (!memo) return
    const pinned = !memo.pinned
    setMemo({ ...memo, pinned })
    void window.api.memos.update({ id: memoId, pinned }).then(() => {
      publishMemoSync({ type: 'updated', id: memoId })
    })
  }

  const changeColor = (color: MemoColor): void => {
    if (!memo) return
    setMemo({ ...memo, color })
    setShowPalette(false)
    void window.api.memos.update({ id: memoId, color }).then(() => {
      publishMemoSync({ type: 'updated', id: memoId })
    })
  }

  const deleteMemo = (): void => {
    void window.api.memos.delete(memoId).then(() => {
      publishMemoSync({ type: 'deleted', id: memoId })
    })
  }

  if (notFound) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-100 text-sm text-zinc-500">
        This memo no longer exists.
      </div>
    )
  }

  const palette = PALETTE[memo?.color ?? 'amber']
  const alpha = memoOpacity / 100

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ backgroundColor: `rgba(${palette.bg[0]}, ${palette.bg[1]}, ${palette.bg[2]}, ${alpha})`, color: palette.text }}
    >
      <div className="absolute inset-0 -z-10 pointer-events-none" style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
      
      <header
        className="flex h-8 shrink-0 items-center justify-between px-1.5"
        style={{ ...DRAG, backgroundColor: `rgba(${palette.header[0]}, ${palette.header[1]}, ${palette.header[2]}, ${alpha})` }}
      >
        <button
          title="Change color"
          onClick={() => setShowPalette((v) => !v)}
          className="h-3.5 w-3.5 rounded-full border border-black/20"
          style={{ ...NO_DRAG, backgroundColor: `rgb(${palette.bg[0]}, ${palette.bg[1]}, ${palette.bg[2]})` }}
        />

        <div className="flex items-center gap-0.5" style={NO_DRAG}>
          <button
            title={memo?.pinned ? 'Unpin (allow behind others)' : 'Pin on top'}
            onClick={togglePin}
            className="rounded p-1 transition-colors hover:bg-black/10"
          >
            {memo?.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
          <button
            title="Delete memo"
            onClick={deleteMemo}
            className="rounded p-1 transition-colors hover:bg-black/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            title="Close window"
            onClick={() => void window.api.memoWindow.close(memoId)}
            className="rounded p-1 transition-colors hover:bg-black/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {showPalette && (
        <div
          className="flex items-center gap-1.5 px-2 py-1"
          style={{ ...NO_DRAG, backgroundColor: `rgba(${palette.header[0]}, ${palette.header[1]}, ${palette.header[2]}, ${alpha})` }}
        >
          {COLOR_KEYS.map((key) => (
            <button
              key={key}
              title={key}
              onClick={() => changeColor(key)}
              className="h-4 w-4 rounded-full border border-black/20 transition-transform hover:scale-110"
              style={{ backgroundColor: `rgb(${PALETTE[key].bg[0]}, ${PALETTE[key].bg[1]}, ${PALETTE[key].bg[2]})` }}
            />
          ))}
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Jot something down…"
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:opacity-50"
        style={NO_DRAG}
      />
    </div>
  )
}
