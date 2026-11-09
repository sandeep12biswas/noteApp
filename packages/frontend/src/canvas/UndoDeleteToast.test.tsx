// Right-click → "Delete segment" and the undo toast (issue #29).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasRoot } from './CanvasRoot'
import { UndoDeleteToast } from './UndoDeleteToast'
import { useCanvasStore } from '../store/canvasStore'
import { useNotebookStore } from '../store/notebookStore'

afterEach(() => {
  cleanup()
  useCanvasStore.getState().commitDeleteSegment()
})
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null, recentlyDeleted: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas', background: null } },
  })
})

function renderPage() {
  return render(
    <>
      <CanvasRoot pageId="page-1" />
      <UndoDeleteToast />
    </>,
  )
}

/** A coloured segment: auto-delete would never remove it. */
function seedColouredSegment() {
  const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
  useCanvasStore.getState().setSegmentColor(id, '#2563eb', 'rgba(37, 99, 235, 0.08)')
  return id
}

async function deleteViaMenu(id: string) {
  fireEvent.contextMenu(screen.getByTestId(`segment-${id}`))
  const menu = await screen.findByRole('menu', { name: 'Segment colour' })
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete segment' }))
}

describe('Delete segment', () => {
  it('right-click → Delete segment removes even a coloured segment and shows the undo toast', async () => {
    const id = seedColouredSegment()
    renderPage()
    await deleteViaMenu(id)

    await waitFor(() => expect(screen.queryByTestId(`segment-${id}`)).toBeNull())
    expect(screen.queryByRole('menu', { name: 'Segment colour' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Segment deleted')
  })

  it('Undo brings the segment back with its colour and hides the toast', async () => {
    const id = seedColouredSegment()
    renderPage()
    await deleteViaMenu(id)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByTestId(`segment-${id}`)).toBeInTheDocument()
    expect(useCanvasStore.getState().segments[id]?.borderColor).toBe('#2563eb')
    expect(screen.queryByTestId('undo-delete-toast')).toBeNull()
  })

  it('Ctrl+Z outside a text field undoes the deletion', async () => {
    const id = seedColouredSegment()
    renderPage()
    await deleteViaMenu(id)
    act(() => {
      const focused = document.activeElement as HTMLElement | null
      focused?.blur()
    })
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(await screen.findByTestId(`segment-${id}`)).toBeInTheDocument()
  })

  it('Ctrl+Z inside a text field is left to that field', async () => {
    const id = seedColouredSegment()
    renderPage()
    await deleteViaMenu(id)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    expect(useCanvasStore.getState().segments[id]).toBeUndefined()
    input.remove()
  })

  it('Dismiss makes the deletion final', async () => {
    const id = seedColouredSegment()
    renderPage()
    await deleteViaMenu(id)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('undo-delete-toast')).toBeNull()
    expect(useCanvasStore.getState().recentlyDeleted).toBeNull()
    expect(useCanvasStore.getState().segments[id]).toBeUndefined()
  })
})
