// The code block (issue #7): StarterKit's plain `codeBlock` replaced by
// `@tiptap/extension-code-block-lowlight` — same node name (`codeBlock`) and
// the same `language` attribute, so code blocks already saved in segments
// load unchanged — plus a node view with a language picker.
//
// Highlighting: lowlight (highlight.js grammars) turns the code into
// `hljs-*` spans as ProseMirror decorations; the colours are in index.css.
// "Auto" (`language: null`) lets highlight.js guess. Typing ```python at
// the start of a line still creates a Python block (CodeBlock's input rule).
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'

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

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
}).configure({ lowlight, defaultLanguage: null })
