// The one TipTap extension list every segment editor must use — canvas
// (`SegmentHost`) and linear (`LinearSegmentHost`) alike. A segment's
// persisted content is the same TipTap JSON document regardless of which
// view is rendering it (DESIGN.md §4.3's mode toggle is purely a rendering
// choice, not a second copy of the document), so an editor missing an
// extension the *other* view's editor has can't even load that content:
// hit live via `run-electron` — a segment with a `Highlight` mark
// (Phase 4) failed to open in linear mode with "There is no mark type
// highlight in this schema" until both editors shared this list.
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { PluginBlock } from '../plugins/pluginBlockNode'
import { FontSize } from './fontSizeExtension'
import { Spellcheck } from './spellcheckExtension'

export const segmentEditorExtensions = [
  StarterKit,
  // One generic node for every plugin block type (DESIGN.md §9.2
  // `registerBlockType`) — always present, never added/removed per plugin;
  // see pluginBlockNode.tsx's module doc for why.
  PluginBlock,
  TextStyle,
  Color,
  // Ribbon font-family picker (RibbonRoot.tsx's FontFamilySelect) — piggybacks
  // on TextStyle the same way Color does; lib/fontFamilies.ts is the preset list.
  FontFamily,
  // Ribbon font-size stepper (RibbonRoot.tsx's FontSizeStepper) — same
  // TextStyle piggyback; TipTap v2 has no official font-size package, so
  // this is a small local extension (fontSizeExtension.ts).
  FontSize,
  Highlight.configure({ multicolor: true }),
  TaskList,
  TaskItem.configure({ nested: true }),
  // Not in StarterKit (DESIGN.md §5.3 Home row needs all four): Underline
  // adds its own Mod-u shortcut; Subscript/Superscript come with their own
  // default shortcuts too (Mod-,/Mod-. in Word-style editors, though
  // TipTap's are Mod-Shift-, / Mod-Shift-.) — Phase 6 "keyboard shortcut
  // audit".
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  // Mutually exclusive per TipTap's own docs recipe — without `excludes`,
  // toggling both on the same selection stacks them instead of swapping.
  Subscript.extend({ excludes: 'superscript' }),
  Superscript.extend({ excludes: 'subscript' }),
  // Live wavy-underline spell-check (DESIGN.md-adjacent feature) — see
  // spellcheckExtension.ts's own module doc for why this must be shared
  // between both views like everything else here.
  Spellcheck,
]
