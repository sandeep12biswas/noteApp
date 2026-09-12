import { Editor } from '@tiptap/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import type { CapturedFormat } from '../lib/formatPainter'
import { DEFAULT_SEGMENT_HEIGHT, DEFAULT_SEGMENT_WIDTH, useCanvasStore } from '../store/canvasStore'
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

  it('defaults a new segment to half the editor pane width, not a fixed pixel constant', () => {
    render(<CanvasRoot pageId="page-1" />)
    const el = screen.getByTestId('canvas-root')
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900 }) as DOMRect

    fireEvent.click(el)

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments[0]?.w).toBe(450)
  })

  it('falls back to DEFAULT_SEGMENT_WIDTH when the pane has no measurable width yet', () => {
    render(<CanvasRoot pageId="page-1" />)
    const el = screen.getByTestId('canvas-root')
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0 }) as DOMRect

    fireEvent.click(el)

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments[0]?.w).toBe(DEFAULT_SEGMENT_WIDTH)
  })

  it('defaults a new segment to the one-line minimum height', () => {
    render(<CanvasRoot pageId="page-1" />)
    fireEvent.click(screen.getByTestId('canvas-root'))

    const segments = Object.values(useCanvasStore.getState().segments)
    expect(segments[0]?.h).toBe(DEFAULT_SEGMENT_HEIGHT)
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

describe('Format Painter (RibbonRoot arms it, CanvasRoot applies it on pointerup)', () => {
  const boldRedFormat: CapturedFormat = {
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    subscript: false,
    superscript: false,
    fontFamily: null,
    fontSize: null,
    color: '#ff0000',
    highlightColor: null,
    textAlign: null,
  }

  let editor: Editor
  beforeEach(() => {
    editor = new Editor({ extensions: segmentEditorExtensions, content: '<p>Hello world</p>' })
    useCanvasStore.getState().registerEditor('seg-1', editor)
    useCanvasStore.getState().setActiveSegment('seg-1')
    useUIStore.setState({ formatPainter: { armed: false, sticky: false, format: null } })
  })
  afterEach(() => {
    useCanvasStore.getState().unregisterEditor('seg-1')
    editor.destroy()
  })

  it('applies the armed format to the active editor\'s selection on pointerup, then disarms (non-sticky)', () => {
    editor.commands.setTextSelection({ from: 1, to: 6 }) // "Hello"
    useUIStore.getState().armFormatPainter(boldRedFormat, false)
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.pointerUp(screen.getByTestId('canvas-root'))

    expect(editor.isActive('bold')).toBe(true)
    expect(editor.getAttributes('textStyle').color).toBe('#ff0000')
    expect(useUIStore.getState().formatPainter.armed).toBe(false)
  })

  it('stays armed after applying when sticky, for painting more than one spot', () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    useUIStore.getState().armFormatPainter(boldRedFormat, true)
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.pointerUp(screen.getByTestId('canvas-root'))

    expect(editor.isActive('bold')).toBe(true)
    expect(useUIStore.getState().formatPainter.armed).toBe(true)
  })

  it('does nothing when the active editor has no selection (collapsed cursor)', () => {
    useUIStore.getState().armFormatPainter(boldRedFormat, false)
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.pointerUp(screen.getByTestId('canvas-root'))

    expect(editor.isActive('bold')).toBe(false)
    expect(useUIStore.getState().formatPainter.armed).toBe(true)
  })

  it('Escape disarms without applying anything', () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    useUIStore.getState().armFormatPainter(boldRedFormat, true)
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.keyDown(screen.getByTestId('canvas-root'), { key: 'Escape' })

    expect(useUIStore.getState().formatPainter.armed).toBe(false)
    expect(editor.isActive('bold')).toBe(false)
  })
})
