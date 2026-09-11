// jsdom doesn't implement CanvasRenderingContext2D, so these cover what's
// testable without it: pointer-events gating by Draw mode, and that the
// layer mounts inert by default (DESIGN.md §5.5). Actual stroke rendering
// is exercised manually via the run-electron driver (real Chromium).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InkLayer } from './InkLayer'

afterEach(cleanup)

describe('InkLayer', () => {
  it('is pointer-inert when not in Draw mode', () => {
    render(<InkLayer pageId="page-1" active={false} />)
    expect(screen.getByTestId('ink-layer')).toHaveStyle({ pointerEvents: 'none' })
  })

  it('accepts pointer events in Draw mode', () => {
    render(<InkLayer pageId="page-1" active={true} />)
    expect(screen.getByTestId('ink-layer')).toHaveStyle({ pointerEvents: 'all' })
  })
})
