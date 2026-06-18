import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateMemoInput, UpdateMemoInput } from '@shared/models'
import { memoRepository } from '../db/memo.repository'
import { closeMemoWindow, openMemoWindow, syncMemoPinned } from '../windows/createMemoWindow'

/**
 * Wires the `memos:*` (data) and `memoWindow:*` (window-management) channels.
 *
 * Data handlers stay thin like the note handlers. The only extra logic is
 * keeping a live floating window in sync when its memo changes: a pinned toggle
 * must update the on-screen window's always-on-top state immediately.
 */
export function registerMemoIpc(): void {
  ipcMain.handle(IPC.memos.list, () => memoRepository.list())

  ipcMain.handle(IPC.memos.get, (_event, id: string) => memoRepository.get(id))

  ipcMain.handle(IPC.memos.create, (_event, input: CreateMemoInput) =>
    memoRepository.create(input)
  )

  ipcMain.handle(IPC.memos.update, async (_event, input: UpdateMemoInput) => {
    const memo = await memoRepository.update(input)
    // Reflect a pinned change onto the live window right away.
    if (input.pinned !== undefined) syncMemoPinned(memo.id, memo.pinned)
    return memo
  })

  ipcMain.handle(IPC.memos.delete, async (_event, id: string) => {
    closeMemoWindow(id) // tear down the window before the row disappears
    await memoRepository.delete(id)
  })

  // --- Window management ---
  ipcMain.handle(IPC.memoWindow.open, async (_event, id: string) => {
    const memo = await memoRepository.get(id)
    if (memo) openMemoWindow(memo)
  })

  ipcMain.handle(IPC.memoWindow.close, (_event, id: string) => {
    closeMemoWindow(id)
  })
}
