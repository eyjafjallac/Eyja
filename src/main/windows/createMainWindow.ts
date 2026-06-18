import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { loadRenderer, rendererWebPreferences } from './shared'

/**
 * Factory for the primary application window.
 *
 * WHY a factory function: Eyja will soon have multiple window types (the main
 * editor + the always-on-top sticky-memo windows). Centralizing creation keeps
 * the security-critical `webPreferences` identical and correct everywhere,
 * instead of copy-pasting (and eventually mis-configuring) it.
 */
export function createMainWindow(): BrowserWindow {
  const appIcon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'icons', 'icon.png'))

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false, // avoid a white flash; we reveal on 'ready-to-show'
    autoHideMenuBar: true,
    // Use the project icon in dev and packaged builds.
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: rendererWebPreferences()
  })

  window.on('ready-to-show', () => window.show())

  // Open target=_blank / external links in the user's real browser, never in-app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(window)

  return window
}
