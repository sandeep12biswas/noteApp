// Shared by `CanvasRoot` and `LinearRoot`: whenever any segment's text
// changes, re-combine every segment's text for the page into
// `notebookStore.updateFileContent` so DESIGN.md §2.2's file-panel content
// search stays live regardless of which mode the page is being edited in.
import { useCallback } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'
import { segmentText } from './segmentText'

export function useSyncFileContent(pageId: string): (segmentId: string, text: string) => void {
  const updateFileContent = useNotebookStore((s) => s.updateFileContent)

  return useCallback(
    (_segmentId: string, _text: string) => {
      const allText = Object.values(useCanvasStore.getState().segments)
        .filter((s) => s.pageId === pageId)
        .map((s) => segmentText(s.content))
        .join('\n')
      updateFileContent(pageId, allText)
    },
    [pageId, updateFileContent],
  )
}
