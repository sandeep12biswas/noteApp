// DESIGN.md §4.1: clicking empty canvas creates a segment and the user
// should be able to type immediately — a newly-created (active) segment
// must receive DOM focus without a second click.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0 } },
  })
})

describe('SegmentHost autofocus', () => {
  it('focuses a newly created segment automatically', async () => {
    useCanvasStore.getState().createSegment('page-1', 0, 0)
    render(<CanvasRoot pageId="page-1" />)

    const editable = screen.getByRole('textbox', { name: 'Segment' }).querySelector('[contenteditable="true"]')
    await waitFor(() => expect(document.activeElement).toBe(editable))
  })
})
