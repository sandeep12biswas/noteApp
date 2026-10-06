// The actual Ctrl+C/Ctrl+V paste handler for files (EXECUTION_PLAN.md
// "Features" file attachment entry) — one shared function, called from
// *both* SegmentHost.tsx and LinearSegmentHost.tsx's `editorProps.
// handlePaste`, not duplicated per host. `segmentEditorExtensions.ts`
// already enforces "one shared list, not per-host copies" for extensions
// for exactly this reason (a node type present in only one host throws "no
// node type X in this schema" the instant that content opens in the
// other) — a paste handler split between the two hosts would risk the same
// class of "forgot the other host" bug for the same reason.
//
// Takes the raw ProseMirror `EditorView` (not a TipTap `Editor`) since
// that's genuinely all `editorProps.handlePaste` is given — inserting the
// node via `view.dispatch(view.state.tr.replaceSelectionWith(...))`
// directly avoids the awkwardness of needing a `useRef` back to the
// `Editor` instance `useEditor()` itself hasn't finished constructing yet
// at the point `editorProps` is defined.
import type { EditorView } from '@tiptap/pm/view'
import type { Attachment, IPCAdapter } from '@flownote/ipc-adapter'
import { attachmentBlockAttrs } from '../canvas/attachmentBlockNode'

// Salted the same way and for the same reason as canvasStore.ts's
// makeSegmentId/notebookStore.ts's makeId: a bare per-module-load counter
// could collide with a real persisted attachment id from an earlier
// session.
const sessionSalt = Math.random().toString(36).slice(2, 8)
let nextAttachmentId = 1
export function makeAttachmentId(): string {
  return `attachment-${sessionSalt}-${nextAttachmentId++}`
}

/**
 * Chromium (and most browsers) name a real clipboard screenshot generically
 * — `image.png` for a plain screen-capture paste — while a file genuinely
 * copied from a file manager keeps its real name. Used to decide whether to
 * skip the attach-as-file-vs-embed prompt and go straight to an embed, per
 * the feature's own spec ("screenshots can be pasted directly as an
 * embedded file").
 */
export function looksLikeScreenshot(file: File): boolean {
  return file.type.startsWith('image/') && /^image\.(png|jpe?g|gif|webp)$/i.test(file.name)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // `reader.result` is a "data:<mime>;base64,<data>" URL — the sidecar
      // only wants the base64 payload itself.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

function insertAttachmentNode(view: EditorView, attachment: Attachment, mode: 'file' | 'embed'): void {
  const nodeType = view.state.schema.nodes.attachmentBlock
  if (!nodeType) return
  const node = nodeType.create(attachmentBlockAttrs(attachment, mode))
  view.dispatch(view.state.tr.replaceSelectionWith(node))
}

export interface AttachmentPasteHandlers {
  /** Opens `AttachmentChoiceMenu` (or equivalent) near the paste position; the caller's UI collects the user's pick and invokes it. */
  onChooseMode: (params: { x: number; y: number; fileName: string; onChoose: (mode: 'file' | 'embed') => void }) => void
}

/**
 * `editorProps.handlePaste`-shaped: return `true` once a file paste is
 * being handled (so TipTap doesn't also run its own default paste
 * behaviour for the same event), `false` to let a normal text paste
 * through untouched.
 */
export function handleAttachmentPaste(
  view: EditorView,
  event: ClipboardEvent,
  segmentId: string,
  ipc: IPCAdapter | null,
  handlers: AttachmentPasteHandlers,
): boolean {
  const files = event.clipboardData?.files
  if (!files || files.length === 0 || !ipc) return false

  const file = files[0]!
  const id = makeAttachmentId()
  const embedDirectly = looksLikeScreenshot(file)

  void fileToBase64(file)
    .then((dataBase64) => ipc.saveAttachment(id, segmentId, file.name || 'attachment', file.type || 'application/octet-stream', dataBase64))
    .then((attachment) => {
      if (embedDirectly) {
        insertAttachmentNode(view, attachment, 'embed')
        return
      }
      const coords = view.coordsAtPos(view.state.selection.from)
      handlers.onChooseMode({
        x: coords.left,
        y: coords.bottom,
        fileName: attachment.fileName,
        onChoose: (mode) => insertAttachmentNode(view, attachment, mode),
      })
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console -- best-effort UX; nothing else surfaces a failed attachment paste yet
      console.error('attachment paste failed', err)
    })

  return true
}
