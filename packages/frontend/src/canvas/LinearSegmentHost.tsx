// One segment's editor host in linear mode — DESIGN.md §4.3's "linear
// document mode". Unlike `SegmentHost` (absolute position, drag/resize,
// collision, invisible-until-hovered), a linear segment is just a row in a
// vertical stack: no positioning, no collision, always visible, with a
// coloured left border standing in for the canvas segment's colour (DESIGN.md
// §4.2) since there's no box left to draw a border around. Registers into
// the same `canvasStore.editorRefs`/`registerEditor` as `SegmentHost` so
// ribbon commands (`getActiveEditor()`) work identically in both modes —
// mode is purely a rendering choice, not a second copy of editing state.
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useCanvasStore, type Segment } from '../store/canvasStore'
import { applyDefaultFontIfNew } from './applyDefaultFontIfNew'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { misspelledWordAt } from './spellcheckExtension'
import { SpellingSuggestionMenu } from './SpellingSuggestionMenu'

export function LinearSegmentHost({ segment, onTextChange }: { segment: Segment; onTextChange: (id: string, text: string) => void }) {
  const setActiveSegment = useCanvasStore((s) => s.setActiveSegment)
  const updateSegmentContent = useCanvasStore((s) => s.updateSegmentContent)
  const registerEditor = useCanvasStore((s) => s.registerEditor)
  const unregisterEditor = useCanvasStore((s) => s.unregisterEditor)
  // Unlike SegmentHost, there's no colour menu in linear mode at all today
  // (a separate, pre-existing gap) — this is the only right-click behavior
  // this view has, so it's an unconditional open-if-hit, not a branch.
  const [spellMenu, setSpellMenu] = useState<{ x: number; y: number; word: string; from: number; to: number } | null>(null)

  const editor = useEditor({
    extensions: segmentEditorExtensions,
    content: segment.content,
    editorProps: { attributes: { spellcheck: 'false' } },
    onUpdate: ({ editor }) => {
      updateSegmentContent(segment.id, editor.getJSON())
      onTextChange(segment.id, editor.getText())
    },
    onFocus: () => setActiveSegment(segment.id),
    onCreate: ({ editor }) => applyDefaultFontIfNew(editor, segment),
  })

  useEffect(() => {
    if (!editor) return
    registerEditor(segment.id, editor)
    return () => unregisterEditor(segment.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, segment.id])

  return (
    <div
      data-testid={`linear-segment-${segment.id}`}
      role="textbox"
      aria-label="Segment"
      className="border-l-4 py-1 pl-3"
      style={{ borderColor: segment.borderColor ?? 'transparent' }}
      onContextMenu={(e) => {
        if (!editor) return
        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        const hit = pos ? misspelledWordAt(editor.view, pos.pos) : null
        if (!hit) return
        e.preventDefault()
        e.stopPropagation()
        setSpellMenu({ x: e.clientX, y: e.clientY, ...hit })
      }}
    >
      <EditorContent editor={editor} />
      {spellMenu && editor && (
        <SpellingSuggestionMenu
          x={spellMenu.x}
          y={spellMenu.y}
          word={spellMenu.word}
          from={spellMenu.from}
          to={spellMenu.to}
          editor={editor}
          onClose={() => setSpellMenu(null)}
        />
      )}
    </div>
  )
}
