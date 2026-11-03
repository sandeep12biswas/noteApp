// Plugin Manager UI — DESIGN.md §9.5 Installed sub-view.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginManagerUI } from './PluginManagerUI'
import { setIPCAdapter } from '../store/notebookStore'
import { usePluginStore } from '../store/pluginStore'

const manifest = (overrides: Partial<{ id: string; enabled: boolean; permissions: string[] }> = {}) => ({
  id: overrides.id ?? 'com.sandeep.spreadsheet',
  name: 'Spreadsheet',
  version: '1.0.0',
  description: 'Embed live spreadsheets',
  author: 'Sandeep',
  entry: 'index.js',
  sdkVersion: '1.0.0',
  permissions: overrides.permissions ?? ['storage:read', 'storage:write'],
  extensionPoints: ['blockType:spreadsheet'],
  minAppVersion: '*',
  enabled: overrides.enabled ?? true,
  installedAt: 0,
})

afterEach(() => {
  cleanup()
  setIPCAdapter(null)
  usePluginStore.setState({ plugins: [], loading: false, error: null })
})

beforeEach(() => {
  usePluginStore.setState({ plugins: [], loading: false, error: null })
})

describe('PluginManagerUI', () => {
  it('shows "No plugins installed." when empty', async () => {
    setIPCAdapter({ getInstalledPlugins: async () => [] } as never)
    render(<PluginManagerUI />)
    expect(await screen.findByText('No plugins installed.')).toBeInTheDocument()
  })

  it('lists installed plugins with name, version, and permissions', async () => {
    setIPCAdapter({ getInstalledPlugins: async () => [manifest()] } as never)
    render(<PluginManagerUI />)

    expect(await screen.findByText('Spreadsheet')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText(/storage:read, storage:write/)).toBeInTheDocument()
  })

  it('toggling the enabled checkbox calls setEnabled and updates optimistically', async () => {
    setIPCAdapter({ getInstalledPlugins: async () => [manifest()], setPluginEnabled: vi.fn().mockResolvedValue(undefined) } as never)
    const user = userEvent.setup()
    render(<PluginManagerUI />)
    await screen.findByText('Spreadsheet')

    const checkbox = screen.getByRole('checkbox', { name: 'Disable Spreadsheet' })
    await user.click(checkbox)

    await waitFor(() => expect(usePluginStore.getState().plugins[0]?.enabled).toBe(false))
  })

  it('uninstall requires a confirmation click before calling the adapter', async () => {
    const uninstallSpy = vi.fn().mockResolvedValue(undefined)
    setIPCAdapter({ getInstalledPlugins: async () => [manifest()], uninstallPlugin: uninstallSpy } as never)
    const user = userEvent.setup()
    render(<PluginManagerUI />)
    await screen.findByText('Spreadsheet')

    await user.click(screen.getByRole('button', { name: 'Uninstall Spreadsheet' }))
    expect(uninstallSpy).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes' }))
    await waitFor(() => expect(uninstallSpy).toHaveBeenCalledWith('com.sandeep.spreadsheet'))
    expect(screen.queryByText('Spreadsheet')).not.toBeInTheDocument()
  })

  it('"No" on the uninstall confirmation cancels without calling the adapter', async () => {
    const uninstallSpy = vi.fn()
    setIPCAdapter({ getInstalledPlugins: async () => [manifest()], uninstallPlugin: uninstallSpy } as never)
    const user = userEvent.setup()
    render(<PluginManagerUI />)
    await screen.findByText('Spreadsheet')

    await user.click(screen.getByRole('button', { name: 'Uninstall Spreadsheet' }))
    await user.click(screen.getByRole('button', { name: 'No' }))
    expect(uninstallSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Spreadsheet')).toBeInTheDocument()
  })

  it('Install… opens a manifest form and a successful install closes it and refreshes the list', async () => {
    const installSpy = vi.fn().mockResolvedValue(undefined)
    let installed = false
    setIPCAdapter({
      getInstalledPlugins: async () => (installed ? [manifest()] : []),
      installPlugin: async (source: string) => {
        installSpy(source)
        installed = true
        return manifest()
      },
    } as never)
    const user = userEvent.setup()
    render(<PluginManagerUI />)
    await screen.findByText('No plugins installed.')

    await user.click(screen.getByRole('button', { name: 'Install…' }))
    const manifestJson = JSON.stringify(manifest())
    fireEvent.change(screen.getByRole('textbox', { name: 'Plugin manifest JSON' }), { target: { value: manifestJson } })
    await user.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Install plugin' })).not.toBeInTheDocument())
    expect(await screen.findByText('Spreadsheet')).toBeInTheDocument()
    expect(installSpy).toHaveBeenCalled()
  })

  it('a failed install shows the error and keeps the form open', async () => {
    setIPCAdapter({
      getInstalledPlugins: async () => [],
      installPlugin: async () => {
        throw new Error('unknown permission: nonsense')
      },
    } as never)
    const user = userEvent.setup()
    render(<PluginManagerUI />)
    await screen.findByText('No plugins installed.')

    await user.click(screen.getByRole('button', { name: 'Install…' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Plugin manifest JSON' }), { target: { value: '{}' } })
    await user.click(screen.getByRole('button', { name: 'Install' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('unknown permission')
    expect(screen.getByRole('dialog', { name: 'Install plugin' })).toBeInTheDocument()
  })
})
