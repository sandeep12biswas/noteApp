// DESIGN.md §4.3 "switchable without data loss" — same underlying
// `canvasStore.segments`, just rendered top-to-bottom by `(y, x)` instead of
// positioned absolutely (EXECUTION_PLAN.md Phase 5 exit criteria).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LinearRoot } from './LinearRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'linear' } },
  })
})

describe('LinearRoot', () => {
  it('shows a placeholder when the page has no segments', () => {
    render(<LinearRoot pageId="page-1" />)
    expect(screen.getByText('No content yet.')).toBeInTheDocument()
  })

  it('renders every segment for the page, sorted top-to-bottom then left-to-right', () => {
    const store = useCanvasStore.getState()
    const bottom = store.createSegment('page-1', 0, 200)
    const topRight = store.createSegment('page-1', 300, 0)
    const topLeft = store.createSegment('page-1', 0, 0)

    render(<LinearRoot pageId="page-1" />)

    const rendered = screen.getAllByRole('textbox', { name: 'Segment' }).map((el) => el.dataset.testid)
    expect(rendered).toEqual([`linear-segment-${topLeft}`, `linear-segment-${topRight}`, `linear-segment-${bottom}`])
  })

  it('does not render segments belonging to a different page', () => {
    const store = useCanvasStore.getState()
    store.createSegment('other-page', 0, 0)
    render(<LinearRoot pageId="page-1" />)
    expect(screen.getByText('No content yet.')).toBeInTheDocument()
  })

  it('shows a coloured left border for a coloured segment', () => {
    const store = useCanvasStore.getState()
    const id = store.createSegment('page-1', 0, 0)
    store.setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')

    render(<LinearRoot pageId="page-1" />)
    expect(screen.getByTestId(`linear-segment-${id}`)).toHaveStyle({ borderColor: '#dc2626' })
  })
})
