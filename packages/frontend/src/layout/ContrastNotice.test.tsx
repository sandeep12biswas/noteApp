// Clash warning (issue #12).
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContrastNotice, keptKey } from './ContrastNotice'
import { useCanvasStore } from '../store/canvasStore'
import { useThemeStore } from '../store/themeStore'

const NAVY = '#1e3a8a'

function seedSegment(textColor: string) {
  useCanvasStore.setState({
    segments: {
      s1: {
        id: 's1',
        pageId: 'page-1',
        x: 0,
        y: 0,
        w: 200,
        h: 40,
        zIndex: 1,
        borderColor: null,
        fillColor: null,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'textStyle', attrs: { color: textColor } }] }] }],
        },
        createdAt: 0,
        updatedAt: 0,
      },
    },
  } as never)
}

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useThemeStore.setState({ isDark: false })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useCanvasStore.setState({ segments: {} })
})

describe('ContrastNotice', () => {
  it('reports coloured text that is hard to read on the background', async () => {
    seedSegment('#1d4ed8')
    render(<ContrastNotice pageId="page-1" background={NAVY} />)
    await settle()
    expect(screen.getByTestId('contrast-notice')).toHaveTextContent('1 coloured passage is hard to read on this background')
  })

  it('stays hidden when the colours read well, and in the dark theme', async () => {
    seedSegment('#fde68a')
    render(<ContrastNotice pageId="page-1" background={NAVY} />)
    await settle()
    expect(screen.queryByTestId('contrast-notice')).not.toBeInTheDocument()

    cleanup()
    seedSegment('#1d4ed8')
    useThemeStore.setState({ isDark: true })
    render(<ContrastNotice pageId="page-1" background={NAVY} />)
    await settle()
    expect(screen.queryByTestId('contrast-notice')).not.toBeInTheDocument()
  })

  it('Keep hides it for this page and background, remembered on this device', async () => {
    seedSegment('#1d4ed8')
    render(<ContrastNotice pageId="page-1" background={NAVY} />)
    await settle()
    act(() => screen.getByRole('button', { name: 'Keep' }).click())
    expect(screen.queryByTestId('contrast-notice')).not.toBeInTheDocument()
    expect(localStorage.getItem(keptKey('page-1', NAVY))).toBe('1')

    // Same page and colour: still hidden. Another background: shown again.
    cleanup()
    render(<ContrastNotice pageId="page-1" background={NAVY} />)
    await settle()
    expect(screen.queryByTestId('contrast-notice')).not.toBeInTheDocument()
    cleanup()
    render(<ContrastNotice pageId="page-1" background="#000000" />)
    await settle()
    expect(screen.getByTestId('contrast-notice')).toBeInTheDocument()
  })
})
