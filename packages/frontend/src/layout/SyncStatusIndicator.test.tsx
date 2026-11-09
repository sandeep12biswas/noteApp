import type { SyncStatus } from '@flownote/ipc-adapter'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSyncStore } from '../store/syncStore'
import { useUIStore } from '../store/uiStore'
import { MassDeleteBanner } from './MassDeleteBanner'
import { SyncStatusIndicator } from './SyncStatusIndicator'

const status = (over: Partial<SyncStatus>): SyncStatus =>
  ({
    state: 'idle', target: 'folder', folderPath: '/s', accountLabel: null, signingIn: false, deviceId: 'd', deviceName: 'L',
    connected: true, lastSyncAt: Date.now(), lastError: null, heldBack: null, quarantined: 0, waiting: 0, peers: [], vaultExists: null,
    ...over,
  }) as SyncStatus

beforeEach(() => useUIStore.setState({ syncSettingsOpen: false }))
afterEach(cleanup)

describe('SyncStatusIndicator', () => {
  it('is hidden until sync is set up', () => {
    useSyncStore.setState({ status: null })
    const { rerender } = render(<SyncStatusIndicator />)
    expect(screen.queryByTestId('sync-indicator')).not.toBeInTheDocument()
    useSyncStore.setState({ status: status({ state: 'off', target: 'none' }) })
    rerender(<SyncStatusIndicator />)
    expect(screen.queryByTestId('sync-indicator')).not.toBeInTheDocument()
  })

  it.each([
    ['idle', 'Synced'],
    ['syncing', 'Syncing…'],
    ['error', 'Sync error'],
    ['needsSignIn', 'Sync needs attention'],
    ['needsPassphrase', 'Sync needs attention'],
    ['heldBack', 'Sync needs attention'],
  ] as const)('shows %s as "%s" and opens the settings', async (state, text) => {
    useSyncStore.setState({ status: status({ state, lastError: state === 'error' ? 'offline' : null }) })
    render(<SyncStatusIndicator />)
    const button = screen.getByTestId('sync-indicator')
    expect(button).toHaveTextContent(text)
    if (state === 'error') expect(button).toHaveAttribute('title', 'offline')
    await userEvent.click(button)
    expect(useUIStore.getState().syncSettingsOpen).toBe(true)
  })
})

describe('MassDeleteBanner', () => {
  const held = { deviceId: 'd2', deviceName: null, pagesDeleted: 0, pagesTotal: 3, segmentsDeleted: 40, segmentsTotal: 52 }

  it('asks to apply, and "Not now" hides it', async () => {
    let applied = false
    useSyncStore.setState({
      status: status({ state: 'heldBack', heldBack: held }),
      confirmMassDelete: async () => {
        applied = true
        return { ok: true }
      },
    })
    render(<MassDeleteBanner />)
    expect(screen.getByRole('alert')).toHaveTextContent('Another device deleted 40 of 52 blocks. Apply these deletions here too?')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(applied).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is absent when nothing is held back', () => {
    useSyncStore.setState({ status: status({}) })
    render(<MassDeleteBanner />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
