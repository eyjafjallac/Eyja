import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'

/**
 * A custom privileged protocol that serves user assets (images) from disk.
 *
 * WHY a custom protocol instead of base64-in-the-document or file://:
 *  - Storing images as base64 inside note JSON would bloat the SQLite DB badly.
 *  - The renderer can't read the filesystem (context isolation), and loading
 *    raw `file://` from a web origin is blocked/insecure.
 *  - `eyja-asset://` is registered as a standard, secure scheme, so <img src>
 *    works under CSP while the bytes live safely in the per-user data dir.
 */
export const ASSET_SCHEME = 'eyja-asset'
export const ASSET_HOST = 'assets'

/** Directory where user images are stored (per-user, writable). */
export function assetsDir(): string {
  return join(app.getPath('userData'), 'eyja-assets')
}

/**
 * Must run BEFORE `app.whenReady()` — Electron requires privileged schemes to
 * be declared up front.
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** Must run AFTER the app is ready. Maps URLs to files in the assets dir. */
export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, (request) => {
    const { host, pathname } = new URL(request.url)
    if (host !== ASSET_HOST) {
      return new Response('Not found', { status: 404 })
    }
    // `basename` strips any path segments, neutralizing "../" traversal attempts.
    const fileName = basename(decodeURIComponent(pathname))
    const filePath = join(assetsDir(), fileName)
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
