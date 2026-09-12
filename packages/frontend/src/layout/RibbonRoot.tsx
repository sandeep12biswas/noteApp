// Ribbon header — DESIGN.md §5.1 ("~88px, tab bar + active ribbon panel")
// and §5.3 (Home/Insert/Draw/View tabs). The actual button groups per tab
// (Bold/Italic/font family/etc., per §5.3's table) are a later Phase 2 task
// once CanvasRoot/editorRefs exist for them to dispatch through — for now
// each tab renders an empty placeholder panel plus a Plugins ribbon-group
// slot, matching DESIGN.md §9.2 registerRibbonGroup's insertion point. The
// Draw tab is the one exception: it's the ink layer's tool switcher
// (DESIGN.md §5.5), since Draw mode itself is just "this tab is active".
import { type ReactNode, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useExtensionRegistry } from '../store/extensionRegistry'
import { INK_COLORS, INK_TOOLS, useInkStore } from '../store/inkStore'
import { getIPCAdapter } from '../store/notebookStore'
import { sendRibbonAction } from '../plugins/PluginIPCBridge'
import { FONT_FAMILIES, type FontFamilyOption } from '../lib/fontFamilies'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../lib/textColors'
import { useFontStore } from '../store/fontStore'
import { MAX_ZOOM, MIN_ZOOM, RIBBON_TABS, type RibbonTab, useUIStore } from '../store/uiStore'
import { ColorPickerMenu } from './ColorPickerMenu'

