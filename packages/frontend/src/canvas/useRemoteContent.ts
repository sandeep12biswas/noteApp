// Sync step S5: when another device changed a segment that's open here,
// `canvasStore.applyRemoteSegments` bumps its `remoteRev`, and this puts the
// new content into the already-mounted editor (whose `content` option was
// only read once, at creation). Shared by SegmentHost and LinearSegmentHost.
import type { Editor } from '@tiptap/react'
import { useEffect } from 'react'
import { deepEqual } from '../lib/deepEqual'
import type { Segment } from '../store/canvasStore'

export function useRemoteContent(editor: Editor | null, segment: Segment): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !segment.remoteRev) return
    if (deepEqual(editor.getJSON(), segment.content)) return
    const { from, to } = editor.state.selection
    const focused = editor.isFocused
    // No update event: this is the stored content already, saving it back
    // would only queue a pointless sync.
    editor.commands.setContent(segment.content, false)
    if (focused) {
      const max = editor.state.doc.content.size
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) })
    }
    // Only a remote change should push content in; local typing already is the editor's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, segment.remoteRev])
}
