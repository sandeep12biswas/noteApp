// Ribbon → View → "Page colour" (issue #11): the editor background in light
// mode, for this page (saved with it, syncs) or for all pages (a per-device
// default, store/editorBackgroundStore.ts).
import { useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { useNotebookStore } from '../store/notebookStore'
import { useThemeStore } from '../store/themeStore'
import { PAGE_BACKGROUND_PRESETS, useEditorBackgroundStore, useEffectiveBackground } from '../store/editorBackgroundStore'
import { CustomColorInput, MENU_TEXT_BUTTON_CLASSNAME, POPOVER_CLASSNAME, SwatchGrid, useDismiss } from './ColorPickerMenu'

export const DARK_THEME_TITLE = 'Page colours show in light mode'

const SECTION_HEADING = 'px-0.5 text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400'

function PageColorPopover({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref)
  useDismiss(ref, onClose)

  const fileId = useNotebookStore((s) => s.selectedFileId)
  const pageBackground = useNotebookStore((s) => (s.selectedFileId ? (s.files[s.selectedFileId]?.background ?? null) : null))
  const setFileBackground = useNotebookStore((s) => s.setFileBackground)
  const defaultBackground = useEditorBackgroundStore((s) => s.defaultBackground)
  const setDefaultBackground = useEditorBackgroundStore((s) => s.setDefaultBackground)

  const setPage = (color: string | null) => {
    if (fileId) setFileBackground(fileId, color)
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Page colour"
      className={POPOVER_CLASSNAME + ' w-52'}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {fileId && (
        <div className="flex flex-col gap-1">
          <span className={SECTION_HEADING}>This page</span>
          <SwatchGrid
            label="This page"
            colors={PAGE_BACKGROUND_PRESETS}
            activeColor={pageBackground}
            onPick={(color) => {
              setPage(color)
              onClose()
            }}
          />
          <CustomColorInput
            label="Custom colour for this page"
            value={pageBackground ?? defaultBackground ?? '#ffffff'}
            onPick={setPage}
          />
          <button
            type="button"
            role="menuitem"
            disabled={pageBackground === null}
            onClick={() => {
              setPage(null)
              onClose()
            }}
            className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}
          >
            Use default
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className={SECTION_HEADING}>All pages (default)</span>
        <SwatchGrid
          label="All pages"
          colors={PAGE_BACKGROUND_PRESETS}
          activeColor={defaultBackground}
          onPick={(color) => {
            // White is the same as no default: keep the stored value null.
            setDefaultBackground(color === '#ffffff' ? null : color)
            onClose()
          }}
        />
        <CustomColorInput
          label="Custom default page colour"
          value={defaultBackground ?? '#ffffff'}
          onPick={setDefaultBackground}
        />
        <button
          type="button"
          role="menuitem"
          disabled={defaultBackground === null}
          onClick={() => {
            setDefaultBackground(null)
            onClose()
          }}
          className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}
        >
          White
        </button>
      </div>
    </div>
  )
}

export function PageColorButton() {
  const isDark = useThemeStore((s) => s.isDark)
  const background = useEffectiveBackground() ?? '#ffffff'
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="flex items-center" role="group" aria-label="Page colour">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Page colour"
        aria-haspopup="menu"
        title={isDark ? DARK_THEME_TITLE : 'Page colour'}
        disabled={isDark}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect()
          setMenu(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 })
        }}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <span
          data-testid="page-colour-swatch"
          className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600"
          style={{ backgroundColor: background }}
        />
        Page colour
        <span className="text-[10px] text-gray-400">▾</span>
      </button>
      {menu && !isDark && <PageColorPopover x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}
