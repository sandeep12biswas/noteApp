// Canvas surface — DESIGN.md §4.1, §8.1 "CanvasRoot, SegmentHost". Click
// anywhere empty to create a segment at that point via `findFreePosition()`
// (DESIGN.md §4.6); each segment renders as a `SegmentHost`. Segment text is
// mirrored into `notebookStore`'s `FileEntry.content` so the existing
// filename/content search (DESIGN.md §2.2) keeps working without a direct
// dependency between the two stores.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findFreePosition } from '../lib/collision'
import { DEFAULT_SEGMENT_HEIGHT, DEFAULT_SEGMENT_WIDTH, useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'
import { SegmentHost } from './SegmentHost'

export function CanvasRoot({ pageId }: { pageId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const segments = useCanvasStore((s) => s.segments)
  const createSegment = useCanvasStore((s) => s.createSegment)
  const setActiveSegment = useCanvasStore((s) => s.setActiveSegment)
  const aabbsForPage = useCanvasStore((s) => s.aabbsForPage)
  const loadSegmentsForPage = useCanvasStore((s) => s.loadSegmentsForPage)
  const updateFileContent = useNotebookStore((s) => s.updateFileContent)

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
      const rawX = e.clientX - rect.left
      const rawY = e.clientY - rect.top
      const existing = aabbsForPage(pageId)
      const { x, y } = findFreePosition(rawX, rawY, DEFAULT_SEGMENT_WIDTH, DEFAULT_SEGMENT_HEIGHT, existing)
      createSegment(pageId, x, y)
    },
    [aabbsForPage, createSegment, pageId],
  )

  const handleTextChange = useCallback(
    (_segmentId: string, _text: string) => {
      // Combine all segments' text for this page into the file's searchable content.
      const allText = Object.values(useCanvasStore.getState().segments)
        .filter((s) => s.pageId === pageId)
        .map((s) => segmentText(s.content))
        .join('\n')
      updateFileContent(pageId, allText)
    },
    [pageId, updateFileContent],
  )

  return (
    <div
      ref={containerRef}
      data-testid="canvas-root"
      className="relative h-full min-h-[600px] w-full"
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

function segmentText(content: Record<string, unknown>): string {
  const nodes = (content as { content?: { content?: { text?: string }[] }[] }).content ?? []
  return nodes
    .flatMap((n) => n.content ?? [])
    .map((n) => n.text ?? '')
    .join(' ')
}
