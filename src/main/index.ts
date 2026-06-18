import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'
import { disconnectPrisma } from './db/client'
import { createMainWindow } from './windows/createMainWindow'

/**
 * Main-process entry point: owns the app lifecycle and nothing else.
 * The real work is delegated to focused modules (ipc/, db/, windows/).
 */

app.whenReady().then(() => {
  // Register the backend API once, before any window can call it.
  registerIpcHandlers()

  createMainWindow()

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// Quit when all windows are closed, except on macOS (standard platform behavior).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Close the SQLite connection cleanly so no write is left in flight.
app.on('will-quit', () => {
  void disconnectPrisma()
})
