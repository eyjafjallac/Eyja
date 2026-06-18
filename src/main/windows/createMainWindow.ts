import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

/**
 * Factory for the primary application window.
 *
 * WHY a factory function: Eyja will soon have multiple window types (the main
 * editor + the always-on-top sticky-memo windows). Centralizing creation keeps
 * the security-critical `webPreferences` identical and correct everywhere,
 * instead of copy-pasting (and eventually mis-configuring) it.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false, // avoid a white flash; we reveal on 'ready-to-show'
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // --- The security posture you asked for ---
      contextIsolation: true, // renderer & preload run in separate JS worlds
      nodeIntegration: false, // no require()/process/Buffer in the renderer
      sandbox: false // preload bundles as CJS and only uses the IPC bridge
    }
  })

  window.on('ready-to-show', () => window.show())

  // Open target=_blank / external links in the user's real browser, never in-app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // In dev, electron-vite serves the renderer over HTTP (with HMR).
  // In production we load the built HTML file from disk.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
