import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RibbonRoot } from './RibbonRoot'
import { useCanvasStore } from '../store/canvasStore'
import { useInkStore } from '../store/inkStore'
import { setIPCAdapter } from '../store/notebookStore'
import { useUIStore } from '../store/uiStore'

afterEach(cleanup)
beforeEach(() => {
  useUIStore.setState({ activeRibbonTab: 'Home', zoom: 1 })
  useInkStore.setState({ tool: 'pen', color: '#111827' })
})

describe('RibbonRoot Draw tab', () => {
  it('shows the ink tool switcher only on the Draw tab', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)

    expect(screen.queryByRole('group', { name: 'Ink tool' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Draw' }))
    expect(screen.getByRole('group', { name: 'Ink tool' })).toBeInTheDocument()
  })

  it('switching tools updates inkStore', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Draw' }))

    await user.click(screen.getByRole('button', { name: 'eraser' }))
    expect(useInkStore.getState().tool).toBe('eraser')
  })

  it('picking a colour updates inkStore', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Draw' }))

    await user.click(screen.getByRole('button', { name: 'Colour #dc2626' }))
    expect(useInkStore.getState().color).toBe('#dc2626')
  })
})

describe('RibbonRoot Home tab colour cycling (DESIGN.md §4.3)', () => {
  it('cycles the Highlight underbar colour and applies it to the active editor on each click', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)

    const applied: string[] = []
    useCanvasStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getActiveEditor: () =>
        ({
          chain: () => ({
            focus: () => ({
              toggleHighlight: ({ color }: { color: string }) => {
                applied.push(color)
                return { run: () => {} }
              },
            }),
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
    })

    const button = screen.getByRole('button', { name: 'Highlight' })
    await user.click(button)
    await user.click(button)

    expect(applied).toEqual(['#fef08a', '#bbf7d0'])
  })
})

describe('RibbonRoot Home tab formatting (Phase 6 "keyboard shortcut audit")', () => {
  it('dispatches Bold/Italic/Underline through the active editor, not document.execCommand', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)

    const calls: string[] = []
    const chain: Record<string, () => typeof chain> = {}
    for (const m of ['focus', 'toggleBold', 'toggleItalic', 'toggleUnderline', 'run']) {
      chain[m] = () => {
        calls.push(m)
        return chain
      }
    }
    useCanvasStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getActiveEditor: () => ({ chain: () => chain }) as any,
    })

    await user.click(screen.getByRole('button', { name: 'Bold' }))
    await user.click(screen.getByRole('button', { name: 'Italic' }))
    await user.click(screen.getByRole('button', { name: 'Underline' }))

    expect(calls).toEqual(['focus', 'toggleBold', 'run', 'focus', 'toggleItalic', 'run', 'focus', 'toggleUnderline', 'run'])
  })

  it('is a no-op when no segment is active', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    useCanvasStore.setState({ getActiveEditor: () => null })
    await expect(user.click(screen.getByRole('button', { name: 'Bold' }))).resolves.not.toThrow()
  })
})

describe('RibbonRoot View tab zoom (Phase 6)', () => {
  it('zoom in/out/reset update uiStore, clamped to [50, 200]%', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'View' }))

    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%')

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(useUIStore.getState().zoom).toBeCloseTo(1.1)
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('110%')

    await user.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(useUIStore.getState().zoom).toBe(1)

    useUIStore.setState({ zoom: 2 })
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(useUIStore.getState().zoom).toBe(2)

    useUIStore.setState({ zoom: 0.5 })
    await user.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(useUIStore.getState().zoom).toBe(0.5)
  })
})

describe('RibbonRoot Insert tab AI panel (Phase 6 "Ollama integration" — graceful unavailable state)', () => {
  it('shows a friendly status instead of crashing when aiComplete() rejects', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Insert' }))

    useCanvasStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getActiveEditor: () => ({ getText: () => '' }) as any,
    })
    setIPCAdapter({
      // eslint-disable-next-line require-yield -- matches the real stub adapters' behavior: reject before ever yielding
      aiComplete: async function* () {
        throw new Error('not implemented')
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await user.type(screen.getByRole('textbox', { name: 'AI prompt' }), 'summarise this')
    await user.click(screen.getByRole('button', { name: 'Generate with AI' }))

    expect(await screen.findByRole('status')).toHaveTextContent("AI unavailable — Ollama isn't running.")
    setIPCAdapter(null)
  })

  it('prompts to select a segment first when none is active', async () => {
    const user = userEvent.setup()
    render(<RibbonRoot />)
    await user.click(screen.getByRole('tab', { name: 'Insert' }))
    useCanvasStore.setState({ getActiveEditor: () => null })

    await user.click(screen.getByRole('button', { name: 'Generate with AI' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Select a segment first.')
  })
})
