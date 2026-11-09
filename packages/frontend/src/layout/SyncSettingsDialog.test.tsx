import type { SyncStatus } from '@flownote/ipc-adapter'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncStore } from '../store/syncStore'
import { SyncSettingsDialog } from './SyncSettingsDialog'

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  state: 'off',
  target: 'none',
  folderPath: null,
  accountLabel: null,
  signingIn: false,
  deviceId: 'd1',
  deviceName: 'Laptop',
  connected: false,
  lastSyncAt: null,
  lastError: null,
  heldBack: null,
  quarantined: 0,
  waiting: 0,
  peers: [],
  vaultExists: null,
  ...over,
})

const ok = () => vi.fn().mockResolvedValue({ ok: true })
let actions: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  actions = {
    configure: ok(),
    signIn: ok(),
    cancelSignIn: ok(),
    connect: ok(),
    syncNow: ok(),
    confirmMassDelete: ok(),
    disconnect: ok(),
    pickFolder: vi.fn().mockResolvedValue('/picked/folder'),
  }
  useSyncStore.setState({ status: status(), signInUrl: null, ...actions } as never)
})
afterEach(cleanup)

const show = (over: Partial<SyncStatus>) => {
  useSyncStore.setState({ status: status(over) })
  return render(<SyncSettingsDialog onClose={() => {}} />)
}

