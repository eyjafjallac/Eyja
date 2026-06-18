import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers } from './ipc'
import { disconnectPrisma } from './db/client'
import { registerAssetProtocol, registerAssetScheme } from './assets/assetProtocol'
import { createMainWindow } from './windows/createMainWindow'

/**
 * Main-process entry point: owns the app lifecycle and nothing else.
 * The real work is delegated to focused modules (ipc/, db/, windows/, assets/).
 */

// Privileged schemes MUST be declared before the app is ready.
registerAssetScheme()

app.whenReady().then(() => {
  // Serve user images via eyja-asset:// and register the backend API, both
  // before any window can request an asset or call an IPC channel.
  registerAssetProtocol()
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
