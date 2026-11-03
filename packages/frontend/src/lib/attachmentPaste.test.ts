// The Ctrl+C/Ctrl+V file paste handler (EXECUTION_PLAN.md "Features" file
// attachment entry) — exercised against a real headless TipTap Editor's
// `view` (same pattern formatPainter.test.ts already uses), not a mounted
// SegmentHost, since the interesting behavior here is pure: given a
// ClipboardEvent and an IPCAdapter, does it save the file and insert the
// right node (or open the chooser instead)?
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { segmentEditorExtensions } from '../canvas/segmentEditorExtensions'
import { handleAttachmentPaste, looksLikeScreenshot } from './attachmentPaste'

let editors: Editor[] = []
function makeEditor(): Editor {
  const editor = new Editor({ extensions: segmentEditorExtensions, content: '<p></p>' })
  editors.push(editor)
  return editor
}
afterEach(() => {
  for (const editor of editors) editor.destroy()
  editors = []
})

// jsdom has neither a `ClipboardEvent` nor a `DataTransfer` constructor, so
// a plain object shaped like what `handleAttachmentPaste` actually reads
// (`event.clipboardData.files`) stands in for a real paste event.
function clipboardEventWithFiles(files: File[]): ClipboardEvent {
  return { clipboardData: { files } } as unknown as ClipboardEvent
}

function docHasAttachmentBlock(editor: Editor): boolean {
  const json = editor.getJSON() as { content?: { type: string }[] }
  return (json.content ?? []).some((n) => n.type === 'attachmentBlock')
}

describe('looksLikeScreenshot', () => {
  it('is true for a generically-named clipboard image', () => {
    expect(looksLikeScreenshot(new File(['x'], 'image.png', { type: 'image/png' }))).toBe(true)
  })

  it('is false for an image with a real file name', () => {
    expect(looksLikeScreenshot(new File(['x'], 'vacation.png', { type: 'image/png' }))).toBe(false)
  })

  it('is false for a non-image file even with a generic name', () => {
    expect(looksLikeScreenshot(new File(['x'], 'image.png', { type: 'text/plain' }))).toBe(false)
  })
})

describe('handleAttachmentPaste', () => {
  it('returns false and does nothing when the clipboard carries no files', () => {
    const editor = makeEditor()
    const saveAttachment = vi.fn()
    const event = { clipboardData: { files: [] } } as unknown as ClipboardEvent

    const handled = handleAttachmentPaste(editor.view, event, 'seg-1', { saveAttachment } as unknown as IPCAdapter, {
      onChooseMode: vi.fn(),
    })

    expect(handled).toBe(false)
    expect(saveAttachment).not.toHaveBeenCalled()
  })

  it('returns false when there is no IPC adapter available yet', () => {
    const editor = makeEditor()
    const event = clipboardEventWithFiles([new File(['x'], 'a.txt', { type: 'text/plain' })])

    const handled = handleAttachmentPaste(editor.view, event, 'seg-1', null, { onChooseMode: vi.fn() })

    expect(handled).toBe(false)
  })

  it('a screenshot-shaped file saves and embeds directly, with no chooser', async () => {
    const editor = makeEditor()
    const saveAttachment = vi.fn().mockResolvedValue({ id: 'att-1', fileName: 'image.png', mimeType: 'image/png', size: 3 })
    const onChooseMode = vi.fn()
    const event = clipboardEventWithFiles([new File(['abc'], 'image.png', { type: 'image/png' })])

    const handled = handleAttachmentPaste(editor.view, event, 'seg-1', { saveAttachment } as unknown as IPCAdapter, { onChooseMode })

    expect(handled).toBe(true)
    await vi.waitFor(() => expect(docHasAttachmentBlock(editor)).toBe(true))
    expect(saveAttachment).toHaveBeenCalledWith(expect.any(String), 'seg-1', 'image.png', 'image/png', expect.any(String))
    expect(onChooseMode).not.toHaveBeenCalled()
  })

  it('a non-screenshot file opens the chooser instead of inserting immediately', async () => {
    const editor = makeEditor()
    const saveAttachment = vi.fn().mockResolvedValue({ id: 'att-2', fileName: 'report.pdf', mimeType: 'application/pdf', size: 10 })
    const onChooseMode = vi.fn()
    const event = clipboardEventWithFiles([new File(['abc'], 'report.pdf', { type: 'application/pdf' })])

    handleAttachmentPaste(editor.view, event, 'seg-1', { saveAttachment } as unknown as IPCAdapter, { onChooseMode })

    await vi.waitFor(() => expect(onChooseMode).toHaveBeenCalled())
    expect(docHasAttachmentBlock(editor)).toBe(false)

    // The user's choice (made via whatever menu the host renders) is what
    // actually inserts the node.
    const params = onChooseMode.mock.calls[0]![0] as { onChoose: (mode: 'file' | 'embed') => void }
    params.onChoose('embed')
    expect(docHasAttachmentBlock(editor)).toBe(true)
  })
})
