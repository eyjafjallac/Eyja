import type { EyjaApi } from '@shared/ipc'

/**
 * Teaches TypeScript that `window.api` exists in the renderer and is fully
 * typed as `EyjaApi`. Because this augments the global `Window`, the renderer
 * gets autocomplete and compile-time checks on every backend call — without
 * ever importing main-process code.
 */
declare global {
  interface Window {
    api: EyjaApi
  }
}

export {}
