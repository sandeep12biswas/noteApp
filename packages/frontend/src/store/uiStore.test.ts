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
