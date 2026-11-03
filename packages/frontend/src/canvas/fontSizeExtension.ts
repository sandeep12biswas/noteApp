// Font size — TipTap v2 has no official font-size extension (unlike
// font-family/color, which ship as real packages), so this is the standard
// community recipe: a plain `Extension` that adds a `fontSize` attribute
// onto the `textStyle` mark (segmentEditorExtensions.ts already includes
// TextStyle for Color/FontFamily to piggyback on) plus the two commands the
// ribbon's font-size stepper (RibbonRoot.tsx's FontSizeStepper) dispatches
// through the usual getActiveEditor() path.
import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType
      unsetFontSize: () => ReturnType
    }
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) return {}
              return { style: `font-size: ${attributes.fontSize}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).run(),
    }
  },
})
