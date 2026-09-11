// DESIGN.md §4.1: clicking empty canvas creates a segment and the user
// should be able to type immediately — a newly-created (active) segment
// must receive DOM focus without a second click.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'

afterEach(cleanup)
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
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

describe('SegmentHost colour menu (DESIGN.md §4.2)', () => {
  it('right-click opens the colour menu and picking a swatch persists it and prevents auto-delete', async () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    render(<CanvasRoot pageId="page-1" />)

    const el = screen.getByTestId(`segment-${id}`)
    fireEvent.contextMenu(el)

    const menu = await screen.findByRole('menu', { name: 'Segment colour' })
    const swatch = within(menu).getByRole('menuitemradio', { name: 'Colour #dc2626' })
    fireEvent.click(swatch)

    await waitFor(() => {
      const seg = useCanvasStore.getState().segments[id]
      expect(seg?.borderColor).toBe('#dc2626')
      expect(seg?.fillColor).toBe('rgba(220, 38, 38, 0.08)')
    })

    // Coloured + empty must survive blur (DESIGN.md §4.2 "never auto-delete").
    useCanvasStore.getState().deleteIfEmptyAndUncolored(id)
    expect(useCanvasStore.getState().segments[id]).toBeDefined()
  })

  it('"None" clears the colour', async () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    useCanvasStore.getState().setSegmentColor(id, '#dc2626', 'rgba(220, 38, 38, 0.08)')
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.contextMenu(screen.getByTestId(`segment-${id}`))
    const menu = await screen.findByRole('menu', { name: 'Segment colour' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'None' }))

    await waitFor(() => expect(useCanvasStore.getState().segments[id]?.borderColor).toBeNull())
  })
})

describe('SlashMenu (DESIGN.md §4.4)', () => {
  it('opens only when "/" is the sole content of the current (empty) line, and applies the chosen block type', async () => {
    const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()

    const editable = screen.getByRole('textbox', { name: 'Segment' }).querySelector('[contenteditable="true"]') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(editable))

    expect(screen.queryByRole('menu', { name: 'Insert block' })).not.toBeInTheDocument()

    await user.type(editable, '/')
    const menu = await screen.findByRole('menu', { name: 'Insert block' })

    await user.click(within(menu).getByRole('menuitem', { name: 'Heading 1' }))

    await waitFor(() => {
      const content = useCanvasStore.getState().segments[id]?.content as { content?: { type?: string }[] }
      expect(content.content?.[0]?.type).toBe('heading')
    })
    expect(screen.queryByRole('menu', { name: 'Insert block' })).not.toBeInTheDocument()
  })

  it('typing past "/" (no longer the sole content) closes the menu', async () => {
    useCanvasStore.getState().createSegment('page-1', 0, 0)
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()

    const editable = screen.getByRole('textbox', { name: 'Segment' }).querySelector('[contenteditable="true"]') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(editable))

    await user.type(editable, '/x')
    expect(screen.queryByRole('menu', { name: 'Insert block' })).not.toBeInTheDocument()
  })
})
