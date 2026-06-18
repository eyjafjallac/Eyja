import { BrowserWindow } from 'electron'
import type { Memo } from '@shared/models'
import { memoRepository } from '../db/memo.repository'
import { loadRenderer, rendererWebPreferences } from './shared'

/**
 * Floating sticky-memo windows.
 *
 * WHY a registry Map: each memo gets at most ONE window. Re-opening a memo that
 * is already on screen should just focus it, not spawn duplicates. The map also
 * lets IPC handlers reach a live window to close it or toggle always-on-top.
 *
 * Window bounds are persisted (debounced) on move/resize so a memo re-appears
 * exactly where the user left it across restarts.
 */
const memoWindows = new Map<string, BrowserWindow>()

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: NodeJS.Timeout | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/** Open (or focus) the floating window for a memo. */
export function openMemoWindow(memo: Memo): BrowserWindow {
  const existing = memoWindows.get(memo.id)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  const window = new BrowserWindow({
    width: memo.bounds?.width ?? 300,
    height: memo.bounds?.height ?? 300,
    // Omitting x/y lets the OS place the window; restored bounds reuse it.
    x: memo.bounds?.x,
    y: memo.bounds?.y,
    minWidth: 200,
    minHeight: 160,
    frame: false, // chromeless: we draw our own tiny header in the renderer
    skipTaskbar: true, // a memo is an accessory, not a top-level app window
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: memo.pinned,
    webPreferences: rendererWebPreferences()
  })

  // 'floating' keeps it above normal windows without fighting OS panels.
  if (memo.pinned) window.setAlwaysOnTop(true, 'floating')

  window.on('ready-to-show', () => window.show())

  const persistBounds = debounce(() => {
    if (window.isDestroyed()) return
    void memoRepository.update({ id: memo.id, bounds: window.getBounds() })
  }, 400)
  window.on('moved', persistBounds)
  window.on('resized', persistBounds)
  window.on('closed', () => memoWindows.delete(memo.id))

  loadRenderer(window, `memo/${memo.id}`)
  memoWindows.set(memo.id, window)
  return window
}

/** Close a memo's window (the memo row itself is left untouched). */
export function closeMemoWindow(id: string): void {
  const window = memoWindows.get(id)
  if (window && !window.isDestroyed()) window.close()
}

/** Reflect a pinned-state change onto a live window, if one is open. */
export function syncMemoPinned(id: string, pinned: boolean): void {
  const window = memoWindows.get(id)
  if (window && !window.isDestroyed()) {
    window.setAlwaysOnTop(pinned, pinned ? 'floating' : 'normal')
  }
}
