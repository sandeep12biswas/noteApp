// Overall app layout — DESIGN.md §5.1:
//   Ribbon header (~88px) / three-panel body (flex-1) / status bar (~24px)
// Panel widths are fixed for now; DESIGN.md §2 calls all three vertical
// panels "mouse-drag resizable", which needs the same collision-aware
// resize machinery as segments (DESIGN.md §4.6) — that lands with Phase 3's
// collision system, not this chrome pass.
import { PluginManager } from '../plugins/PluginManager'
import { useUIStore } from '../store/uiStore'
import { EditorPane } from './EditorPane'
import { PageList } from './PageList'
import { PluginManagerUI } from './PluginManagerUI'
import { RibbonRoot } from './RibbonRoot'
import { SectionSidebar } from './SectionSidebar'
import { StatusBar } from './StatusBar'

export function AppShell() {
  const activeView = useUIStore((s) => s.activeView)

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Renders no UI of its own — mounts one sandboxed iframe per enabled
          plugin (DESIGN.md §9.8) regardless of which main view is active,
          so a plugin's block types/ribbon groups stay live while browsing
          notes, not just while the Plugin Manager itself is open. */}
      <PluginManager />
      <RibbonRoot />
      <div className="flex min-h-0 flex-1">
        <SectionSidebar />
        {activeView === 'plugins' ? (
          <PluginManagerUI />
        ) : (
          <>
            <PageList />
            <EditorPane />
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
