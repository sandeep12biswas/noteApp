// Canvas surface — DESIGN.md §4.1, §8.1 "CanvasRoot, SegmentHost". Click
// anywhere empty to create a segment at that point via `findFreePosition()`
// (DESIGN.md §4.6); each segment renders as a `SegmentHost`. Segment text is
// mirrored into `notebookStore`'s `FileEntry.content` so the existing
// filename/content search (DESIGN.md §2.2) keeps working without a direct
// dependency between the two stores.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findFreePosition } from '../lib/collision'
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
  const zoom = useUIStore((s) => s.zoom)
  const handleTextChange = useSyncFileContent(pageId)

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
      const existing = aabbsForPage(pageId)
      const { x, y } = findFreePosition(rawX, rawY, DEFAULT_SEGMENT_WIDTH, DEFAULT_SEGMENT_HEIGHT, existing)
      createSegment(pageId, x, y)
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
