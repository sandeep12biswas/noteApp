// Ribbon → View → "Page colour" (issue #11): the editor background in light
// mode, for this page (saved with it, syncs) or for all pages (a per-device
// default, store/editorBackgroundStore.ts). Any colour is allowed: the
// editor's text follows the background (issue #12).
//
// One palette, with an "Apply to" switch choosing the target: paper-tone
// quick picks, a darkest-to-lightest shade grid per hue, recently used
// wheel colours, and "More colours…" for the in-app colour wheel.
import { useRef, useState } from 'react'
import { useMenuKeyboardNav } from '../lib/useMenuKeyboardNav'
import { useNotebookStore } from '../store/notebookStore'
import { useThemeStore } from '../store/themeStore'
import {
  PAGE_BACKGROUND_PRESETS,
  PAGE_BACKGROUND_SHADES,
  PAGE_SHADE_NAMES,
  useEditorBackgroundStore,
  useEffectiveBackground,
} from '../store/editorBackgroundStore'
import { MENU_TEXT_BUTTON_CLASSNAME, POPOVER_CLASSNAME, SwatchGrid, useDismiss } from './ColorPickerMenu'
import { ShadeGrid } from './ShadeGrid'
import { ColorWheel } from './ColorWheel'

export const DARK_THEME_TITLE = 'Page colours show in light mode'

const SECTION_HEADING = 'px-0.5 text-[10px] font-medium text-gray-500 uppercase dark:text-gray-400'

type Target = 'page' | 'default'

const TARGET_LABEL: Record<Target, string> = { page: 'This page', default: 'All pages' }

function PageColorPopover({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useMenuKeyboardNav(ref)
  useDismiss(ref, onClose)

  const fileId = useNotebookStore((s) => s.selectedFileId)
  const pageBackground = useNotebookStore((s) => (s.selectedFileId ? (s.files[s.selectedFileId]?.background ?? null) : null))
  const setFileBackground = useNotebookStore((s) => s.setFileBackground)
  const defaultBackground = useEditorBackgroundStore((s) => s.defaultBackground)
  const setDefaultBackground = useEditorBackgroundStore((s) => s.setDefaultBackground)
  const recentBackgrounds = useEditorBackgroundStore((s) => s.recentBackgrounds)
  const addRecentBackground = useEditorBackgroundStore((s) => s.addRecentBackground)

  const [target, setTarget] = useState<Target>(fileId ? 'page' : 'default')
  const [wheelOpen, setWheelOpen] = useState(false)
  const moreColoursRef = useRef<HTMLButtonElement | null>(null)
  const label = TARGET_LABEL[target]
  const activeColor = target === 'page' ? pageBackground : defaultBackground

  const apply = (color: string | null) => {
    if (target === 'page') {
      if (fileId) setFileBackground(fileId, color)
    } else {
      // White is the same as no default: keep the stored value null.
      setDefaultBackground(color === '#ffffff' ? null : color)
    }
  }
  const pickAndClose = (color: string) => {
    apply(color)
    onClose()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Page colour"
      className={POPOVER_CLASSNAME + ' w-64'}
      // Taller than before (shade grid, wheel): scroll rather than run off a short window.
      style={{ left: x, top: y, maxHeight: `calc(100vh - ${y + 8}px)`, overflowY: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      {fileId ? (
        <div role="group" aria-label="Apply to" className="flex flex-col gap-1">
          <span className={SECTION_HEADING}>Apply to</span>
          <div className="grid grid-cols-2 gap-0.5 rounded bg-gray-100 p-0.5 dark:bg-gray-800">
            {(['page', 'default'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="menuitemradio"
                aria-checked={target === t}
                onClick={() => setTarget(t)}
                className={
                  'rounded px-2 py-1 text-xs ' +
                  (target === t
                    ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100')
                }
              >
                {TARGET_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <span className={SECTION_HEADING}>All pages (default)</span>
      )}

      {wheelOpen ? (
        <ColorWheel
          initialColor={activeColor ?? (target === 'page' ? defaultBackground : null) ?? '#ffffff'}
          onCancel={() => {
            setWheelOpen(false)
            requestAnimationFrame(() => moreColoursRef.current?.focus())
          }}
          onApply={(color) => {
            addRecentBackground(color)
            pickAndClose(color)
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className={SECTION_HEADING}>Paper</span>
            <SwatchGrid label={label} groupLabel={`${label} paper`} colors={PAGE_BACKGROUND_PRESETS} activeColor={activeColor} onPick={pickAndClose} />
          </div>
          <div className="flex flex-col gap-1">
            <span className={SECTION_HEADING}>Shades</span>
            <ShadeGrid label={label} hues={PAGE_BACKGROUND_SHADES} shadeNames={PAGE_SHADE_NAMES} activeColor={activeColor} onPick={pickAndClose} />
          </div>
          {recentBackgrounds.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={SECTION_HEADING}>Recent</span>
              <SwatchGrid
                label={`${label} recent`}
                groupLabel={`${label} recent colours`}
                colors={recentBackgrounds}
                activeColor={activeColor}
                onPick={pickAndClose}
              />
            </div>
          )}
          <div className="flex flex-col">
            <button ref={moreColoursRef} type="button" role="menuitem" onClick={() => setWheelOpen(true)} className={MENU_TEXT_BUTTON_CLASSNAME + ' flex items-center gap-1.5'}>
              <span
                aria-hidden
                className="h-4 w-4 rounded-full border border-black/30"
                style={{ background: 'conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
              />
              More colours…
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={activeColor === null}
              onClick={() => {
                apply(null)
                onClose()
              }}
              className={MENU_TEXT_BUTTON_CLASSNAME + ' disabled:opacity-40'}
            >
              {target === 'page' ? 'Use default' : 'White'}
            </button>
          </div>
        </>
      )}
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
