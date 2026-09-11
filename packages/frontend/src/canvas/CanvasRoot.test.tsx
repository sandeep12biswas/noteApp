import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'
import { useUIStore } from '../store/uiStore'

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
  })
  useUIStore.setState({ zoom: 1 })
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

describe('CanvasRoot zoom (Phase 6, DESIGN.md §10 "Zoom corrects AABB coordinates")', () => {
  it('divides the click position by the current zoom before creating a segment', () => {
    useUIStore.setState({ zoom: 2 })
    render(<CanvasRoot pageId="page-1" />)

    const el = screen.getByTestId('canvas-root')
    el.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect
    fireEvent.click(el, { clientX: 200, clientY: 100 })

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments).toHaveLength(1)
    // On-screen (200, 100) at 2x zoom is local canvas coordinate (100, 50).
    expect(segments[0]?.x).toBe(100)
    expect(segments[0]?.y).toBe(50)
  })

  it('applies a CSS scale transform matching the zoom level', () => {
    useUIStore.setState({ zoom: 1.5 })
    render(<CanvasRoot pageId="page-1" />)
    expect(screen.getByTestId('canvas-root')).toHaveStyle({ transform: 'scale(1.5)' })
  })

  it('applies no transform at the default zoom', () => {
    render(<CanvasRoot pageId="page-1" />)
    expect(screen.getByTestId('canvas-root').style.transform).toBe('')
  })
})
