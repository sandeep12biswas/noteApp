import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, AiProviderInput } from '@flownote/ipc-adapter'
import { useAIStore } from '../store/aiStore'
import { setIPCAdapter } from '../store/notebookStore'
import { AiSettingsDialog } from './AiSettingsDialog'

afterEach(() => {
  cleanup()
  setIPCAdapter(null)
  useAIStore.setState({ providers: [], loaded: false, error: null })
})

/** An in-memory backend mirroring store::save_ai_provider's apiKey rules. */
function fakeBackend(initial: (AiProvider & { apiKey?: string })[] = []) {
  const rows = new Map(initial.map((p) => [p.id, { ...p }]))
  const saved: AiProviderInput[] = []
  const list = () => [...rows.values()].map(({ apiKey: _k, ...p }) => p as AiProvider)
  setIPCAdapter({
    listAiProviders: async () => list(),
    saveAiProvider: async (input: AiProviderInput) => {
      saved.push(input)
      const prev = rows.get(input.id)
      const apiKey = input.apiKey === undefined ? prev?.apiKey : input.apiKey ?? undefined
      rows.set(input.id, {
        id: input.id, kind: input.kind, name: input.name, baseUrl: input.baseUrl ?? '', model: input.model ?? '',
        apiKey, hasApiKey: !!apiKey, isDefault: prev?.isDefault ?? rows.size === 0,
      })
      return list().find((p) => p.id === input.id)!
    },
    deleteAiProvider: vi.fn(async (id: string) => void rows.delete(id)),
    setDefaultAiProvider: vi.fn(async (id: string) => rows.forEach((r) => (r.isDefault = r.id === id))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  return { saved, rows }
}

const claude: AiProvider & { apiKey: string } = {
  id: 'c', kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', hasApiKey: true, isDefault: true, apiKey: 'sk-secret',
}

describe('AiSettingsDialog', () => {
  it('adds Claude from its preset; a key is required', async () => {
    const { saved } = fakeBackend()
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('claude-opus-5-5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Claude needs an API key.')

    await user.type(screen.getByLabelText('API key'), 'sk-new')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0]).toMatchObject({ kind: 'anthropic', name: 'Claude', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-new' })
    const row = await screen.findByText('Claude')
    expect(row.closest('li')).toHaveTextContent('key saved')
    expect(row.closest('li')).toHaveTextContent('Default')
  })

  it('adds Ollama (local) without a key', async () => {
    const { saved } = fakeBackend()
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Service' }), 'Ollama (local)')
    expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveValue('http://localhost:11434/v1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0]).toMatchObject({ kind: 'openai_compatible', name: 'Ollama' })
    expect(saved[0]).not.toHaveProperty('apiKey')
  })

  it('editing without retyping the key keeps it (no apiKey sent); the saved key is never shown', async () => {
    const { saved, rows } = fakeBackend([claude])
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Edit Claude' }))

    const keyField = screen.getByLabelText('API key')
    expect(keyField).toHaveValue('')
    expect(keyField).toHaveAttribute('type', 'password')
    expect(document.body.textContent).not.toContain('sk-secret')

    const model = screen.getByRole('textbox', { name: 'Model' })
    await user.clear(model)
    await user.type(model, 'claude-sonnet-5-5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0]).not.toHaveProperty('apiKey')
    expect(rows.get('c')!.apiKey).toBe('sk-secret')
  })

  it('"Remove the saved key" sends null', async () => {
    const { saved } = fakeBackend([{ ...claude, kind: 'openai_compatible', name: 'OpenAI', id: 'o' }])
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Edit OpenAI' }))
    await user.click(screen.getByRole('checkbox', { name: 'Remove the saved key' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(saved[0]!.apiKey).toBeNull()
  })

  it('makes another provider the default, and removes one', async () => {
    fakeBackend([claude, { id: 'g', kind: 'gemini', name: 'Gemini', baseUrl: '', model: 'gemini-2.5-flash', hasApiKey: true, isDefault: false }])
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Make Gemini the default' }))
    const list = screen.getByRole('list', { name: 'AI providers' })
    await vi.waitFor(() => expect(within(list).getByText('Gemini').closest('li')).toHaveTextContent('Default'))

    await user.click(screen.getByRole('button', { name: 'Remove Claude' }))
    await vi.waitFor(() => expect(within(list).queryByText('Claude')).toBeNull())
  })

  it('Escape closes it', async () => {
    fakeBackend()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AiSettingsDialog onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
