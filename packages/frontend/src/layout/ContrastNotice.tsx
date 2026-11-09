// Notice bar under the page title when coloured text on the open page is
// hard to read on its background (issue #12). Light mode only; never changes
// anything without the user choosing Adjust.
import { useEffect, useMemo, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useThemeStore } from '../store/themeStore'
import { adjustClashesInEditor, clashingElements, findClashes, type Clash } from '../canvas/textColorClashes'

const RECHECK_DELAY_MS = 300
const FLASH_MS = 2000

export function keptKey(pageId: string, background: string): string {
  return `flownote:contrast-kept:${pageId}:${background}`
}

function isKept(pageId: string, background: string): boolean {
  try {
    return localStorage.getItem(keptKey(pageId, background)) === '1'
  } catch {
    return false
  }
}

function plural(n: number): string {
  return n === 1 ? '1 coloured passage is' : `${n} coloured passages are`
}

export function ContrastNotice({ pageId, background }: { pageId: string; background: string }) {
  const isDark = useThemeStore((s) => s.isDark)
  const allSegments = useCanvasStore((s) => s.segments)
  const segments = useMemo(() => Object.values(allSegments).filter((s) => s.pageId === pageId), [allSegments, pageId])
  const [clashes, setClashes] = useState<Clash[]>([])
  const [kept, setKept] = useState(() => isKept(pageId, background))

  useEffect(() => setKept(isKept(pageId, background)), [pageId, background])

  // Re-check shortly after the page, background or text changes, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setClashes(findClashes(segments, background)), RECHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [segments, background])

  if (isDark || kept || clashes.length === 0) return null

  const editorsWithClashes = () => {
    const { editorRefs } = useCanvasStore.getState()
    return [...new Set(clashes.map((c) => c.segmentId))].flatMap((id) => {
      const editor = editorRefs.get(id)
      return editor ? [editor] : []
    })
  }

  const adjust = () => {
    for (const editor of editorsWithClashes()) adjustClashesInEditor(editor, background)
  }

  const keep = () => {
    try {
      localStorage.setItem(keptKey(pageId, background), '1')
    } catch {
      // Storage blocked: dismissed for this session only.
    }
    setKept(true)
  }

  const showMe = () => {
    const elements = editorsWithClashes().flatMap((editor) => clashingElements(editor, background))
    for (const el of elements) el.classList.add('contrast-flash')
    elements[0]?.scrollIntoView?.({ block: 'nearest' })
    setTimeout(() => elements.forEach((el) => el.classList.remove('contrast-flash')), FLASH_MS)
  }

  const button =
    'rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600'

  return (
    <div
      role="status"
      data-testid="contrast-notice"
      className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-xs text-amber-900"
    >
      <span className="flex-1">{plural(clashes.length)} hard to read on this background</span>
      <button type="button" className={button} onClick={adjust}>
        Adjust
      </button>
      <button type="button" className={button} onClick={showMe}>
        Show me
      </button>
      <button type="button" className={button} onClick={keep}>
        Keep
      </button>
    </div>
  )
}
