import { useEffect, useState } from 'react'

/**
 * Like `useState`, but the value is mirrored to `localStorage` so it survives
 * reloads/app restarts.
 *
 * WHY localStorage and not the SQLite database: this is *UI* state (sidebar
 * width, theme, last-open note). It's per-window, ephemeral, and has no business
 * round-tripping through IPC. The database stays reserved for actual documents,
 * tags, and widget data. Keeping that line clear is what keeps the app modular.
 */
export function usePersistentState<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      return stored !== null ? (JSON.parse(stored) as T) : initialValue
    } catch {
      // Corrupt/unavailable storage should never crash the UI.
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [key, value])

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setValue(JSON.parse(e.newValue))
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [key])

  return [value, setValue]
}
