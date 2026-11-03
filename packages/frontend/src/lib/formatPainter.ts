// Format Painter (Word/OneNote's paintbrush tool) — capture the active
// selection's formatting, then re-apply exactly that formatting to a
// different selection (possibly in a different segment/editor entirely;
// see RibbonRoot.tsx's toggle button and CanvasRoot.tsx's pointerup
// applier for how the two ends of this get wired to whichever TipTap
// `Editor` is active at each moment). `applyFormat` *replaces* the
// target's formatting rather than merging with it — that's what makes the
// tool actually paint one specific look, not just add marks on top of
// whatever was already there.
import type { Mark } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

export interface CapturedFormat {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  subscript: boolean
  superscript: boolean
  fontFamily: string | null
  fontSize: string | null
  color: string | null
  highlightColor: string | null
  textAlign: string | null
}

/**
 * The formatting of the selection's first character, as Word does. Issue #9:
 * this used to require each format to cover the *whole* selection
 * (`isActive`), so a selection that wasn't uniformly formatted — e.g. a
 * double-clicked word plus its unformatted trailing space, or a heading
 * and the plain text after it — captured nothing and painted plain text.
 */
export function captureFormat(editor: Editor): CapturedFormat {
  const { state } = editor
  const { from, to, $from } = state.selection
  let marks: readonly Mark[] | null = null
  state.doc.nodesBetween(from, to, (node) => {
    if (marks) return false
    if (node.isText) marks = node.marks
    return true
  })
  // No text in the selection (e.g. only an empty line): fall back to what
  // would be typed at the selection start.
  const firstMarks: readonly Mark[] = marks ?? state.storedMarks ?? $from.marks()
  const mark = (name: string) => firstMarks.find((m) => m.type.name === name)
  const textStyle = (mark('textStyle')?.attrs ?? {}) as { fontFamily?: string | null; fontSize?: string | null; color?: string | null }
  const highlight = mark('highlight')

  return {
    bold: !!mark('bold'),
    italic: !!mark('italic'),
    underline: !!mark('underline'),
    strike: !!mark('strike'),
    subscript: !!mark('subscript'),
    superscript: !!mark('superscript'),
    fontFamily: textStyle.fontFamily ?? null,
    fontSize: textStyle.fontSize ?? null,
    color: textStyle.color ?? null,
    highlightColor: highlight ? ((highlight.attrs.color as string | null) ?? null) : null,
    // `textAlign` lives on the block (paragraph/heading — see
    // segmentEditorExtensions.ts's TextAlign config) the selection starts in.
    textAlign: ($from.parent.attrs.textAlign as string | null | undefined) ?? null,
  }
}

export function applyFormat(editor: Editor, format: CapturedFormat): void {
  const chain = editor.chain().focus().unsetAllMarks()

  if (format.bold) chain.setBold()
  if (format.italic) chain.setItalic()
  if (format.underline) chain.setUnderline()
  if (format.strike) chain.setStrike()
  if (format.subscript) chain.setSubscript()
  if (format.superscript) chain.setSuperscript()
  if (format.fontFamily) chain.setFontFamily(format.fontFamily)
  if (format.fontSize) chain.setFontSize(format.fontSize)
  if (format.color) chain.setColor(format.color)
  if (format.highlightColor) chain.setHighlight({ color: format.highlightColor })
  if (format.textAlign) chain.setTextAlign(format.textAlign)

  chain.run()
}
