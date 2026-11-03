// Inserts an already-`saveAttachment`'d file as an `attachmentBlock` node —
// mirrors `insertPluginBlock.ts`'s shape (a thin `editor.chain()...run()`
// wrapper), called from `lib/attachmentPaste.ts`'s paste handler once the
// bytes are safely persisted and (for a non-screenshot file) the user has
// picked "Attach as file" or "Embed in note".
import type { Editor } from '@tiptap/react'
import type { Attachment } from '@flownote/ipc-adapter'
import { attachmentBlockAttrs } from './attachmentBlockNode'

export function insertAttachmentBlock(editor: Editor, attachment: Attachment, mode: 'file' | 'embed'): void {
  editor
    .chain()
    .focus()
    .insertContent({ type: 'attachmentBlock', attrs: attachmentBlockAttrs(attachment, mode) })
    .run()
}
