// "/ Ask AI" end to end inside the canvas, with a fake backend whose stream
// the test feeds chunk by chunk.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiProvider } from '@flownote/ipc-adapter'
import { CanvasRoot } from './CanvasRoot'
import { useAIStore } from '../store/aiStore'
import { useCanvasStore } from '../store/canvasStore'
import { setIPCAdapter, useNotebookStore } from '../store/notebookStore'

const claude = { id: 'c', kind: 'anthropic', name: 'Claude', baseUrl: '', model: '', hasApiKey: true, isDefault: true } as unknown as AiProvider

/** A stream the test drives: `push` a chunk, `end` it, or `fail` it. `returned` is set when the app cancels it. */
function controllableStream() {
  const queue: IteratorResult<string>[] = []
  let waiting: ((r: IteratorResult<string>) => void) | null = null
  let failWith: Error | null = null
  let rejectWaiting: ((e: Error) => void) | null = null
  const deliver = (r: IteratorResult<string>) => {
    if (waiting) {
      const w = waiting
      waiting = null
      w(r)
    } else queue.push(r)
  }
  const stream = {
    returned: false,
    push: (text: string) => deliver({ value: text, done: false }),
    end: () => deliver({ value: undefined, done: true }),
    fail: (err: Error) => {
      if (rejectWaiting) rejectWaiting(err)
      else failWith = err
    },
    next: () => {
      if (failWith) return Promise.reject(failWith)
      const r = queue.shift()
      if (r) return Promise.resolve(r)
      return new Promise<IteratorResult<string>>((resolve, reject) => {
        waiting = resolve
        rejectWaiting = reject
      })
    },
    return: () => {
      stream.returned = true
      deliver({ value: undefined, done: true })
      return Promise.resolve({ value: undefined, done: true } as IteratorResult<string>)
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return stream
}

let streams: ReturnType<typeof controllableStream>[] = []
let calls: unknown[][] = []
let segmentId = ''

function installBackend(providers: AiProvider[] = [claude]) {
  setIPCAdapter({
    listAiProviders: async () => providers,
    aiComplete: (...args: unknown[]) => {
      calls.push(args)
      const s = controllableStream()
      streams.push(s)
      return s
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

const editable = () => screen.getByRole('textbox', { name: 'Segment' }).querySelector('[contenteditable="true"]') as HTMLElement
const segmentHTML = () => editable().innerHTML
const savedText = () => {
  const doc = useCanvasStore.getState().segments[segmentId]?.content as { content?: { content?: { text?: string }[] }[] }
  return (doc.content ?? []).map((b) => (b.content ?? []).map((t) => t.text).join('')).join('\n')
}

async function askAI(user: ReturnType<typeof userEvent.setup>, prompt: string) {
  await user.type(editable(), '/')
  const menu = await screen.findByRole('menu', { name: 'Insert block' })
  await user.click(within(menu).getByRole('menuitem', { name: 'Ask AI…' }))
  const box = await screen.findByRole('dialog', { name: 'Ask AI' })
  const input = within(box).getByRole('textbox', { name: 'AI prompt for this segment' })
  await waitFor(() => expect(input).toHaveAttribute('placeholder', 'Ask Claude…')) // providers loaded
  await user.type(input, prompt)
  await user.click(within(box).getByRole('button', { name: 'Generate' }))
}

beforeEach(() => {
  streams = []
  calls = []
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
  })
  useAIStore.setState({ providers: [], loaded: false, error: null })
  segmentId = useCanvasStore.getState().createSegment('page-1', 0, 0)
})
afterEach(() => {
  cleanup()
  setIPCAdapter(null)
})

describe('"/ Ask AI"', () => {
  it('types the prompt and the streamed answer as a draft; Keep keeps both as ordinary text', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Write a haiku')
    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull()
    // Only the prompt goes to the AI — no note text as context.
    expect(calls[0]).toEqual(['Write a haiku', '', 'c'])

    await act(async () => {
      streams[0]!.push('Leaves fall\n')
      streams[0]!.push('quietly')
    })
    await waitFor(() => expect(segmentHTML()).toContain('quietly'))
    expect(segmentHTML()).toContain('ai-draft')
    const bar = screen.getByRole('toolbar', { name: 'AI draft' })
    expect(within(bar).getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    await act(async () => streams[0]!.end())
    await user.click(await within(bar).findByRole('button', { name: 'Keep' }))

    expect(screen.queryByRole('toolbar', { name: 'AI draft' })).toBeNull()
    expect(segmentHTML()).not.toContain('ai-draft')
    expect(savedText()).toBe('Write a haiku\nLeaves fall\nquietly')
  })

  it('Discard removes the prompt and the answer; the empty segment is still there', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Hi')
    await act(async () => {
      streams[0]!.push('Hello!')
      streams[0]!.end()
    })
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(savedText()).toBe('')
    expect(useCanvasStore.getState().segments[segmentId]).toBeDefined()
    expect(document.activeElement).toBe(editable())
  })

  it('Stop cancels the request; what arrived can still be kept', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Long story')
    await act(async () => streams[0]!.push('Once upon'))
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(streams[0]!.returned).toBe(true)
    expect(await screen.findByRole('status')).toHaveTextContent('Stopped.')
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(savedText()).toBe('Long story\nOnce upon')
  })

  it('Try again discards the draft and asks again with the same prompt', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Name a colour')
    await act(async () => {
      streams[0]!.push('Red')
      streams[0]!.end()
    })
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['Name a colour', '', 'c'])
    await act(async () => {
      streams[1]!.push('Blue')
      streams[1]!.end()
    })
    await user.click(await screen.findByRole('button', { name: 'Keep' }))
    expect(savedText()).toBe('Name a colour\nBlue')
  })

  it('Ctrl+Enter keeps and Escape discards, from the editor', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'One')
    await act(async () => {
      streams[0]!.push('First')
      streams[0]!.end()
    })
    await screen.findByRole('button', { name: 'Keep' })
    fireEvent.keyDown(editable(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'AI draft' })).toBeNull())
    expect(savedText()).toBe('')

    await askAI(user, 'Two')
    await act(async () => {
      streams[1]!.push('Second')
      streams[1]!.end()
    })
    await screen.findByRole('button', { name: 'Keep' })
    fireEvent.keyDown(editable(), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'AI draft' })).toBeNull())
    expect(savedText()).toBe('Two\nSecond')
  })

  it('shows the backend\'s error and still lets the user keep or discard', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Hi')
    await act(async () => streams[0]!.fail(new Error('The provider rejected the API key (401)')))
    expect(await screen.findByRole('status')).toHaveTextContent('The provider rejected the API key (401)')
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(savedText()).toBe('')
  })

  it('"Ask AI" is disabled in the menu while a draft is open', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await askAI(user, 'Hi')
    await act(async () => {
      streams[0]!.push('Hello')
      streams[0]!.end()
    })
    await screen.findByRole('button', { name: 'Keep' })
    // Type "/" on a new empty line after the draft (jsdom has no caret
    // movement keys, so through the editor's own commands).
    const editor = useCanvasStore.getState().editorRefs.get(segmentId)!
    act(() => {
      editor.chain().focus('end').splitBlock().insertContent('/').run()
    })
    const menu = await screen.findByRole('menu', { name: 'Insert block' })
    expect(within(menu).getByRole('menuitem', { name: 'Ask AI…' })).toBeDisabled()
  })

  it('Escape in the prompt box cancels: no request, the "/" is gone, the segment stays', async () => {
    installBackend()
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await user.type(editable(), '/')
    await user.click(within(await screen.findByRole('menu', { name: 'Insert block' })).getByRole('menuitem', { name: 'Ask AI…' }))
    const input = await screen.findByRole('textbox', { name: 'AI prompt for this segment' })
    expect(document.activeElement).toBe(input)
    // Focus moved into the prompt box: the empty segment must not have been auto-deleted.
    expect(useCanvasStore.getState().segments[segmentId]).toBeDefined()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Ask AI' })).toBeNull()
    expect(calls).toHaveLength(0)
    expect(savedText()).toBe('')
    expect(document.activeElement).toBe(editable())
  })

  it('with no provider set up, says so and offers AI settings', async () => {
    installBackend([])
    render(<CanvasRoot pageId="page-1" />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.activeElement).toBe(editable()))

    await user.type(editable(), '/')
    await user.click(within(await screen.findByRole('menu', { name: 'Insert block' })).getByRole('menuitem', { name: 'Ask AI…' }))
    const box = await screen.findByRole('dialog', { name: 'Ask AI' })
    expect(await within(box).findByRole('status')).toHaveTextContent('No AI provider set up yet.')
    expect(within(box).getByRole('button', { name: 'Generate' })).toBeDisabled()
    await user.click(within(box).getByRole('button', { name: 'AI settings' }))
    expect(await screen.findByRole('dialog', { name: /AI settings/i })).toBeInTheDocument()
  })
})