// DESIGN.md §5.3 Home row: "Highlight · Text colour" — a real dropdown
// picker (was previously just "click cycles through 5 fixed colours",
// which had no way to reach anything else). The letter button applies the
// current colour on click (same one-click-reapply UX as before); a small
// caret button next to it opens `ColorPickerMenu`'s wider preset grid +
// native colour-wheel input.
function ColorDropdownButton({
  label,
  letter,
  colors,
  onApply,
  onClear,
}: {
  label: string
  letter: string
  colors: readonly string[]
  onApply: (color: string) => void
  onClear?: () => void
}) {
  const [current, setCurrent] = useState<string>(colors[0]!)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const caretRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="flex items-start">
      <button
        type="button"
        aria-label={label}
        title={`${label}: ${current}`}
        onClick={() => onApply(current)}
        className="flex flex-col items-center rounded px-1.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span>{letter}</span>
        <span className="mt-0.5 h-0.5 w-4 rounded" style={{ backgroundColor: current }} />
      </button>
      <button
        ref={caretRef}
        type="button"
        aria-label={`${label} options`}
        onClick={() => {
          const rect = caretRef.current?.getBoundingClientRect()
          setMenu(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 })
        }}
        className="rounded px-0.5 py-1 text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        ▾
      </button>
      {menu && (
        <ColorPickerMenu
          x={menu.x}
          y={menu.y}
          label={label}
          colors={colors}
          activeColor={current}
          onPick={(color) => {
            setCurrent(color)
            onApply(color)
          }}
          onClear={onClear}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

// DESIGN.md §5.4: "All ribbon commands route through `getActiveEditor()`…
// `document.execCommand()` is never used" — this is the enforcement point
// for that rule (ESLint additionally bans `document.execCommand` outright,
// see the root eslint config's comment). `editorRefs`/`getActiveEditor()`
// are deliberately non-reactive (canvasStore.ts's own doc comment), so a
// button's *action* always reaches the right editor, but a button's own
// pressed/active look can't live-track the current selection's marks
// without the ribbon re-rendering on every keystroke in every open
// segment — out of proportion for Phase 6, so these buttons act correctly
// but don't light up to reflect "is this mark active here" the way a
// native word processor's would; a real limitation, not an oversight.
function RibbonButton({
  label,
  children,
  onClick,
}: {
  label: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded px-1.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="h-5 w-px self-center bg-gray-200 dark:bg-gray-700" role="separator" />
}

const SELECT_CLASSNAME =
  'rounded border border-gray-200 bg-white px-1 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'

// FONT_FAMILIES is a flat list ordered Generic -> Windows -> Linux -> Web
// fonts (lib/fontFamilies.ts's own doc comment); grouped here into
// `<optgroup>`s so a list this long (Windows/Office + Linux distro fonts,
// per the user's ask, alongside the handful of Google Fonts already there)
// stays scannable in a plain `<select>` instead of one long flat list.
const FONT_GROUPS: [string, FontFamilyOption[]][] = (() => {
  const order: string[] = []
  const byGroup = new Map<string, FontFamilyOption[]>()
  for (const f of FONT_FAMILIES) {
    if (!byGroup.has(f.group)) {
      order.push(f.group)
      byGroup.set(f.group, [])
    }
    byGroup.get(f.group)!.push(f)
  }
  return order.map((group) => [group, byGroup.get(group)!])
})()

// One ribbon font-family picker doing double duty — a plain native
// `<select>` (this app has no dropdown/menu library; the closest existing
// precedent for a native control is ColorPickerMenu.tsx's
// `<input type="color">`), listing lib/fontFamilies.ts's curated preset
// list. Picking a font both (a) applies it to the current selection/cursor
// via the usual getActiveEditor() dispatch path, exactly like every other
// ribbon command, and (b) becomes the persisted default (store/fontStore.ts)
// that any brand-new, still-empty segment starts with from then on
// (canvas/applyDefaultFontIfNew.ts) — one choice serves both asks, rather
// than a separate "apply now" control and a separate "set default" control
// for what a user experiences as a single decision ("use this font").
// Initialized from the persisted default (not blank) since that's the most
// useful starting display; like ColorDropdownButton, it's local state, not
// a live read of the current selection's mark (RibbonRoot.tsx's own doc
// comment already covers why: `getActiveEditor()` is deliberately
// non-reactive).
function FontFamilySelect() {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const defaultFont = useFontStore((s) => s.defaultFont)
  const setDefaultFont = useFontStore((s) => s.setDefaultFont)
  const [current, setCurrent] = useState(defaultFont)

  return (
    <select
      aria-label="Font family"
      title="Font family"
      className={SELECT_CLASSNAME}
      value={current}
      onChange={(e) => {
        const value = e.target.value
        setCurrent(value)
        setDefaultFont(value)
        const chain = getActiveEditor()?.chain().focus()
        if (value) chain?.setFontFamily(value).run()
        else chain?.unsetFontFamily().run()
      }}
    >
      {FONT_GROUPS.map(([group, options]) => (
        <optgroup key={group} label={group}>
          {options.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 96
const FONT_SIZE_STEP = 2
const FONT_SIZE_DEFAULT = 16

// Font-size increase/decrease — TipTap has no built-in font-size mark
// (canvas/fontSizeExtension.ts is a small local one, same TextStyle
// piggyback as Color/FontFamily). A stepper (A- / size / A+), not a
// dropdown, since size is a continuous-ish scale a user nudges up or down
// rather than picks from a short named list — same reasoning that put
// Zoom in/out in the View tab as +/- buttons, not a select. Like
// FontFamilySelect, the displayed size is local state, not a live read of
// the current selection's mark (`getActiveEditor()` is deliberately
// non-reactive — see this file's own doc comment above `RibbonButton`).
function FontSizeStepper() {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const [size, setSize] = useState(FONT_SIZE_DEFAULT)

  const apply = (next: number) => {
    const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, next))
    setSize(clamped)
    getActiveEditor()?.chain().focus().setFontSize(`${clamped}px`).run()
  }

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Font size">
      <RibbonButton label="Decrease font size" onClick={() => apply(size - FONT_SIZE_STEP)}>
        A−
      </RibbonButton>
      <span className="w-5 text-center text-xs text-gray-500 dark:text-gray-400">{size}</span>
      <RibbonButton label="Increase font size" onClick={() => apply(size + FONT_SIZE_STEP)}>
        A+
      </RibbonButton>
    </div>
  )
}

function HomeToolsPanel() {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const run = (fn: (chain: ReturnType<NonNullable<ReturnType<typeof getActiveEditor>>['chain']>) => void) => {
    const editor = getActiveEditor()
    if (!editor) return
    fn(editor.chain().focus())
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="flex items-center gap-0.5" role="group" aria-label="History">
        <RibbonButton label="Undo" onClick={() => run((c) => c.undo().run())}>
          ↶
        </RibbonButton>
        <RibbonButton label="Redo" onClick={() => run((c) => c.redo().run())}>
          ↷
        </RibbonButton>
      </div>
      <Divider />
      <div className="flex items-center gap-1" role="group" aria-label="Font">
        <FontFamilySelect />
        <FontSizeStepper />
      </div>
      <Divider />
      <div className="flex items-center gap-0.5" role="group" aria-label="Text style">
        <RibbonButton label="Bold" onClick={() => run((c) => c.toggleBold().run())}>
          <strong>B</strong>
        </RibbonButton>
        <RibbonButton label="Italic" onClick={() => run((c) => c.toggleItalic().run())}>
          <em>I</em>
        </RibbonButton>
        <RibbonButton label="Underline" onClick={() => run((c) => c.toggleUnderline().run())}>
          <span className="underline">U</span>
        </RibbonButton>
        <RibbonButton label="Strikethrough" onClick={() => run((c) => c.toggleStrike().run())}>
          <span className="line-through">S</span>
        </RibbonButton>
        <RibbonButton label="Subscript" onClick={() => run((c) => c.toggleSubscript().run())}>
          X<sub>2</sub>
        </RibbonButton>
        <RibbonButton label="Superscript" onClick={() => run((c) => c.toggleSuperscript().run())}>
          X<sup>2</sup>
        </RibbonButton>
      </div>
      <Divider />
      <ColorDropdownButton
        label="Highlight"
        letter="H"
        colors={HIGHLIGHT_COLORS}
        onApply={(color) => getActiveEditor()?.chain().focus().toggleHighlight({ color }).run()}
        onClear={() => getActiveEditor()?.chain().focus().unsetHighlight().run()}
      />
      <ColorDropdownButton
        label="Text colour"
        letter="A"
        colors={TEXT_COLORS}
        onApply={(color) => getActiveEditor()?.chain().focus().setColor(color).run()}
        onClear={() => getActiveEditor()?.chain().focus().unsetColor().run()}
      />
      <RibbonButton label="Clear formatting" onClick={() => run((c) => c.unsetAllMarks().clearNodes().run())}>
        Clear
      </RibbonButton>
      <Divider />
      <div className="flex items-center gap-0.5" role="group" aria-label="Lists">
        <RibbonButton label="Bulleted list" onClick={() => run((c) => c.toggleBulletList().run())}>
          •—
        </RibbonButton>
        <RibbonButton label="Numbered list" onClick={() => run((c) => c.toggleOrderedList().run())}>
          1.
        </RibbonButton>
        <RibbonButton label="Checklist" onClick={() => run((c) => c.toggleTaskList().run())}>
          ☑
        </RibbonButton>
        <RibbonButton label="Indent" onClick={() => run((c) => c.sinkListItem('listItem').run())}>
          →|
        </RibbonButton>
        <RibbonButton label="Outdent" onClick={() => run((c) => c.liftListItem('listItem').run())}>
          |←
        </RibbonButton>
      </div>
      <Divider />
      <div className="flex items-center gap-0.5" role="group" aria-label="Alignment">
        <RibbonButton label="Align left" onClick={() => run((c) => c.setTextAlign('left').run())}>
          ⇤
        </RibbonButton>
        <RibbonButton label="Align center" onClick={() => run((c) => c.setTextAlign('center').run())}>
          ↔
        </RibbonButton>
        <RibbonButton label="Align right" onClick={() => run((c) => c.setTextAlign('right').run())}>
          ⇥
        </RibbonButton>
        <RibbonButton label="Justify" onClick={() => run((c) => c.setTextAlign('justify').run())}>
          ☰
        </RibbonButton>
      </div>
      <Divider />
      <div className="flex items-center gap-0.5" role="group" aria-label="Blocks">
        <RibbonButton label="Heading 1" onClick={() => run((c) => c.toggleHeading({ level: 1 }).run())}>
          H1
        </RibbonButton>
        <RibbonButton label="Heading 2" onClick={() => run((c) => c.toggleHeading({ level: 2 }).run())}>
          H2
        </RibbonButton>
        <RibbonButton label="Heading 3" onClick={() => run((c) => c.toggleHeading({ level: 3 }).run())}>
          H3
        </RibbonButton>
        <RibbonButton label="Quote" onClick={() => run((c) => c.toggleBlockquote().run())}>
          "
        </RibbonButton>
        <RibbonButton label="Code" onClick={() => run((c) => c.toggleCode().run())}>
          {'</>'}
        </RibbonButton>
      </div>
    </div>
  )
}

/** Plugin ribbon groups for the active tab (DESIGN.md §9.2 `registerRibbonGroup`) — empty until Phase 7. */
function PluginRibbonGroups({ ribbonTab }: { ribbonTab: RibbonTab }) {
  const groups = useExtensionRegistry((s) => s.ribbonGroups)
  const forThisTab = Object.values(groups).filter((g) => g.ribbonTab === ribbonTab)
  if (forThisTab.length === 0) return null
  return (
    <div className="flex items-center gap-2 border-l border-gray-200 pl-2 dark:border-gray-700">
      {forThisTab.map((g) => (
        <div key={`${g.pluginId}/${g.id}`} className="flex items-center gap-1" role="group" aria-label={g.label}>
          <span className="text-xs text-gray-400">{g.label}</span>
          {g.buttons.map((b) => (
            <RibbonButton key={b.id} label={b.label} onClick={() => sendRibbonAction(g.pluginId, g.id, b.id)}>
              {b.label}
            </RibbonButton>
          ))}
        </div>
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

// DESIGN.md §5.3 View row: "Ruler · Dot-grid overlay · Zoom in/out" — only
// Zoom is built here (Phase 6); Ruler/Dot-grid are pure visual overlays
// with no functional dependency on anything else and are deferred rather
// than rushed.
function ViewToolsPanel() {
  const zoom = useUIStore((s) => s.zoom)
  const zoomIn = useUIStore((s) => s.zoomIn)
  const zoomOut = useUIStore((s) => s.zoomOut)
  const resetZoom = useUIStore((s) => s.resetZoom)

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Zoom">
      <RibbonButton label="Zoom out" onClick={zoomOut}>
        −
      </RibbonButton>
      <button
        type="button"
        aria-label="Reset zoom"
        title="Reset zoom"
        onClick={resetZoom}
        className="min-w-[3.5rem] rounded px-1.5 py-1 text-center text-xs text-gray-700 tabular-nums hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        {Math.round(zoom * 100)}%
      </button>
      <RibbonButton label="Zoom in" onClick={zoomIn}>
        +
      </RibbonButton>
      <span className="ml-1 text-[10px] text-gray-400">
        {Math.round(MIN_ZOOM * 100)}–{Math.round(MAX_ZOOM * 100)}%
      </span>
    </div>
  )
}

// DESIGN.md §10 "Ollama availability" + Phase 6 "Ollama integration":
// streaming tokens into the active segment via `ipc.aiComplete()` needs a
// running Ollama this environment doesn't have — what's built here is the
// graceful-unavailable path DESIGN.md calls for (no adapter/backend
// implementation yet, no crash either): the prompt UI, dispatch through
// `getActiveEditor()` exactly like every other ribbon command, and a
// friendly status message instead of an unhandled rejection when
// `aiComplete()` rejects (which — no Ollama, no sidecar implementation yet
// — it always does right now). The actual token-streaming integration is
// real follow-up work, not stubbed out here.
function AIInsertPanel() {
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const generate = async () => {
    const editor = getActiveEditor()
    if (!editor) {
      setStatus('Select a segment first.')
      return
    }
    const ipc = getIPCAdapter()
    if (!ipc) {
      setStatus('AI unavailable — no backend connected.')
      return
    }
    if (!prompt.trim()) return

    setStatus('Generating…')
    try {
      const context = editor.getText()
      for await (const token of ipc.aiComplete(prompt, context)) {
        editor.chain().focus().insertContent(token).run()
      }
      setStatus(null)
      setPrompt('')
    } catch {
      // DESIGN.md §10 "Ollama availability": graceful unavailable state,
      // not a crash or an unhandled rejection.
      setStatus("AI unavailable — Ollama isn't running.")
    }
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="AI">
      <input
        aria-label="AI prompt"
        placeholder="Ask AI…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') generate()
        }}
        className="w-40 rounded border border-gray-300 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
      />
      <RibbonButton label="Generate with AI" onClick={generate}>
        Generate
      </RibbonButton>
      {status && (
        <span role="status" className="text-xs text-gray-400">
          {status}
        </span>
      )}
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
        {activeTab === 'Draw' ? (
          <DrawToolsPanel />
        ) : activeTab === 'Home' ? (
          <HomeToolsPanel />
        ) : activeTab === 'View' ? (
          <ViewToolsPanel />
        ) : activeTab === 'Insert' ? (
          <AIInsertPanel />
        ) : (
          <span className="text-xs text-gray-400">{activeTab} tools</span>
        )}
        <PluginRibbonGroups ribbonTab={activeTab} />
      </div>
    </header>
  )
}
