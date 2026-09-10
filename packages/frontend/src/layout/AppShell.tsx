// Overall app layout — DESIGN.md §5.1:
//   Ribbon header (~88px) / three-panel body (flex-1) / status bar (~24px)
// Panel widths are fixed for now; DESIGN.md §2 calls all three vertical
// panels "mouse-drag resizable", which needs the same collision-aware
// resize machinery as segments (DESIGN.md §4.6) — that lands with Phase 3's
// collision system, not this chrome pass.
import { EditorPane } from './EditorPane'
import { PageList } from './PageList'
import { RibbonRoot } from './RibbonRoot'
import { SectionSidebar } from './SectionSidebar'
import { StatusBar } from './StatusBar'

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <RibbonRoot />
      <div className="flex min-h-0 flex-1">
        <SectionSidebar />
        <PageList />
        <EditorPane />
      </div>
      <StatusBar />
    </div>
  )
}
