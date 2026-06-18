import { useCallback, useEffect, useState } from 'react'
import type { Memo } from '@shared/models'
import { publishMemoSync, subscribeMemoSync } from '@/lib/memo-sync'

/**
 * Data-access for sticky memos from the MAIN app window (the launcher).
 *
 * A BroadcastChannel subscription keeps this list fresh when memo windows edit
 * content/color/pin state or delete a memo.
 */
export function useMemos() {
  const [memos, setMemos] = useState<Memo[]>([])

  const refresh = useCallback(async () => {
    setMemos(await window.api.memos.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return subscribeMemoSync(() => {
      void refresh()
    })
  }, [refresh])

  const createMemo = useCallback(async () => {
    const memo = await window.api.memos.create({})
    await window.api.memoWindow.open(memo.id)
    await refresh()
    publishMemoSync({ type: 'created', id: memo.id })
    return memo
  }, [refresh])

  const openMemo = useCallback((id: string) => window.api.memoWindow.open(id), [])

  return { memos, refresh, createMemo, openMemo }
}
