// Phase 6 "Zoom + dark mode" — DESIGN.md §5.3 View tab zoom in/out.
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, useUIStore } from './uiStore'

beforeEach(() => {
  useUIStore.setState({ zoom: 1 })
})

describe('zoomIn/zoomOut', () => {
  it('steps by 10% and clamps to [MIN_ZOOM, MAX_ZOOM]', () => {
    useUIStore.getState().zoomIn()
    expect(useUIStore.getState().zoom).toBeCloseTo(1.1)

    useUIStore.setState({ zoom: MAX_ZOOM })
    useUIStore.getState().zoomIn()
    expect(useUIStore.getState().zoom).toBe(MAX_ZOOM)

    useUIStore.setState({ zoom: MIN_ZOOM })
    useUIStore.getState().zoomOut()
    expect(useUIStore.getState().zoom).toBe(MIN_ZOOM)
  })
})

describe('resetZoom', () => {
  it('returns to 1', () => {
    useUIStore.setState({ zoom: 1.7 })
    useUIStore.getState().resetZoom()
    expect(useUIStore.getState().zoom).toBe(1)
  })
})

describe('Format Painter arm/disarm', () => {
  const sampleFormat = {
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

  beforeEach(() => {
    useUIStore.setState({ formatPainter: { armed: false, sticky: false, format: null } })
  })

  it('armFormatPainter arms non-sticky by default', () => {
    useUIStore.getState().armFormatPainter(sampleFormat, false)
    expect(useUIStore.getState().formatPainter).toEqual({ armed: true, sticky: false, format: sampleFormat })
  })

  it('armFormatPainter can arm sticky', () => {
    useUIStore.getState().armFormatPainter(sampleFormat, true)
    expect(useUIStore.getState().formatPainter.sticky).toBe(true)
  })

  it('disarmFormatPainter clears armed state and the captured format', () => {
    useUIStore.getState().armFormatPainter(sampleFormat, true)
    useUIStore.getState().disarmFormatPainter()
    expect(useUIStore.getState().formatPainter).toEqual({ armed: false, sticky: false, format: null })
  })
})
