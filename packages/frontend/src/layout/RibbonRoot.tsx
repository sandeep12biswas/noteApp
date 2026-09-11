// Ribbon header — DESIGN.md §5.1 ("~88px, tab bar + active ribbon panel")
// and §5.3 (Home/Insert/Draw/View tabs). The actual button groups per tab
// (Bold/Italic/font family/etc., per §5.3's table) are a later Phase 2 task
// once CanvasRoot/editorRefs exist for them to dispatch through — for now
// each tab renders an empty placeholder panel plus a Plugins ribbon-group
// slot, matching DESIGN.md §9.2 registerRibbonGroup's insertion point. The
// Draw tab is the one exception: it's the ink layer's tool switcher
// (DESIGN.md §5.5), since Draw mode itself is just "this tab is active".
import { useExtensionRegistry } from '../store/extensionRegistry'
import { INK_COLORS, INK_TOOLS, useInkStore } from '../store/inkStore'
import { RIBBON_TABS, type RibbonTab, useUIStore } from '../store/uiStore'

/** Plugin ribbon groups for the active tab (DESIGN.md §9.2 `registerRibbonGroup`) — empty until Phase 7. */
function PluginRibbonGroups({ ribbonTab }: { ribbonTab: RibbonTab }) {
  const groups = useExtensionRegistry((s) => s.ribbonGroups)
  const forThisTab = Object.values(groups).filter((g) => g.ribbonTab === ribbonTab)
  if (forThisTab.length === 0) return null
  return (
    <div className="flex gap-2 border-l border-gray-200 pl-2 dark:border-gray-700">
      {forThisTab.map((g) => (
        <span key={`${g.pluginId}/${g.id}`} className="text-xs text-gray-500">
          {g.label}
        </span>
      ))}
    </div>
  )
}

function DrawToolsPanel() {
  const tool = useInkStore((s) => s.tool)
  const setTool = useInkStore((s) => s.setTool)
  const color = useInkStore((s) => s.color)
  const setColor = useInkStore((s) => s.setColor)

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" role="group" aria-label="Ink tool">
        {INK_TOOLS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={t === tool}
            onClick={() => setTool(t)}
            className={
              'rounded px-2 py-1 text-xs capitalize ' +
              (t === tool
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800')
            }
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-1" role="group" aria-label="Ink colour">
        {INK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={c === color}
            disabled={tool === 'eraser'}
            onClick={() => setColor(c)}
            className={'h-5 w-5 rounded-full border-2 disabled:opacity-30'}
            style={{ backgroundColor: c, borderColor: c === color ? '#1d4ed8' : 'transparent' }}
          />
        ))}
      </div>
    </div>
  )
}

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
        {activeTab === 'Draw' ? <DrawToolsPanel /> : <span className="text-xs text-gray-400">{activeTab} tools</span>}
        <PluginRibbonGroups ribbonTab={activeTab} />
      </div>
    </header>
  )
}
