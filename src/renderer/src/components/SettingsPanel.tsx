import { useEffect } from 'react'
import { X, Moon, Sun, Monitor, Download, Upload, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/utils'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
  editorOpacity: number
  setEditorOpacity: (v: number) => void
  sidebarOpacity: number
  setSidebarOpacity: (v: number) => void
}

export function SettingsPanel({ 
  open, 
  onClose,
  editorOpacity,
  setEditorOpacity,
  sidebarOpacity,
  setSidebarOpacity
}: SettingsPanelProps): JSX.Element {
  const [memoOpacity, setMemoOpacity] = usePersistentState('eyja.memoOpacity', 100)
  const safeMemoOpacity = Math.min(100, Math.max(20, memoOpacity))

  useEffect(() => {
    if (safeMemoOpacity !== memoOpacity) setMemoOpacity(safeMemoOpacity)
  }, [memoOpacity, safeMemoOpacity, setMemoOpacity])

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-background/20 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-80 glass-panel shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col border-l border-white/20',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex h-14 items-center justify-between px-6 glass-header">
          <h2 className="text-lg font-bold tracking-widest uppercase">Settings</h2>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full hover:bg-white/10 dark:hover:bg-black/20 transition-all"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          <section className="space-y-3">
            <h3 className="text-xs font-bold tracking-widest text-foreground/50 uppercase">Appearance</h3>
            <div className="flex items-center justify-between rounded-xl bg-white/5 dark:bg-black/10 p-3 border border-white/10">
              <span className="text-sm font-medium">Theme Mode</span>
              <ThemeToggle />
            </div>
            
            <div className="space-y-4 rounded-xl bg-white/5 dark:bg-black/10 p-4 border border-white/10">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Editor Transparency</span>
                  <span className="text-foreground/50">{editorOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={editorOpacity} 
                  onChange={(e) => setEditorOpacity(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Sidebar Transparency</span>
                  <span className="text-foreground/50">{sidebarOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="100" 
                  value={sidebarOpacity} 
                  onChange={(e) => setSidebarOpacity(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Memo Transparency</span>
                  <span className="text-foreground/50">{safeMemoOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="20" max="100" 
                  value={safeMemoOpacity} 
                  onChange={(e) => setMemoOpacity(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold tracking-widest text-foreground/50 uppercase">Data & Storage</h3>
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-3 rounded-xl bg-white/5 dark:bg-black/10 border-white/10 hover:bg-white/10 dark:hover:bg-black/20">
                <Download className="h-4 w-4 opacity-70" />
                Export Notes Backup
              </Button>
              <Button variant="outline" className="w-full justify-start gap-3 rounded-xl bg-white/5 dark:bg-black/10 border-white/10 hover:bg-white/10 dark:hover:bg-black/20">
                <Upload className="h-4 w-4 opacity-70" />
                Import Notes Data
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold tracking-widest text-foreground/50 uppercase">About</h3>
            <div className="rounded-xl bg-white/5 dark:bg-black/10 p-4 border border-white/10 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold tracking-wider">EYJA</span>
                <span className="text-xs opacity-50">v1.0.0</span>
              </div>
              <p className="text-xs opacity-70 leading-relaxed">
                Home away from home. A beautiful, offline-first notes environment.
              </p>
              <div className="pt-2 flex gap-2">
                 <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-md hover:bg-white/10">Release Notes</Button>
                 <Button variant="ghost" size="sm" className="h-7 text-xs px-2 rounded-md hover:bg-white/10">Licenses</Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
