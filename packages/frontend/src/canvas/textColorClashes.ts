// Coloured text that is hard to read on the page's background (issue #12).
// The user's own text colours are never changed silently: ContrastNotice
// lists these and offers Adjust, which goes through here as one undoable
// transaction per segment, saved like any other edit.
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { adjustForContrast, CONTRAST_TEXT, contrastRatio, isParsableColor } from '../lib/textColors'

export interface Clash {
  segmentId: string
  color: string
  text: string
}

interface JSONMark {
  type: string
  attrs?: Record<string, unknown>
}
interface JSONNode {
  type?: string
  text?: string
  marks?: JSONMark[]
  content?: JSONNode[]
}

/** The text colour a run of text carries, when it isn't inside a highlight (a highlight sets its own background). */
function runColor(marks: readonly { type: string | { name: string }; attrs?: Record<string, unknown> }[] | undefined): string | null {
  if (!marks) return null
  const name = (m: (typeof marks)[number]) => (typeof m.type === 'string' ? m.type : m.type.name)
  if (marks.some((m) => name(m) === 'highlight')) return null
  const color = marks.find((m) => name(m) === 'textStyle')?.attrs?.color
  return typeof color === 'string' && isParsableColor(color) ? color : null
}

function clashes(color: string | null, background: string): color is string {
  return color !== null && contrastRatio(color, background) < CONTRAST_TEXT
}

/**
 * Every run of coloured text (`textStyle` colour) below 4.5:1 on
 * `background`, across the given segments' TipTap JSON. Adjacent text
 * nodes with the same colour count as one passage.
 */
export function findClashes(
  segments: readonly { id: string; content: Record<string, unknown> }[],
  background: string,
): Clash[] {
  const out: Clash[] = []
  for (const segment of segments) {
    let previous: Clash | null = null
    const walk = (node: JSONNode) => {
      if (node.type === 'text') {
        const color = runColor(node.marks)
        if (clashes(color, background)) {
          if (previous && previous.color === color) {
            previous.text += node.text ?? ''
          } else {
            previous = { segmentId: segment.id, color, text: node.text ?? '' }
            out.push(previous)
          }
        } else {
          previous = null
        }
        return
      }
      // A new block ends the passage.
      previous = null
      node.content?.forEach(walk)
    }
    walk(segment.content as JSONNode)
  }
  return out
}

/**
 * Re-colours each clashing run in `editor` to the nearest readable shade of
 * its hue, as one transaction (one undo step). Returns whether anything changed.
 */
export function adjustClashesInEditor(editor: Editor, background: string): boolean {
  const { state } = editor
  const textStyle = state.schema.marks.textStyle
  if (!textStyle) return false
  const tr = state.tr
  state.doc.descendants((node: PMNode, pos: number) => {
    if (!node.isText) return
    const color = runColor(node.marks)
    if (!clashes(color, background)) return
    const mark = node.marks.find((m) => m.type === textStyle)!
    tr.addMark(pos, pos + node.nodeSize, textStyle.create({ ...mark.attrs, color: adjustForContrast(color, background) }))
  })
  if (!tr.docChanged) return false
  editor.view.dispatch(tr)
  return true
}

/** The DOM spans in `editor` showing a clashing colour, for "Show me". */
export function clashingElements(editor: Editor, background: string): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('span[style*="color"]')).filter((el) => {
    if (el.closest('mark')) return false
    const color = el.style.color
    return !!color && isParsableColor(color) && contrastRatio(color, background) < CONTRAST_TEXT
  })
}
