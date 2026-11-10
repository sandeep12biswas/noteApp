// `/` block picker — DESIGN.md §4.4. Opens only when the current line is
// exactly "/" (empty-line-start rule, enforced by the caller in
// `SegmentHost`); core block types render first, then a "Plugins" section
// populated from `ExtensionPointRegistry.slashCommands` (empty until
// Phase 7's `PluginIPCBridge` wires `registerSlashCommand` — DESIGN.md §9.2).
//
// Keyboard (issue #8): the menu opens while the user is typing, so focus
// stays in the editor and the editor forwards ArrowUp/ArrowDown/Enter/
// Escape here (`SegmentHost`'s `handleKeyDown`). `activeIndex` is the
// highlighted item, owned by the host so its key handler can apply it.
// Tabbing into the menu and moving focus with the arrows still works too.
import { useEffect, useRef } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { useExtensionRegistry } from '../store/extensionRegistry'

export interface CoreBlockOption {
  id: string
  label: string
}

export const CORE_BLOCK_OPTIONS: CoreBlockOption[] = [
  { id: 'paragraph', label: 'Text' },
  { id: 'heading1', label: 'Heading 1' },
  { id: 'heading2', label: 'Heading 2' },
  { id: 'heading3', label: 'Heading 3' },
  { id: 'bulletList', label: 'Bulleted list' },
  { id: 'orderedList', label: 'Numbered list' },
  { id: 'taskList', label: 'Checklist' },
  { id: 'blockquote', label: 'Quote' },
  { id: 'codeBlock', label: 'Code block' },
  // Opens a rows × columns picker (layout/TableSizePicker.tsx) — issue #37.
  { id: 'table', label: 'Table…' },
  // Opens SegmentHost's AI prompt box; the answer arrives as a draft to
  // keep or discard (aiDraftExtension.ts).
  { id: 'ai', label: 'Ask AI…' },
]

export type SlashMenuItem =
  | { kind: 'core'; id: string; label: string }
  | { kind: 'plugin'; pluginId: string; id: string; label: string }

/** Every item in the menu, in display order: core block types, then plugin commands. */
export function slashMenuItems(pluginCommands: Record<string, { pluginId: string; id: string; label: string }>): SlashMenuItem[] {
  return [
    ...CORE_BLOCK_OPTIONS.map((o): SlashMenuItem => ({ kind: 'core', id: o.id, label: o.label })),
    ...Object.values(pluginCommands).map((c): SlashMenuItem => ({ kind: 'plugin', pluginId: c.pluginId, id: c.id, label: c.label })),
  ]
}

const ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
const ACTIVE_CLASS = ' bg-gray-100 dark:bg-gray-800'

export function SlashMenu({
  x,
  y,
  activeIndex = 0,
  onActiveIndexChange,
  disabledIds = [],
  onSelectCore,
  onSelectPlugin,
  onClose,
}: {
  x: number
  y: number
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
  /** Core items shown but not selectable right now (e.g. "Ask AI" while a draft is open). */
  disabledIds?: readonly string[]
  onSelectCore: (id: string) => void
  onSelectPlugin: (pluginId: string, id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const pluginCommands = useExtensionRegistry((s) => s.slashCommands)
  useMenuKeyboardNav(ref, { autoFocus: false })

  // Keep the highlighted item visible when the arrows move past the menu's
  // scroll area. (`scrollIntoView` is missing in jsdom.)
  useEffect(() => {
    const el = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[activeIndex]
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const pluginList = Object.values(pluginCommands)

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Insert block"
      className="fixed z-50 max-h-72 w-56 overflow-y-auto rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      style={{ left: x, top: y }}
      // Issue #4: a mousedown on a menu item would move DOM focus off the
      // editor, and TipTap's `focus()` only restores it a frame later, so
      // anything typed straight after the click was lost. Cancelling the
      // mousedown keeps focus (and the caret) in the editor throughout; the
      // click still fires and selects the item.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {CORE_BLOCK_OPTIONS.map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          role="menuitem"
          data-active={i === activeIndex || undefined}
          disabled={disabledIds.includes(opt.id)}
          onClick={() => onSelectCore(opt.id)}
          onMouseEnter={() => onActiveIndexChange?.(i)}
          className={ITEM_CLASS + (i === activeIndex ? ACTIVE_CLASS : '') + ' disabled:cursor-not-allowed disabled:opacity-40'}
        >
          {opt.label}
        </button>
      ))}
      {pluginList.length > 0 && (
        <>
          <div className="mt-1 border-t border-gray-100 px-3 pt-1 text-[10px] font-semibold uppercase text-gray-400 dark:border-gray-800">
            Plugins
          </div>
          {pluginList.map((cmd, j) => {
            const i = CORE_BLOCK_OPTIONS.length + j
            return (
            <button
              key={`${cmd.pluginId}/${cmd.id}`}
              type="button"
              role="menuitem"
              data-active={i === activeIndex || undefined}
              onClick={() => onSelectPlugin(cmd.pluginId, cmd.id)}
              onMouseEnter={() => onActiveIndexChange?.(i)}
              className={ITEM_CLASS + (i === activeIndex ? ACTIVE_CLASS : '')}
            >
              {cmd.label}
            </button>
            )
          })}
        </>
      )}
    </div>
  )
}
