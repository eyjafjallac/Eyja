import { join } from 'node:path'
import type { BrowserWindow, WebPreferences } from 'electron'

/**
 * The single source of truth for security-critical renderer settings. Every
 * window (main editor + sticky memos) MUST use this so the isolation posture
 * can never drift between window types.
 */
export function rendererWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true, // renderer & preload run in separate JS worlds
    nodeIntegration: false, // no require()/process/Buffer in the renderer
    sandbox: false // preload bundles as CJS and only uses the IPC bridge
  }
}

/**
 * Load the renderer into a window. In dev, electron-vite serves it over HTTP
 * (with HMR); in production we load the built HTML from disk. `route` is an
 * optional hash (e.g. "memo/<id>") so the ONE renderer bundle can serve
 * multiple window types via client-side routing.
 */
export function loadRenderer(window: BrowserWindow, route = ''): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    const hash = route ? `#${route}` : ''
    void window.loadURL(`${devServerUrl}${hash}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: route || undefined
    })
  }
}
