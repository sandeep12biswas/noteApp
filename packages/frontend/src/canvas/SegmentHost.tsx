// One segment's editor host — DESIGN.md §4.1 (invisible segment model,
// hover-to-reveal, auto-delete when empty unless coloured) + §7.1
// (`editorRefs`). One TipTap `Editor` instance per segment; `ResizeObserver`
// wiring propagates content-driven height changes back into the store
// (`onHeightChange`, cascaded in canvasStore). Drag (move) and resize
// (width) handles apply `resolvePosition()`/`clampResizeWidth()` on every
// `pointermove` and mutate this segment's own DOM style directly for 60fps
// (DESIGN.md §4.6/Phase 3) — the store only gets one commit, on release.
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { GAP_HIGHLIGHT_THRESHOLD, clampResizeWidth, idsWithinGap, resolvePosition } from '../lib/collision'
import { useCanvasStore, type Segment } from '../store/canvasStore'
import { useUIStore } from '../store/uiStore'
import { SegmentColorMenu } from './SegmentColorMenu'
import { segmentEditorExtensions } from './segmentEditorExtensions'
import { SlashMenu } from './SlashMenu'

const HIGHLIGHT_COLOR = '#60a5fa' // tailwind blue-400 — bright enough to read as "near" against an invisible-by-default segment

// Inline style, not a Tailwind class: a highlighted segment is very often
// not `revealed` (DESIGN.md §4.1 segments are invisible by rest), whose own
// `border-transparent` utility class would otherwise win the cascade over
// a same-specificity highlight class in an order that depends on Tailwind's
// generated stylesheet, not on which class was toggled on last. An inline
// style always wins, and clearing it (rather than setting `''`) hands
// control back to whatever React last rendered for this element — which is
// exactly "no inline borderColor" for an uncoloured segment.
function setHighlighted(el: HTMLElement | undefined, on: boolean) {
  if (!el) return
  if (on) el.style.borderColor = HIGHLIGHT_COLOR
  else el.style.removeProperty('border-color')
}

