// Format Painter (Word/OneNote's paintbrush tool) — capture the active
// selection's formatting, then re-apply exactly that formatting to a
// different selection (possibly in a different segment/editor entirely;
// see RibbonRoot.tsx's toggle button and CanvasRoot.tsx's pointerup
// applier for how the two ends of this get wired to whichever TipTap
// `Editor` is active at each moment). `applyFormat` *replaces* the
// target's formatting rather than merging with it — that's what makes the
// tool actually paint one specific look, not just add marks on top of
// whatever was already there.
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

export function captureFormat(editor: Editor): CapturedFormat {
  const textStyle = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; color?: string }
  const highlight = editor.getAttributes('highlight') as { color?: string }
  // `textAlign` is set on whichever block node the selection is in
  // (paragraph/heading — see `segmentEditorExtensions.ts`'s
  // `TextAlign.configure({ types: ['heading', 'paragraph'] })`); checking
  // both covers either case without needing to know which one it is.
  const blockAttrs = (editor.getAttributes('paragraph') as { textAlign?: string }).textAlign
    ? (editor.getAttributes('paragraph') as { textAlign?: string })
    : (editor.getAttributes('heading') as { textAlign?: string })

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    subscript: editor.isActive('subscript'),
    superscript: editor.isActive('superscript'),
    fontFamily: textStyle.fontFamily ?? null,
    fontSize: textStyle.fontSize ?? null,
    color: textStyle.color ?? null,
    highlightColor: editor.isActive('highlight') ? (highlight.color ?? null) : null,
    textAlign: blockAttrs.textAlign ?? null,
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
