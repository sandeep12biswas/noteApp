// One segment's editor host — DESIGN.md §4.1 (invisible segment model,
// hover-to-reveal, auto-delete when empty unless coloured) + §7.1
// (`editorRefs`). One TipTap `Editor` instance per segment; `ResizeObserver`
// wiring propagates content-driven height changes back into the store
// (`onHeightChange` from DESIGN.md §8.1's collision layer — full cascade
// nudging on overlap is Phase 3; this just keeps the box sized to its
// content for now).
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { useCanvasStore, type Segment } from '../store/canvasStore'

export function SegmentHost({ segment, onTextChange }: { segment: Segment; onTextChange: (id: string, text: string) => void }) {
  const activeSegmentId = useCanvasStore((s) => s.activeSegmentId)
  const setActiveSegment = useCanvasStore((s) => s.setActiveSegment)
  const updateSegmentContent = useCanvasStore((s) => s.updateSegmentContent)
  const updateSegmentHeight = useCanvasStore((s) => s.updateSegmentHeight)
  const deleteIfEmptyAndUncolored = useCanvasStore((s) => s.deleteIfEmptyAndUncolored)
  const registerEditor = useCanvasStore((s) => s.registerEditor)
  const unregisterEditor = useCanvasStore((s) => s.unregisterEditor)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const isActive = activeSegmentId === segment.id

  const editor = useEditor({
    extensions: [StarterKit],
    content: segment.content,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      updateSegmentContent(segment.id, json)
      onTextChange(segment.id, editor.getText())
    },
    onFocus: () => setActiveSegment(segment.id),
    onBlur: () => deleteIfEmptyAndUncolored(segment.id),
  })

  useEffect(() => {
    if (!editor) return
    registerEditor(segment.id, editor)
    return () => unregisterEditor(segment.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, segment.id])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const measured = Math.round(entry.contentRect.height)
      if (measured > 0) updateSegmentHeight(segment.id, measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.id])

  const revealed = isActive || segment.borderColor !== null

  return (
    <div
      ref={containerRef}
      data-testid={`segment-${segment.id}`}
      role="textbox"
      aria-label="Segment"
      className={
        'absolute min-h-[40px] rounded px-2 py-1 transition-colors ' +
        (revealed ? 'border' : 'border border-transparent hover:border-gray-200 dark:hover:border-gray-700')
      }
      style={{
        left: segment.x,
        top: segment.y,
        width: segment.w,
        zIndex: segment.zIndex,
        borderColor: segment.borderColor ?? undefined,
        backgroundColor: segment.fillColor ?? undefined,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
