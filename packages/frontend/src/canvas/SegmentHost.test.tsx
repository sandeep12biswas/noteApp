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

describe('SegmentHost height tracking', () => {
  // Regression test for a real Phase 3 bug: ResizeObserver's `contentRect`
  // excludes padding/border, undercounting a segment's actual on-screen
  // footprint by ~10px (`px-2 py-1` + the 1px border) — every collision
  // function (overlaps/resolvePosition/clampResizeWidth) measures in the
  // same border-box terms `getBoundingClientRect()` returns, so that has to
  // be what feeds `segment.h`, not the observer's own contentRect.
  it('measures height via getBoundingClientRect (border-box), not ResizeObserver contentRect', async () => {
    let observerCallback: ResizeObserverCallback | undefined
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observerCallback = cb
      }
      observe = () => {}
      disconnect = () => {}
      unobserve = () => {}
    }
    const original = globalThis.ResizeObserver
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.ResizeObserver = FakeResizeObserver as any

    try {
      const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
      render(<CanvasRoot pageId="page-1" />)

      const el = screen.getByTestId(`segment-${id}`)
      el.getBoundingClientRect = () => ({ height: 50 }) as DOMRect // border-box height
      Object.defineProperty(el, 'contentRect', { value: { height: 40 } }) // what contentRect would say, if it mattered here

      observerCallback?.([{ contentRect: { height: 40 } } as ResizeObserverEntry], null as unknown as ResizeObserver)

      await waitFor(() => expect(useCanvasStore.getState().segments[id]?.h).toBe(50))
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})
