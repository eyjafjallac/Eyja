/**
 * Lightweight cross-window sync for sticky memos.
 *
 * Electron windows that load the same renderer origin can communicate via
 * BroadcastChannel. This lets memo windows notify the main window launcher
 * immediately after writes, without adding extra main-process IPC plumbing.
 */
export type MemoSyncEventType = 'created' | 'updated' | 'deleted'

export interface MemoSyncEvent {
  type: MemoSyncEventType
  id: string
  at: number
}

const CHANNEL_NAME = 'eyja:memos'

function newChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

/** Publish a memo change to all open Eyja renderer windows. */
export function publishMemoSync(event: Omit<MemoSyncEvent, 'at'>): void {
  const channel = newChannel()
  if (!channel) return
  channel.postMessage({ ...event, at: Date.now() } satisfies MemoSyncEvent)
  channel.close()
}

/**
 * Subscribe to memo-change events from other windows.
 * Returns an unsubscribe function.
 */
export function subscribeMemoSync(onEvent: (event: MemoSyncEvent) => void): () => void {
  const channel = newChannel()
  if (!channel) return () => {}

  const handler = (message: MessageEvent<MemoSyncEvent>): void => {
    const payload = message.data
    if (!payload || typeof payload !== 'object') return
    if (typeof payload.id !== 'string') return
    if (payload.type !== 'created' && payload.type !== 'updated' && payload.type !== 'deleted') return
    onEvent(payload)
  }

  channel.addEventListener('message', handler)
  return () => {
    channel.removeEventListener('message', handler)
    channel.close()
  }
}
