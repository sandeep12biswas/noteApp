// Ribbon header — DESIGN.md §5.1 ("~88px, tab bar + active ribbon panel")
// and §5.3 (Home/Insert/Draw/View tabs). The actual button groups per tab
// (Bold/Italic/font family/etc., per §5.3's table) are a later Phase 2 task
// once CanvasRoot/editorRefs exist for them to dispatch through — for now
// each tab renders an empty placeholder panel plus a Plugins ribbon-group
// slot, matching DESIGN.md §9.2 registerRibbonGroup's insertion point.
import { RIBBON_TABS, useUIStore } from '../store/uiStore'

export function RibbonRoot() {
  const activeTab = useUIStore((s) => s.activeRibbonTab)
  const setActiveTab = useUIStore((s) => s.setActiveRibbonTab)

  return (
    <header className="flex h-22 flex-col border-b border-gray-200 dark:border-gray-800" data-testid="ribbon-root">
      <nav className="flex gap-1 px-2 pt-1" role="tablist" aria-label="Ribbon tabs">
        {RIBBON_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === activeTab}
            onClick={() => setActiveTab(tab)}
            className={
              'rounded-t px-3 py-1 text-sm font-medium ' +
              (tab === activeTab
                ? 'bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200')
            }
          >
            {tab}
          </button>
        ))}
      </nav>
      <div
        role="tabpanel"
        aria-label={`${activeTab} ribbon panel`}
        className="flex flex-1 items-center gap-2 bg-white px-3 dark:bg-gray-900"
      >
        {/* TODO: per-tab button groups (DESIGN.md §5.3). Plugin ribbon
            groups (registerRibbonGroup, DESIGN.md §9.2) append here too,
            once ExtensionPointRegistry exists. */}
        <span className="text-xs text-gray-400">{activeTab} tools</span>
      </div>
    </header>
  )
}
