// Shared by SegmentHost.tsx and LinearSegmentHost.tsx's `onCreate` — applies
// the persisted default-font preference (store/fontStore.ts) once, only to a
// segment that's still the blank starting doc. An already-typed segment
// (loaded from storage, or mid-edit) is left untouched: the default only
// ever shapes a brand-new note going forward, never rewrites existing text.
import type { Editor } from '@tiptap/react'
import { isEmptyDoc, type Segment } from '../store/canvasStore'
import { useFontStore } from '../store/fontStore'

export function applyDefaultFontIfNew(editor: Editor, segment: Segment): void {
  if (!isEmptyDoc(segment.content)) return
  const font = useFontStore.getState().defaultFont
  if (!font) return
  editor.chain().setFontFamily(font).run()
}
