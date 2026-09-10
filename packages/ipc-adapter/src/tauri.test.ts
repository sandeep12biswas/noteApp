// Exercises TauriIPCAdapter.getPage's real logic (the tauri-specta result
// unwrap + mode narrowing) against a mocked generated binding, since
// contract.test.ts only checks that every method rejects outside a real
// Tauri runtime — it can't reach these branches.
import { describe, expect, it, vi } from 'vitest'

vi.mock('./generated/tauri-bindings', () => ({
  commands: { getPage: vi.fn() },
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
