import { useEffect } from 'react'
import { usePersistentState } from './usePersistentState'

export type Theme = 'light' | 'dark'

/**
 * Owns the light/dark theme. The actual styling is driven entirely by the
 * `.dark` class on <html> (see styles/index.css + tailwind.config.js), so this
 * hook's only job is to toggle that class and remember the choice.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = usePersistentState<Theme>('eyja.theme', 'dark')

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return {
    theme,
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark')
  }
}
