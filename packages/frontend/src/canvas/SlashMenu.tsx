// `/` block picker — DESIGN.md §4.4. Opens only when the current line is
// exactly "/" (empty-line-start rule, enforced by the caller in
// `SegmentHost`); core block types render first, then a "Plugins" section
// populated from `ExtensionPointRegistry.slashCommands` (empty until
// Phase 7's `PluginIPCBridge` wires `registerSlashCommand` — DESIGN.md §9.2).
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
]

export function SlashMenu({
  x,
  y,
  onSelectCore,
  onSelectPlugin,
  onClose,
}: {
  x: number
  y: number
  onSelectCore: (id: string) => void
  onSelectPlugin: (pluginId: string, id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const pluginCommands = useExtensionRegistry((s) => s.slashCommands)
  useMenuKeyboardNav(ref, { autoFocus: false })

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
      className="fixed z-50 max-h-72 w-56 overflow-y-auto rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {CORE_BLOCK_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="menuitem"
          onClick={() => onSelectCore(opt.id)}
          className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {opt.label}
        </button>
      ))}
      {pluginList.length > 0 && (
        <>
          <div className="mt-1 border-t border-gray-100 px-3 pt-1 text-[10px] font-semibold uppercase text-gray-400 dark:border-gray-800">
            Plugins
          </div>
          {pluginList.map((cmd) => (
            <button
              key={`${cmd.pluginId}/${cmd.id}`}
              type="button"
              role="menuitem"
              onClick={() => onSelectPlugin(cmd.pluginId, cmd.id)}
              className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {cmd.label}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