export function SegmentHost({ segment, onTextChange }: { segment: Segment; onTextChange: (id: string, text: string) => void }) {
  const activeSegmentId = useCanvasStore((s) => s.activeSegmentId)
  const setActiveSegment = useCanvasStore((s) => s.setActiveSegment)
  const updateSegmentContent = useCanvasStore((s) => s.updateSegmentContent)
  const updateSegmentHeight = useCanvasStore((s) => s.updateSegmentHeight)
  const updateSegmentPosition = useCanvasStore((s) => s.updateSegmentPosition)
  const updateSegmentWidth = useCanvasStore((s) => s.updateSegmentWidth)
  const setSegmentColor = useCanvasStore((s) => s.setSegmentColor)
  const deleteIfEmptyAndUncolored = useCanvasStore((s) => s.deleteIfEmptyAndUncolored)
  const registerEditor = useCanvasStore((s) => s.registerEditor)
  const unregisterEditor = useCanvasStore((s) => s.unregisterEditor)
  const registerSegmentEl = useCanvasStore((s) => s.registerSegmentEl)
  const unregisterSegmentEl = useCanvasStore((s) => s.unregisterSegmentEl)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const highlightedRef = useRef<Set<string>>(new Set())
  const isActive = activeSegmentId === segment.id

  const [colorMenu, setColorMenu] = useState<{ x: number; y: number } | null>(null)
  // `charPos` is the ProseMirror position right after the "/" — needed to
  // delete it before applying the chosen block type.
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number; charPos: number } | null>(null)

  const editor = useEditor({
    extensions: segmentEditorExtensions,
    content: segment.content,
    onUpdate: ({ editor }) => {
      const json = editor.getJSON()
      updateSegmentContent(segment.id, json)
      onTextChange(segment.id, editor.getText())

      // Slash command menu (DESIGN.md §4.4): opens only when the current
      // line is exactly "/" — an empty paragraph the user just typed "/"
      // into, never mid-word or on a non-empty line.
      const { $from } = editor.state.selection
      if ($from.parent.type.name === 'paragraph' && $from.parent.textContent === '/' && $from.parentOffset === 1) {
        // `coordsAtPos` needs real layout (`Range.getClientRects`,
        // `document.elementFromPoint`) that jsdom doesn't implement — falls
        // back to (0, 0) there rather than crashing the whole editor update;
        // real browsers always have this, so the menu still opens where
        // typed outside of tests.
        let coords = { left: 0, bottom: 0 }
        try {
          coords = editor.view.coordsAtPos($from.pos)
        } catch {
          // jsdom: no layout engine — see comment above.
        }
        setSlashMenu({ x: coords.left, y: coords.bottom, charPos: $from.pos })
      } else {
        setSlashMenu(null)
      }
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
    if (!el) return
    registerSegmentEl(segment.id, el)
    return () => unregisterSegmentEl(segment.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.id])

  // Segments start invisible/unfocused (DESIGN.md §4.1); `createSegment`
  // marks the new one active immediately, but that alone doesn't move DOM
  // focus into its ProseMirror node, so a click-to-create left the user
  // having to click a second time before they could type. Focus whenever
  // this segment newly becomes active — not on every render, since
  // `editor.isFocused` only differs from `isActive` right after creation or
  // a programmatic activeSegmentId change, never mid-typing.
  useEffect(() => {
    if (isActive && editor && !editor.isFocused) editor.commands.focus('end')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, editor])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // `entry.contentRect` deliberately unused — it excludes padding and
      // border, undercounting this element's actual footprint by ~10px
      // (`px-2 py-1` + the 1px border). Every collision function measures
      // in the same border-box terms `getBoundingClientRect()` returns, so
      // that's what has to feed `segment.h`, or two segments could visually
      // sit closer than DESIGN.md §4.6's 8px minimum gap while the AABB
      // math still thinks they're clear.
      const measured = Math.round(el.getBoundingClientRect().height)
      if (measured > 0) updateSegmentHeight(segment.id, measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.id])

  // Clears every currently-highlighted neighbour's border, tracked via
  // `highlightedRef` so drag/resize don't have to know which segments were
  // lit up on a previous frame.
  const clearHighlights = () => {
    const state = useCanvasStore.getState()
    for (const id of highlightedRef.current) setHighlighted(state.segmentEls.get(id), false)
    highlightedRef.current = new Set()
  }

  const updateHighlights = (box: { x: number; y: number; w: number; h: number }) => {
    const state = useCanvasStore.getState()
    const neighbours = state
      .segmentsForPage(segment.pageId)
      .filter((s) => s.id !== segment.id)
      .map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h }))
    const near = new Set(idsWithinGap(box, neighbours, GAP_HIGHLIGHT_THRESHOLD))

    for (const id of highlightedRef.current) if (!near.has(id)) setHighlighted(state.segmentEls.get(id), false)
    for (const id of near) if (!highlightedRef.current.has(id)) setHighlighted(state.segmentEls.get(id), true)
    highlightedRef.current = near
  }

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startX = segment.x
    const startY = segment.y
    // Captured once per drag, not read reactively per-move — CanvasRoot's
    // `transform: scale(zoom)` means a screen-pixel pointer delta maps to
    // `delta / zoom` canvas units (DESIGN.md §10 "Zoom corrects AABB
    // coordinates"); changing zoom mid-drag isn't a real scenario the ribbon
    // allows anyway (zoom buttons live outside this pointer capture).
    const zoom = useUIStore.getState().zoom
    let resolved = { x: startX, y: startY }

    const onMove = (ev: PointerEvent) => {
      const proposed = {
        x: startX + (ev.clientX - startClientX) / zoom,
        y: startY + (ev.clientY - startClientY) / zoom,
        w: segment.w,
        h: segment.h,
      }
      const existing = useCanvasStore.getState().aabbsForPage(segment.pageId, segment.id)
      resolved = resolvePosition(proposed, existing)
      const el = containerRef.current
      if (el) {
        el.style.left = `${resolved.x}px`
        el.style.top = `${resolved.y}px`
      }
      updateHighlights({ ...resolved, w: segment.w, h: segment.h })
    }
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      clearHighlights()
      updateSegmentPosition(segment.id, resolved.x, resolved.y)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startClientX = e.clientX
    const startW = segment.w
    const zoom = useUIStore.getState().zoom
    let resolvedW = startW

    const onMove = (ev: PointerEvent) => {
      const proposedW = startW + (ev.clientX - startClientX) / zoom
      const existing = useCanvasStore.getState().aabbsForPage(segment.pageId, segment.id)
      resolvedW = clampResizeWidth({ x: segment.x, y: segment.y, h: segment.h }, proposedW, existing)
      const el = containerRef.current
      if (el) el.style.width = `${resolvedW}px`
      updateHighlights({ x: segment.x, y: segment.y, w: resolvedW, h: segment.h })
    }
    const onUp = () => {
      handle.releasePointerCapture(e.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      clearHighlights()
      updateSegmentWidth(segment.id, resolvedW)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const applyCoreBlock = (id: string) => {
    if (!editor || !slashMenu) return
    const chain = editor.chain().focus().deleteRange({ from: slashMenu.charPos - 1, to: slashMenu.charPos })
    switch (id) {
      case 'paragraph':
        chain.setParagraph().run()
        break
      case 'heading1':
        chain.setHeading({ level: 1 }).run()
        break
      case 'heading2':
        chain.setHeading({ level: 2 }).run()
        break
      case 'heading3':
        chain.setHeading({ level: 3 }).run()
        break
      case 'bulletList':
        chain.toggleBulletList().run()
        break
      case 'orderedList':
        chain.toggleOrderedList().run()
        break
      case 'taskList':
        chain.toggleTaskList().run()
        break
      case 'blockquote':
        chain.toggleBlockquote().run()
        break
      case 'codeBlock':
        chain.toggleCodeBlock().run()
        break
      default:
        chain.run()
    }
    setSlashMenu(null)
  }

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
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setColorMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {revealed && (
        <div
          data-testid={`segment-${segment.id}-drag-handle`}
          role="button"
          aria-label="Move segment"
          className="absolute -top-2 -left-2 h-3 w-3 cursor-move rounded-sm border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
          onPointerDown={startDrag}
        />
      )}
      <EditorContent editor={editor} />
      {revealed && (
        <div
          data-testid={`segment-${segment.id}-resize-handle`}
          role="button"
          aria-label="Resize segment"
          className="absolute top-1/2 -right-1 h-4 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-sm bg-gray-300 dark:bg-gray-600"
          onPointerDown={startResize}
        />
      )}
      {colorMenu && (
        <SegmentColorMenu
          x={colorMenu.x}
          y={colorMenu.y}
          activeColor={segment.borderColor}
          onPick={(border, fill) => setSegmentColor(segment.id, border, fill)}
          onClear={() => setSegmentColor(segment.id, null, null)}
          onClose={() => setColorMenu(null)}
        />
      )}
      {slashMenu && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          onSelectCore={applyCoreBlock}
          onSelectPlugin={() => setSlashMenu(null)}
          onClose={() => setSlashMenu(null)}
        />
      )}
    </div>
  )
}
