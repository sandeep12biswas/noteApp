// jsdom doesn't implement CanvasRenderingContext2D, so these cover what's
// testable without it: pointer-events gating by Draw mode, that the layer
// mounts inert by default (DESIGN.md §5.5), and (with `getContext` stubbed)
// that it asks the backend to load/persist the right page's ink layer.
// Actual stroke rendering is exercised manually via the run-electron driver
// (real Chromium).
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { InkLayer, setIPCAdapter } from './InkLayer'

afterEach(() => {
  cleanup()
  setIPCAdapter(null)
})

describe('InkLayer', () => {
  it('is pointer-inert when not in Draw mode', () => {
    render(<InkLayer pageId="page-1" active={false} />)
    expect(screen.getByTestId('ink-layer')).toHaveStyle({ pointerEvents: 'none' })
  })

  it('accepts pointer events in Draw mode', () => {
    render(<InkLayer pageId="page-1" active={true} />)
    expect(screen.getByTestId('ink-layer')).toHaveStyle({ pointerEvents: 'all' })
  })

  it('loads the persisted ink layer for the current page on mount', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const getInkLayer = vi.fn().mockResolvedValue(null)
    setIPCAdapter({ getInkLayer, saveInkLayer: vi.fn() } as unknown as IPCAdapter)

    render(<InkLayer pageId="page-1" active={false} />)
    await waitFor(() => expect(getInkLayer).toHaveBeenCalledWith('page-1'))
  })

  it('reloads (a different page\'s) ink layer when pageId changes', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    const getInkLayer = vi.fn().mockResolvedValue(null)
    setIPCAdapter({ getInkLayer, saveInkLayer: vi.fn() } as unknown as IPCAdapter)

    const { rerender } = render(<InkLayer pageId="page-1" active={false} />)
    await waitFor(() => expect(getInkLayer).toHaveBeenCalledWith('page-1'))
    rerender(<InkLayer pageId="page-2" active={false} />)
    await waitFor(() => expect(getInkLayer).toHaveBeenCalledWith('page-2'))
  })
})
