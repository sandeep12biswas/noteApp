import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCanvasStore, type Segment } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'
import { CanvasRoot } from './CanvasRoot'
import { LinearRoot } from './LinearRoot'

const seg = (id: string, y: number): Segment => ({
  id, pageId: 'page-1', x: 0, y, w: 200, h: 40, zIndex: 0, borderColor: null, fillColor: null,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] }, createdAt: 0, updatedAt: 0,
})

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ activeSegmentId: null, segments: { a: seg('a', 0), 'segment-conflict-abc': seg('segment-conflict-abc', 100) } })
  useNotebookStore.setState({ files: { 'page-1': { id: 'page-1', name: 'T', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas', background: null } } })
})

describe.each([
  ['canvas', CanvasRoot],
  ['linear', LinearRoot],
])('conflict copies in %s mode', (_mode, Root) => {
  it('carry a badge; other segments do not', () => {
    render(<Root pageId="page-1" />)
    expect(screen.getByTestId('segment-segment-conflict-abc-conflict-badge')).toHaveTextContent('Conflict copy')
    expect(screen.queryByTestId('segment-a-conflict-badge')).not.toBeInTheDocument()
  })
})
