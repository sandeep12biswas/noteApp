// The `attachmentBlock` TipTap node — EXECUTION_PLAN.md "Features" file
// attachment entry. Same shape as `plugins/pluginBlockNode.tsx`'s
// `pluginBlock` (one atom node, `attrs` bag, `ReactNodeViewRenderer`) since
// that's the only precedent this codebase already has for a rich,
// non-text block embedded in a segment's content. Two render modes on the
// same node type rather than two node types, since which one a given
// attachment uses can change (the "attach as file / embed" choice) without
// needing to swap node types in the document:
//   - `mode: 'file'`   — a compact chip; click opens the file via the OS.
//   - `mode: 'embed'`  — an inline, drag-resizable preview (an `<img>` for
//     an image mimeType, a generic file-preview box otherwise).
// Attachment bytes never live in this node or the segment's own JSON
// content — only `attachmentId` (a foreign key into the backend
// `attachments` table) and display metadata are stored here; the bytes are
// served through the `flownote-attachment://<id>` scheme
// (apps/electron/src/main.ts) so a large screenshot never bloats the
// segment content this node lives inside, or the FTS index built from it.
import { mergeAttributes, Node, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useRef, useState } from 'react'
import { getIPCAdapter } from '../store/notebookStore'

export const MIN_ATTACHMENT_EMBED_WIDTH = 80
export const MAX_ATTACHMENT_EMBED_WIDTH = 900
export const DEFAULT_ATTACHMENT_EMBED_WIDTH = 320

export function clampAttachmentWidth(proposed: number): number {
  return Math.min(MAX_ATTACHMENT_EMBED_WIDTH, Math.max(MIN_ATTACHMENT_EMBED_WIDTH, proposed))
}

export interface AttachmentBlockAttrs {
  attachmentId: string
  mode: 'file' | 'embed'
  fileName: string
  mimeType: string
  size: number
  width: number
}

/** "1.2 KB" / "3.4 MB" — human-readable enough for a file chip's label; no need for anything fancier than base-1024 with one decimal place. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function FileChip({ fileName, size, attachmentId }: { fileName: string; size: number; attachmentId: string }) {
  return (
    <button
      type="button"
      onClick={() => void getIPCAdapter()?.openAttachment(attachmentId)}
      className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      <span aria-hidden>📎</span>
      <span className="max-w-[200px] truncate">{fileName}</span>
      <span className="text-xs text-gray-400">{formatFileSize(size)}</span>
    </button>
  )
}

function ResizableEmbed({
  attachmentId,
  fileName,
  mimeType,
  width,
  onResize,
}: {
  attachmentId: string
  fileName: string
  mimeType: string
  width: number
  onResize: (width: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const isImage = mimeType.startsWith('image/')
  const displayWidth = liveWidth ?? width

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const handle = e.currentTarget
    // Optional call — jsdom (this component's own tests) doesn't implement
    // `setPointerCapture` at all, unlike every real browser.
    handle.setPointerCapture?.(e.pointerId)
    const startClientX = e.clientX
    const startWidth = width
    let resolvedWidth = startWidth

    const onMove = (ev: PointerEvent) => {
      resolvedWidth = clampAttachmentWidth(startWidth + (ev.clientX - startClientX))
      setLiveWidth(resolvedWidth)
    }
    const onUp = () => {
      handle.releasePointerCapture?.(e.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      setLiveWidth(null)
      onResize(resolvedWidth)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  return (
    <div ref={containerRef} className="relative inline-block" style={{ width: displayWidth }} contentEditable={false}>
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- not a Next.js app; a plain <img> is correct here
        <img
          src={`flownote-attachment://${attachmentId}`}
          alt={fileName}
          className="block w-full rounded border border-gray-200 dark:border-gray-700"
        />
      ) : (
        <div className="flex w-full flex-col items-center gap-1 rounded border border-gray-200 bg-gray-50 p-4 text-center dark:border-gray-700 dark:bg-gray-800">
          <span aria-hidden className="text-2xl">
            📄
          </span>
          <span className="max-w-full truncate text-xs text-gray-600 dark:text-gray-300">{fileName}</span>
        </div>
      )}
      <div
        role="button"
        aria-label={`Resize ${fileName}`}
        onPointerDown={startResize}
        className="absolute top-1/2 -right-1 h-6 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-sm bg-gray-300 dark:bg-gray-600"
      />
    </div>
  )
}

function AttachmentBlockView({ node, updateAttributes }: NodeViewProps) {
  const { attachmentId, mode, fileName, mimeType, size, width } = node.attrs as AttachmentBlockAttrs

  return (
    <NodeViewWrapper data-testid={`attachment-block-${attachmentId}`} className="my-1">
      {mode === 'file' ? (
        <FileChip fileName={fileName} size={size} attachmentId={attachmentId} />
      ) : (
        <ResizableEmbed
          attachmentId={attachmentId}
          fileName={fileName}
          mimeType={mimeType}
          width={width}
          onResize={(w) => updateAttributes({ width: w })}
        />
      )}
    </NodeViewWrapper>
  )
}

export const AttachmentBlock = Node.create({
  name: 'attachmentBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      mode: { default: 'file' },
      fileName: { default: '' },
      mimeType: { default: 'application/octet-stream' },
      size: { default: 0 },
      width: { default: DEFAULT_ATTACHMENT_EMBED_WIDTH },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-attachment-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-attachment-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentBlockView)
  },
})

export function attachmentBlockAttrs(
  attachment: { id: string; fileName: string; mimeType: string; size: number },
  mode: 'file' | 'embed',
): AttachmentBlockAttrs {
  return {
    attachmentId: attachment.id,
    mode,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    width: DEFAULT_ATTACHMENT_EMBED_WIDTH,
  }
}
