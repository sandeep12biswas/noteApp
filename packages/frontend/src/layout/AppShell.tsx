// Overall app layout — DESIGN.md §5.1:
//   Ribbon header (~88px) / three-panel body (flex-1) / status bar (~24px)
// The folder and page panels are mouse-drag resizable (DESIGN.md §2) via a
// PanelResizeHandle on each one's right edge; the editor takes the rest.
// (No collision machinery needed: segments are positioned inside the
// editor, so a narrower editor just shows less of the canvas.)
import { useEffect } from 'react'
import { PluginManager } from '../plugins/PluginManager'
import { useUIStore } from '../store/uiStore'
import { EditorPane } from './EditorPane'
import { PageList } from './PageList'
import { PanelResizeHandle } from './PanelResizeHandle'
import { PluginManagerUI } from './PluginManagerUI'
import { RibbonRoot } from './RibbonRoot'
import { SectionSidebar } from './SectionSidebar'
import { StatusBar } from './StatusBar'

export function AppShell() {
  const activeView = useUIStore((s) => s.activeView)
  const reclampPanelWidths = useUIStore((s) => s.reclampPanelWidths)

  // Keep the editor's minimum width when the window gets narrower (or the
  // saved widths came from a wider screen).
  useEffect(() => {
    reclampPanelWidths()
    window.addEventListener('resize', reclampPanelWidths)
    return () => window.removeEventListener('resize', reclampPanelWidths)
  }, [reclampPanelWidths])

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
        <PanelResizeHandle panel="folders" label="Resize folder panel" />
        {activeView === 'plugins' ? (
          <PluginManagerUI />
        ) : (
          <>
            <PageList />
            <PanelResizeHandle panel="pages" label="Resize page panel" />
            <EditorPane />
          </>
        )}
      </div>
      <StatusBar />
    </div>
  )
}
