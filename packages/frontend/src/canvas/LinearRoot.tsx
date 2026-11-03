// Linear document view — DESIGN.md §4.3 "Dual mode: canvas and linear".
// Same underlying segments as `CanvasRoot` (same `canvasStore.segments`,
// same `loadSegmentsForPage`), rendered instead as a top-to-bottom reading
// order: sorted by `(y, x)` so switching modes preserves the visual
// top-to-bottom, left-to-right order the canvas already implied, with no
// data loss either way (EXECUTION_PLAN.md Phase 5 exit criteria) — mode is
// purely which component reads `segments`, never a second copy of it.
import { useEffect, useMemo } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { LinearSegmentHost } from './LinearSegmentHost'
import { useSyncFileContent } from './useSyncFileContent'

export function LinearRoot({ pageId }: { pageId: string }) {
  const segments = useCanvasStore((s) => s.segments)
  const loadSegmentsForPage = useCanvasStore((s) => s.loadSegmentsForPage)
  const handleTextChange = useSyncFileContent(pageId)

  useEffect(() => {
    loadSegmentsForPage(pageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  const pageSegments = useMemo(
    () =>
      Object.values(segments)
        .filter((s) => s.pageId === pageId)
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [segments, pageId],
  )

  return (
    <div data-testid="linear-root" className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-4">
      {pageSegments.length === 0 && <div className="text-sm text-gray-400">No content yet.</div>}
      {pageSegments.map((segment) => (
        <LinearSegmentHost key={segment.id} segment={segment} onTextChange={handleTextChange} />
      ))}
    </div>
  )
}
