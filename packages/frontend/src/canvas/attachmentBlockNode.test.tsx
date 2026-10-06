// attachmentBlockNode — EXECUTION_PLAN.md "Features" file attachment
// entry. Exercised through a real segment editor (CanvasRoot/SegmentHost)
// rather than mounting `AttachmentBlockView` in isolation, mirroring
// pluginBlockNode.test.tsx's own reasoning: the interesting behavior is how
// it renders via TipTap's NodeView machinery from real segment content.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { CanvasRoot } from './CanvasRoot'
import { MAX_ATTACHMENT_EMBED_WIDTH, MIN_ATTACHMENT_EMBED_WIDTH, clampAttachmentWidth, formatFileSize } from './attachmentBlockNode'
import { useCanvasStore } from '../store/canvasStore'
import { setIPCAdapter, useNotebookStore } from '../store/notebookStore'

afterEach(() => {
  cleanup()
  setIPCAdapter(null)
})
beforeEach(() => {
  useCanvasStore.setState({ segments: {}, activeSegmentId: null })
  useNotebookStore.setState({
    files: { 'page-1': { id: 'page-1', name: 'Test', folderId: 'f1', content: '', updatedAt: 0, mode: 'canvas' } },
  })
})

function seedAttachmentSegment(mode: 'file' | 'embed', overrides: Record<string, unknown> = {}) {
  const id = useCanvasStore.getState().createSegment('page-1', 0, 0)
  useCanvasStore.getState().updateSegmentContent(id, {
    type: 'doc',
    content: [
      {
        type: 'attachmentBlock',
        attrs: {
          attachmentId: 'att-1',
          mode,
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          size: 1536,
          width: 320,
          ...overrides,
        },
      },
    ],
  })
  return id
}

describe('formatFileSize', () => {
  it('renders bytes, KB, MB as appropriate', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1024 * 1024 * 2)).toBe('2.0 MB')
  })
})

describe('attachmentBlockNode', () => {
  it('renders a file-mode chip with the file name and a human-readable size', () => {
    seedAttachmentSegment('file')
    render(<CanvasRoot pageId="page-1" />)

    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('1.5 KB')).toBeInTheDocument()
  })

  it('clicking a file-mode chip calls ipc.openAttachment with its id', () => {
    const openAttachment = vi.fn().mockResolvedValue(undefined)
    setIPCAdapter({ openAttachment } as unknown as IPCAdapter)
    seedAttachmentSegment('file')
    render(<CanvasRoot pageId="page-1" />)

    fireEvent.click(screen.getByText('notes.txt'))

    expect(openAttachment).toHaveBeenCalledWith('att-1')
  })

  it('renders an embed-mode image sourced from the flownote-attachment:// scheme', () => {
    seedAttachmentSegment('embed', { mimeType: 'image/png', fileName: 'screenshot.png' })
    render(<CanvasRoot pageId="page-1" />)

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe('flownote-attachment://att-1')
  })

  it('renders a generic file-preview box for a non-image embed', () => {
    seedAttachmentSegment('embed', { mimeType: 'application/pdf', fileName: 'report.pdf' })
    render(<CanvasRoot pageId="page-1" />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  it('renders a resize handle for an embed (the drag-resize affordance itself)', () => {
    seedAttachmentSegment('embed', { mimeType: 'image/png' })
    render(<CanvasRoot pageId="page-1" />)

    expect(screen.getByRole('button', { name: 'Resize notes.txt' })).toBeInTheDocument()
  })

  it('does not render a resize handle for a file-mode chip', () => {
    seedAttachmentSegment('file')
    render(<CanvasRoot pageId="page-1" />)

    expect(screen.queryByRole('button', { name: 'Resize notes.txt' })).toBeNull()
  })
})

// The actual pointer-drag resize interaction (SegmentHost.tsx's own width/
// height resize handles have the same gap) isn't covered by a simulated
// drag: jsdom has no `PointerEvent` constructor at all, so
// `fireEvent.pointerMove(..., { clientX })` silently drops `clientX` rather
// than throwing, making any such test assert on `NaN` instead of a real
// bug. `clampAttachmentWidth` — the one bit of actual logic in the drag
// handler — is tested directly instead.
describe('clampAttachmentWidth', () => {
  it('passes a value already inside the min/max range through unchanged', () => {
    expect(clampAttachmentWidth(400)).toBe(400)
  })

  it('clamps below the minimum', () => {
    expect(clampAttachmentWidth(-1000)).toBe(MIN_ATTACHMENT_EMBED_WIDTH)
  })

  it('clamps above the maximum', () => {
    expect(clampAttachmentWidth(10_000)).toBe(MAX_ATTACHMENT_EMBED_WIDTH)
  })
})
