import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * electron-vite builds three independent bundles (main, preload, renderer),
 * each with its own module/security context. We keep them isolated here too.
 *
 * `externalizeDepsPlugin()` leaves everything in `dependencies` un-bundled so
 * native modules (better-sqlite3) and the Prisma runtime load from node_modules
 * at runtime instead of being mangled by the bundler. This is what lets the
 * native `.node` binary resolve correctly inside the packaged app.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    // The renderer is a normal web app. It MUST NOT see Node or main-process code.
    // Its only line to the backend is `window.api` (defined in preload).
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
