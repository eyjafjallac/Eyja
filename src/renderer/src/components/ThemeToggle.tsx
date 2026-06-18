import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'

/** Small icon button that flips light/dark. State lives in `useTheme`. */
export function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme()
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
