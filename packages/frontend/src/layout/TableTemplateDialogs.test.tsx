import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPCAdapter, TableTemplate, TableTemplateInput } from '@flownote/ipc-adapter'
import { setIPCAdapter } from '../store/notebookStore'
import { useTableTemplateStore } from '../store/tableTemplateStore'
import { SaveTableTemplateDialog } from './SaveTableTemplateDialog'
import { TableTemplatesDialog } from './TableTemplatesDialog'

const TABLE = {
  type: 'table',
  content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Apples' }] }] }] },
  ],
}

let saved: TableTemplate[]
function fakeAdapter() {
  const api = {
    listTableTemplates: vi.fn(async () => [...saved].sort((a, b) => a.name.localeCompare(b.name))),
    saveTableTemplate: vi.fn(async (t: TableTemplateInput) => {
      saved = saved.filter((s) => s.name.toLowerCase() !== t.name.toLowerCase()).concat({ ...t, updatedAt: 1 })
    }),
    renameTableTemplate: vi.fn(async (from: string, to: string) => {
      if (saved.some((s) => s.name.toLowerCase() === to.toLowerCase())) throw new Error(`a template called "${to}" already exists`)
      saved = saved.map((s) => (s.name === from ? { ...s, name: to } : s))
    }),
    deleteTableTemplate: vi.fn(async (name: string) => {
      saved = saved.filter((s) => s.name !== name)
    }),
  }
  setIPCAdapter(api as unknown as IPCAdapter)
  return api
}

beforeEach(() => {
  saved = []
  useTableTemplateStore.setState({ templates: [], loaded: false, error: null })
})
afterEach(() => {
  cleanup()
  setIPCAdapter(null as unknown as IPCAdapter)
})

describe('Save as template', () => {
  it('saves structure and header only by default', async () => {
    const api = fakeAdapter()
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<SaveTableTemplateDialog table={TABLE} onClose={onClose} />)
    await user.type(screen.getByRole('textbox', { name: 'Template name' }), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const input = api.saveTableTemplate.mock.calls[0]![0]
    expect(input.name).toBe('Groceries')
    expect(input.includesContents).toBe(false)
    expect(JSON.stringify(input.table)).toContain('Item')
    expect(JSON.stringify(input.table)).not.toContain('Apples')
  })

  it('"Include cell contents" keeps the body text', async () => {
    const api = fakeAdapter()
    const user = userEvent.setup()
    render(<SaveTableTemplateDialog table={TABLE} onClose={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Template name' }), 'Full')
    await user.click(screen.getByRole('checkbox', { name: /Include cell contents/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveTableTemplate).toHaveBeenCalled())
    expect(api.saveTableTemplate.mock.calls[0]![0].includesContents).toBe(true)
    expect(JSON.stringify(api.saveTableTemplate.mock.calls[0]![0].table)).toContain('Apples')
  })

  it('requires a name, and warns before replacing an existing template', async () => {
    saved = [{ name: 'Groceries', table: TABLE, includesContents: false, updatedAt: 0 }]
    const api = fakeAdapter()
    const user = userEvent.setup()
    render(<SaveTableTemplateDialog table={TABLE} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the template a name')
    await user.type(screen.getByRole('textbox', { name: 'Template name' }), 'groceries')
    await waitFor(() => expect(useTableTemplateStore.getState().loaded).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('“Groceries” already exists. Replace it?')
    expect(api.saveTableTemplate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(api.saveTableTemplate).toHaveBeenCalledOnce())
  })
})

describe('Manage templates', () => {
  it('previews, renames and deletes', async () => {
    saved = [
      { name: 'Groceries', table: TABLE, includesContents: true, updatedAt: 0 },
      { name: 'Tasks', table: TABLE, includesContents: false, updatedAt: 0 },
    ]
    fakeAdapter()
    const user = userEvent.setup()
    render(<TableTemplatesDialog onClose={() => {}} />)
    const groceries = await screen.findByRole('listitem', { name: 'Template Groceries' })
    expect(groceries).toHaveTextContent('Item')
    expect(groceries).toHaveTextContent('2 × 1 · with contents')

    await user.click(screen.getByRole('button', { name: 'Rename Groceries' }))
    const input = screen.getByRole('textbox', { name: 'New name for Groceries' })
    await user.clear(input)
    await user.type(input, 'tasks{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    await user.clear(input)
    await user.type(input, 'Shopping{Enter}')
    expect(await screen.findByRole('listitem', { name: 'Template Shopping' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Tasks' }))
    await user.click(screen.getByRole('button', { name: 'Delete “Tasks”?' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Template Tasks' })).toBeNull())
  })
})
