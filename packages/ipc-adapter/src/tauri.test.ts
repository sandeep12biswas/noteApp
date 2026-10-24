// Exercises TauriIPCAdapter.getPage's real logic (the tauri-specta result
// unwrap + mode narrowing) against a mocked generated binding, since
// contract.test.ts only checks that every method rejects outside a real
// Tauri runtime — it can't reach these branches.
import { describe, expect, it, vi } from 'vitest'

// Every command TauriIPCAdapter calls, each a bare vi.fn() the tests below
// program per case.
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage: (event: unknown) => void = () => {}
  },
}))

vi.mock('./generated/tauri-bindings', () => ({
  commands: new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, name: string) => (target[name] ??= vi.fn()),
  }),
}))

describe('TauriIPCAdapter.getPage', () => {
  it('unwraps a successful Result into a Page', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.getPage).mockResolvedValue({
      status: 'ok',
      data: {
        id: 'page-1',
        notebookId: 'nb-1',
        title: 'Untitled',
        mode: 'canvas',
        createdAt: 0,
        updatedAt: 0,
      },
    })

    const page = await new TauriIPCAdapter().getPage('page-1')
    expect(page).toEqual({
      id: 'page-1',
      notebookId: 'nb-1',
      title: 'Untitled',
      mode: 'canvas',
      createdAt: 0,
      updatedAt: 0,
    })
  })

  it('throws with the backend error message on an error Result', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.getPage).mockResolvedValue({
      status: 'error',
      error: 'no such page: missing',
    })

    await expect(new TauriIPCAdapter().getPage('missing')).rejects.toThrow('no such page: missing')
  })

  it('rejects if the backend somehow returns an unrecognized mode', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.getPage).mockResolvedValue({
      status: 'ok',
      data: {
        id: 'page-1',
        notebookId: 'nb-1',
        title: 'Untitled',
        // Deliberately invalid — exercises the runtime narrowing guard for
        // a value that couldn't happen if the backend agrees with our
        // types.ts, but which JS can still smuggle through at runtime.
        mode: 'freeform' as 'canvas',
        createdAt: 0,
        updatedAt: 0,
      },
    })

    await expect(new TauriIPCAdapter().getPage('page-1')).rejects.toThrow('unexpected page mode')
  })
})

// The commands added for Windows/macOS parity with the Electron sidecar
// (all backed by flownote_core::store). Each row: adapter method, its args,
// the generated command it must call with those same args, and the
// command's `data` — which the adapter must return unwrapped.
describe('TauriIPCAdapter: store-backed methods forward args and unwrap results', () => {
  const attachment = { id: 'att-1', fileName: 'a.txt', mimeType: 'text/plain', size: 5 }
  const cases: [method: string, args: unknown[], data: unknown][] = [
    ['deletePage', ['page-1'], null],
    ['deleteFolder', ['folder-1'], null],
    ['saveAttachment', ['att-1', 'seg-1', 'a.txt', 'text/plain', 'aGVsbG8='], attachment],
    ['getAttachment', ['att-1'], { ...attachment, path: '/tmp/a.txt' }],
    ['deleteAttachment', ['att-1'], null],
    ['openAttachment', ['att-1'], null],
    ['search', ['quarterly', 'nb-1'], [{ pageId: 'page-1', segmentId: 'seg-1', snippet: 'quarterly…' }]],
    ['setPageMode', ['page-1', 'linear'], null],
    ['installPlugin', ['{"id":"p"}'], { id: 'p', enabled: true }],
    ['uninstallPlugin', ['p'], null],
    ['setPluginEnabled', ['p', false], null],
    ['getInstalledPlugins', [], [{ id: 'p', enabled: true }]],
    ['pluginStorageGet', ['p', 'k'], 'v'],
    ['pluginStorageSet', ['p', 'k', 'v'], null],
    ['pluginStorageDelete', ['p', 'k'], null],
    ['pluginStorageList', ['p'], ['k']],
  ]

  it.each(cases)('%s', async (method, args, data) => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    const command = (commands as unknown as Record<string, ReturnType<typeof vi.fn>>)[method]!
    command.mockResolvedValue({ status: 'ok', data })

    const adapter = new TauriIPCAdapter() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
    const result = await adapter[method]!(...args)

    expect(command).toHaveBeenCalledWith(...args)
    // void-returning methods resolve to undefined rather than passing `null` through
    if (data !== null) expect(result).toEqual(data)
  })

  it('surfaces a backend error message', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.setPageMode).mockResolvedValue({ status: 'error', error: 'no such page: missing' })
    await expect(new TauriIPCAdapter().setPageMode('missing', 'canvas')).rejects.toThrow('no such page: missing')
  })
})

// aiComplete streams over a Tauri Channel; `@tauri-apps/api/core`'s Channel
// is replaced (below, via vi.mock) by a stub the test drives directly.
describe('TauriIPCAdapter.aiComplete', () => {
  it('yields text events in order and ends on done', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.aiComplete).mockImplementation(async (_p, _c, _id, channel) => {
      const ch = channel as unknown as { onmessage: (e: unknown) => void }
      queueMicrotask(() => {
        ch.onmessage({ type: 'text', text: 'Hel' })
        ch.onmessage({ type: 'text', text: 'lo' })
        ch.onmessage({ type: 'done' })
      })
      return { status: 'ok', data: 7 }
    })
    let out = ''
    for await (const t of new TauriIPCAdapter().aiComplete('p', 'ctx', 'claude')) out += t
    expect(out).toBe('Hello')
    expect(vi.mocked(commands.aiComplete).mock.calls.at(-1)!.slice(0, 3)).toEqual(['p', 'ctx', 'claude'])
  })

  it('throws the provider error after any text', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.aiComplete).mockImplementation(async (_p, _c, _id, channel) => {
      const ch = channel as unknown as { onmessage: (e: unknown) => void }
      queueMicrotask(() => {
        ch.onmessage({ type: 'text', text: 'par' })
        ch.onmessage({ type: 'error', message: 'The provider rejected the API key (401)' })
      })
      return { status: 'ok', data: 8 }
    })
    let out = ''
    await expect(
      (async () => {
        for await (const t of new TauriIPCAdapter().aiComplete('p', '')) out += t
      })(),
    ).rejects.toThrow('rejected the API key')
    expect(out).toBe('par')
  })

  it('stopping early cancels the stream in the backend', async () => {
    const { commands } = await import('./generated/tauri-bindings')
    const { TauriIPCAdapter } = await import('./tauri')
    vi.mocked(commands.aiComplete).mockImplementation(async (_p, _c, _id, channel) => {
      const ch = channel as unknown as { onmessage: (e: unknown) => void }
      queueMicrotask(() => ch.onmessage({ type: 'text', text: 'first' }))
      return { status: 'ok', data: 9 }
    })
    vi.mocked(commands.aiCancel).mockResolvedValue(undefined as never)
    for await (const text of new TauriIPCAdapter().aiComplete('p', '')) {
      expect(text).toBe('first')
      break
    }
    expect(commands.aiCancel).toHaveBeenCalledWith(9)
  })
})