describe('SyncSettingsDialog', () => {
  it('says so when there is no backend', () => {
    useSyncStore.setState({ status: null })
    render(<SyncSettingsDialog onClose={() => {}} />)
    expect(screen.getByText(/isn't available here/)).toBeInTheDocument()
  })

  it('sets up a folder, using the folder dialog', async () => {
    show({})
    await userEvent.click(screen.getByRole('radio', { name: /A folder on this computer/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    expect(screen.getByLabelText('Sync folder path')).toHaveValue('/picked/folder')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(actions.configure).toHaveBeenCalledWith({ target: 'folder', folderPath: '/picked/folder' })
    expect(actions.signIn).not.toHaveBeenCalled()
  })

  it('falls back to a typed path where there is no folder dialog', async () => {
    actions.pickFolder!.mockResolvedValue(undefined)
    show({})
    await userEvent.click(screen.getByRole('radio', { name: /A folder on this computer/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }))
    expect(screen.queryByRole('button', { name: 'Browse…' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Sync folder path'), '/typed/path')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(actions.configure).toHaveBeenCalledWith({ target: 'folder', folderPath: '/typed/path' })
  })

  it('goes straight on to signing in for a cloud drive', async () => {
    show({})
    await userEvent.click(screen.getByRole('radio', { name: /Google Drive/ }))
    await userEvent.click(screen.getByRole('button', { name: /Continue to Google Drive sign-in/ }))
    expect(actions.configure).toHaveBeenCalledWith({ target: 'gdrive' })
    await waitFor(() => expect(actions.signIn).toHaveBeenCalledWith('gdrive'))
  })

  it('offers the sign-in link and cancel while the browser is open', async () => {
    useSyncStore.setState({ signInUrl: 'https://login.example/authorize?x=1' })
    show({ state: 'needsSignIn', target: 'onedrive', signingIn: true })
    expect(screen.getByText(/Finish signing in to OneDrive/)).toBeInTheDocument()
    expect(screen.getByLabelText('Sign-in link')).toHaveValue('https://login.example/authorize?x=1')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    expect(actions.cancelSignIn).toHaveBeenCalled()
  })

  it('explains an expired sign-in and signs in again', async () => {
    show({ state: 'needsSignIn', target: 'onedrive', accountLabel: 'me@example.com', lastError: 'The OneDrive sign-in has expired or was revoked.' })
    expect(screen.getByText(/for me@example.com has expired/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to OneDrive' }))
    expect(actions.signIn).toHaveBeenCalledWith('onedrive')
  })

  it('creating a passphrase asks twice and for a reasonable length', async () => {
    show({ state: 'needsPassphrase', target: 'folder', folderPath: '/sync', vaultExists: false })
    expect(screen.getByText(/no way to recover a lost passphrase/)).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Start syncing' })
    await userEvent.type(screen.getByLabelText('Passphrase', { selector: 'input' }), 'short')
    await userEvent.click(start)
    expect(screen.getByRole('alert')).toHaveTextContent('at least 8')
    await userEvent.type(screen.getByLabelText('Passphrase', { selector: 'input' }), ' but longer')
    await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'different')
    await userEvent.click(start)
    expect(screen.getByRole('alert')).toHaveTextContent("don't match")
    expect(actions.connect).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByLabelText('Confirm passphrase'))
    await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'short but longer')
    await userEvent.click(start)
    expect(actions.connect).toHaveBeenCalledWith('short but longer')
  })

  it('joining asks once and shows a wrong passphrase', async () => {
    actions.connect!.mockResolvedValue({ ok: false, error: "Wrong passphrase: it doesn't match the one this sync folder was set up with." })
    show({ state: 'needsPassphrase', target: 'gdrive', accountLabel: 'me@gmail.com', vaultExists: true })
    expect(screen.getByText(/Google Drive \(me@gmail.com\) already holds FlowNote notes/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm passphrase')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Passphrase', { selector: 'input' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Start syncing' }))
    expect(actions.connect).toHaveBeenCalledWith('x')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passphrase')
  })

  it('shows how sync is going, syncs now, and asks before disconnecting', async () => {
    show({
      state: 'idle',
      target: 'onedrive',
      accountLabel: 'me@example.com',
      connected: true,
      lastSyncAt: Date.now() - 5 * 60_000,
      peers: [{ deviceId: 'd2', name: 'Desktop', lastSeenAt: Date.now() - 2 * 3_600_000 }],
      waiting: 2,
    })
    expect(screen.getByRole('status')).toHaveTextContent('Up to date · last synced 5 minutes ago')
    expect(screen.getByText(/Other devices:/).parentElement).toHaveTextContent('Desktop (2 hours ago)')
    expect(screen.getByText(/2 changes from other devices are still on the way/)).toBeInTheDocument()
    expect(screen.getByText(/Syncing to OneDrive \(me@example.com\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(actions.syncNow).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect…' }))
    expect(actions.disconnect).not.toHaveBeenCalled()
    expect(screen.getByText(/Your notes stay here and in OneDrive/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop syncing' }))
    expect(actions.disconnect).toHaveBeenCalled()
  })

  it('shows the error and a held-back deletion', async () => {
    show({
      state: 'heldBack',
      target: 'folder',
      folderPath: '/sync',
      connected: true,
      heldBack: { deviceId: 'd2', deviceName: 'Desktop', pagesDeleted: 6, pagesTotal: 6, segmentsDeleted: 0, segmentsTotal: 10 },
    })
    expect(screen.getByText(/"Desktop" deleted 6 of 6 pages/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Apply deletions' }))
    expect(actions.confirmMassDelete).toHaveBeenCalled()
    cleanup()
    show({ state: 'error', target: 'folder', folderPath: '/sync', connected: true, lastError: 'The sync folder /sync isn\'t there.' })
    expect(screen.getByRole('alert')).toHaveTextContent("isn't there")
  })

  it('renames the device and lets the target be changed', async () => {
    show({ state: 'idle', target: 'folder', folderPath: '/sync', connected: true })
    const name = screen.getByLabelText("This device's name")
    await userEvent.clear(name)
    await userEvent.type(name, 'Work laptop{Enter}')
    expect(actions.configure).toHaveBeenCalledWith({ deviceName: 'Work laptop' })
    await userEvent.click(screen.getByRole('button', { name: 'Change…' }))
    expect(screen.getByRole('radiogroup', { name: 'Where to sync' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('closes on Escape and on the backdrop', () => {
    const onClose = vi.fn()
    useSyncStore.setState({ status: status() })
    const { container } = render(<SyncSettingsDialog onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(container.firstChild as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
