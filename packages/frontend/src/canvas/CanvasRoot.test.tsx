import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('CanvasRoot', () => {
  it('shows the empty-canvas hint when there are no segments', () => {
    render(<CanvasRoot pageId="page-1" />)
    expect(screen.getByText('Click anywhere to start writing')).toBeInTheDocument()
  })

  it('creates a segment where the canvas is clicked', () => {
    render(<CanvasRoot pageId="page-1" />)
    fireEvent.click(screen.getByTestId('canvas-root'))

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.pageId).toBe('page-1')
  })

  it('places a second segment clear of the first (8px min gap)', () => {
    useCanvasStore.getState().createSegment('page-1', 0, 0)
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.click(screen.getByTestId('canvas-root'), { clientX: 0, clientY: 0 })

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments).toHaveLength(2)
    const [first, second] = segments
    if (!first || !second) throw new Error('expected two segments')
    const verticallyClear = second.y >= first.y + first.h + 8
    expect(verticallyClear).toBe(true)
  })
})
