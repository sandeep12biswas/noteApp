// The code block (issue #7): StarterKit's plain `codeBlock` replaced by
// `@tiptap/extension-code-block-lowlight` — same node name (`codeBlock`) and
// the same `language` attribute, so code blocks already saved in segments
// load unchanged — plus a node view with a language picker.
//
// Highlighting: lowlight (highlight.js grammars) turns the code into
// `hljs-*` spans as ProseMirror decorations; the colours are in index.css.
// "Auto" (`language: null`) lets highlight.js guess. Typing ```python at
// the start of a line still creates a Python block (CodeBlock's input rule).
//
// Leaving the block (issue #10): Esc moves the caret to a normal line below
// it, and a code block that ends the segment always has an empty paragraph
// after it, so a click below the block lands on a normal line instead of
// back at the end of the code. (TipTap's own exits — Enter three times at
// the end, ArrowDown on the last line — still work too.)
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { common, createLowlight } from 'lowlight'
import { useUIStore } from '../store/uiStore'

/** highlight.js's "common" bundle (~37 languages) — enough for notes without shipping all ~190 grammars. */
export const lowlight = createLowlight(common)

/** The picker's choices, by highlight.js language name. Every entry must be registered in `lowlight`. */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Plain text' },
  { id: 'bash', label: 'Bash' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'less', label: 'Less' },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'objectivec', label: 'Objective-C' },
  { id: 'perl', label: 'Perl' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'scss', label: 'SCSS' },
  { id: 'shell', label: 'Shell session' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'vbnet', label: 'VB.NET' },
  { id: 'wasm', label: 'WebAssembly' },
  { id: 'yaml', label: 'YAML' },
]

const AUTO = ''

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? AUTO
  // A language saved by an older version, or typed after ``` , that the
  // picker doesn't list — keep it selectable rather than showing "Auto".
  const known = language === AUTO || CODE_LANGUAGES.some((l) => l.id === language)
  return (
    <NodeViewWrapper className="code-block" data-language={language || 'auto'}>
      <select
        contentEditable={false}
        aria-label="Code language"
        className="code-block-language"
        value={language}
        disabled={!editor.isEditable}
        onChange={(e) => updateAttributes({ language: e.target.value || null })}
      >
        <option value={AUTO}>Auto-detect</option>
        {!known && <option value={language}>{language}</option>}
        {CODE_LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <pre>
        <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  )
}

/**
 * Moves the caret out of the code block it's in, onto the empty paragraph
 * right after it — created if there isn't one. False outside a code block.
 */
export function exitCodeBlock(editor: Editor): boolean {
  const { $head } = editor.state.selection
  if ($head.parent.type.name !== 'codeBlock') return false
  const after = $head.after()
  const next = editor.state.doc.resolve(after).nodeAfter
  const chain = editor.chain()
  if (!(next?.type.name === 'paragraph' && next.content.size === 0)) chain.insertContentAt(after, { type: 'paragraph' })
  return chain.setTextSelection(after + 1).scrollIntoView().run()
}

const trailingParagraphKey = new PluginKey('codeBlockTrailingParagraph')

/** An empty paragraph after a code block that ends the document, or null if none is needed. */
function addTrailingParagraph(state: EditorState): Transaction | null {
  if (state.doc.lastChild?.type.name !== 'codeBlock') return null
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return null
  // Out of undo history: it's scaffolding, not an edit the user made.
  return state.tr.insert(state.doc.content.size, paragraph.create()).setMeta('addToHistory', false).setMeta(trailingParagraphKey, true)
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Esc's other jobs come first: the "/" menu and an AI draft are
      // handled by SegmentHost's editorProps.handleKeyDown (which runs
      // before any keymap), and an armed Format Painter is switched off by
      // CanvasRoot — so leave Esc to it then.
      Escape: ({ editor }) => {
        if (useUIStore.getState().formatPainter.armed) return false
        return exitCodeBlock(editor as Editor)
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: trailingParagraphKey,
        appendTransaction: (_trs, _old, state) => addTrailingParagraph(state),
        // A note saved with a code block at the end gets its trailing
        // paragraph when it's opened, not only after the next edit.
        view: (view) => {
          queueMicrotask(() => {
            if (view.isDestroyed || !view.editable) return
            const tr = addTrailingParagraph(view.state)
            if (tr) view.dispatch(tr)
          })
          return {}
        },
      }),
    ]
  },
}).configure({ lowlight, defaultLanguage: null })
