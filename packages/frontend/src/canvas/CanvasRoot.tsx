// Canvas surface — DESIGN.md §4.1, §8.1 "CanvasRoot, SegmentHost". Click
// anywhere empty to create a segment at that point via `findFreePosition()`
// (DESIGN.md §4.6); each segment renders as a `SegmentHost`. Segment text is
// mirrored into `notebookStore`'s `FileEntry.content` so the existing
// filename/content search (DESIGN.md §2.2) keeps working without a direct
// dependency between the two stores.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findFreePosition } from '../lib/collision'
import { applyFormat } from '../lib/formatPainter'
import { DEFAULT_SEGMENT_HEIGHT, DEFAULT_SEGMENT_WIDTH, useCanvasStore } from '../store/canvasStore'
import { useUIStore } from '../store/uiStore'
import { SegmentHost } from './SegmentHost'
import { useSyncFileContent } from './useSyncFileContent'

export function CanvasRoot({ pageId }: { pageId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const segments = useCanvasStore((s) => s.segments)
  const createSegment = useCanvasStore((s) => s.createSegment)
  const setActiveSegment = useCanvasStore((s) => s.setActiveSegment)
  const aabbsForPage = useCanvasStore((s) => s.aabbsForPage)
  const loadSegmentsForPage = useCanvasStore((s) => s.loadSegmentsForPage)
  const getActiveEditor = useCanvasStore((s) => s.getActiveEditor)
  const zoom = useUIStore((s) => s.zoom)
  const formatPainter = useUIStore((s) => s.formatPainter)
  const disarmFormatPainter = useUIStore((s) => s.disarmFormatPainter)
  const handleTextChange = useSyncFileContent(pageId)

  // Format Painter's "paint the next selection" half (RibbonRoot.tsx's
  // button captures the format; this applies it) — a pointerup here catches
  // the end of a text-selection drag no matter which segment/editor it
  // happened in, since `getActiveEditor()` always resolves to whichever
  // segment last received focus (SegmentHost.tsx's `onFocus`). Not armed,
  // or nothing selected: no-op. Single-shot mode disarms after one
  // application; sticky mode (double-click to arm) stays armed for
  // painting several spots until Escape or the button again.
  const handleFormatPainterApply = useCallback(() => {
    if (!formatPainter.armed || !formatPainter.format) return
    const editor = getActiveEditor()
    if (!editor || editor.state.selection.empty) return
    applyFormat(editor, formatPainter.format)
    if (!formatPainter.sticky) disarmFormatPainter()
  }, [formatPainter, getActiveEditor, disarmFormatPainter])

  const pageSegments = useMemo(() => Object.values(segments).filter((s) => s.pageId === pageId), [segments, pageId])

  // Loads this page's persisted segments the first time it's opened
  // ("IPCAdapter calls wired", EXECUTION_PLAN.md Phase 2). No-op when no
  // IPCAdapter is wired (see App.tsx) or once segments are already local.
  useEffect(() => {
    loadSegmentsForPage(pageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== containerRef.current) return
      const rect = containerRef.current!.getBoundingClientRect()
      // `rect` reflects the on-screen (post-`transform: scale(zoom)`) box —
      // dividing by `zoom` converts the click back into the same unscaled
      // coordinate space `segment.x/y` is stored in (DESIGN.md §10 "Zoom
      // corrects AABB coordinates").
      const rawX = (e.clientX - rect.left) / zoom
      const rawY = (e.clientY - rect.top) / zoom
      // Default width: half the editor pane's own (unscaled) width, not a
      // fixed pixel constant — falls back to `DEFAULT_SEGMENT_WIDTH` only
      // when the container hasn't actually been laid out yet (0 width; true
      // in jsdom tests that don't stub `getBoundingClientRect`). Height
      // stays `DEFAULT_SEGMENT_HEIGHT` (the natural one-line minimum) —
      // there's no content yet to measure a taller starting height from, and
      // the segment grows from there as text is typed.
      const paneWidth = rect.width / zoom
      const width = paneWidth > 0 ? paneWidth * 0.5 : DEFAULT_SEGMENT_WIDTH
      const existing = aabbsForPage(pageId)
      const { x, y } = findFreePosition(rawX, rawY, width, DEFAULT_SEGMENT_HEIGHT, existing)
      createSegment(pageId, x, y, width, DEFAULT_SEGMENT_HEIGHT)
    },
    [aabbsForPage, createSegment, pageId, zoom],
  )

  return (
    <div
      ref={containerRef}
      data-testid="canvas-root"
      className="relative h-full min-h-[600px] w-full origin-top-left"
      style={{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
      onClick={handleCanvasClick}
      onMouseDown={(e) => {
        if (e.target === containerRef.current) setActiveSegment(null)
      }}
      onPointerUp={handleFormatPainterApply}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && formatPainter.armed) disarmFormatPainter()
      }}
    >
      {pageSegments.length === 0 && (
        <div className="pointer-events-none flex h-full items-center justify-center text-sm text-gray-400">
          Click anywhere to start writing
        </div>
      )}
      {pageSegments.map((segment) => (
        <SegmentHost key={segment.id} segment={segment} onTextChange={handleTextChange} />
      ))}
    </div>
  )
}
