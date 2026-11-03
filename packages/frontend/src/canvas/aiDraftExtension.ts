// An AI draft inside a segment ("/ Ask AI", canvas/SegmentHost.tsx): the
// user's prompt as one line, then the AI's answer typed in below it as it
// streams, shown tinted until the user chooses Keep or Discard.
//
// - Destination formatting: the text is inserted with the marks of the
//   place it was asked for (bold, colour, font family/size…) and newlines
//   split the block the draft is in, so it continues as the same kind of
//   block (paragraph, heading, list item). Keep leaves it as ordinary text.
// - History: the draft's own edits stay out of undo history. Keep re-inserts
//   the finished text as one change, so a single Ctrl+Z removes it all;
//   Discard deletes it without an undo entry, leaving the note as it was.
// - The draft is ordinary document content (saved like any other text);
//   only the tint and the pending state are session-only.
import { Extension } from '@tiptap/core'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface AiDraft {
  /** Start of the prompt line. */
  from: number
  /** End of the prompt text (the answer starts in the next block). */
  promptTo: number
  /** End of the draft — where the next streamed text goes. */
  to: number
  /** The destination formatting every inserted piece of text gets. */
  marks: readonly Mark[]
  /**
   * A line break is due before the next text. Breaks are only made when
   * text follows, so a trailing newline (or no answer at all) never leaves
   * an empty block behind.
   */
  pendingBreak: boolean
}

export const aiDraftKey = new PluginKey<AiDraft | null>('aiDraft')

type DraftMeta = { set: AiDraft | null }

export function getAiDraft(state: EditorState): AiDraft | null {
  return aiDraftKey.getState(state) ?? null
}

/** Block types a newline should split together with the paragraph inside them. */
const LIST_ITEMS = new Set(['listItem', 'taskItem'])

function splitDepth(doc: PMNode, pos: number): number {
  const $pos = doc.resolve(pos)
  return $pos.depth >= 2 && LIST_ITEMS.has($pos.node(-1).type.name) ? 2 : 1
}

/**
 * Inserts plain text at `pos` with `marks`. Newlines start a new block of
 * the same kind, lazily (see `AiDraft.pendingBreak`) and never an empty one.
 */
export function insertPlainText(
  tr: Transaction,
  pos: number,
  text: string,
  marks: readonly Mark[],
  pendingBreak = false,
): { pos: number; pendingBreak: boolean } {
  const schema = tr.doc.type.schema
  text.split('\n').forEach((line, i) => {
    if (i > 0) pendingBreak = true
    if (!line) return
    if (pendingBreak && tr.doc.resolve(pos).parent.content.size > 0) {
      const depth = splitDepth(tr.doc, pos)
      tr.split(pos, depth)
      pos += 2 * depth
    }
    pendingBreak = false
    tr.insert(pos, schema.text(line, marks))
    pos += line.length
  })
  return { pos, pendingBreak }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiDraft: {
      /** Writes `prompt` at `pos` and opens a draft; the answer starts on the next line. */
      startAiDraft: (options: { pos: number; prompt: string; marks: readonly Mark[] }) => ReturnType
      /** Types streamed `text` at the end of the open draft. */
      appendAiDraft: (text: string) => ReturnType
      /** Keeps the draft as ordinary text, as one undo step. */
      keepAiDraft: () => ReturnType
      /** Removes the draft, leaving the document as it was before it. */
      discardAiDraft: () => ReturnType
    }
  }
}

const noHistory = (tr: Transaction) => tr.setMeta('addToHistory', false)

export const AiDraftExtension = Extension.create({
  name: 'aiDraft',

  addCommands() {
    return {
      startAiDraft:
        ({ pos, prompt, marks }) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            noHistory(tr)
            const { pos: promptTo } = insertPlainText(tr, pos, prompt.replace(/\n+/g, ' '), marks)
            // The answer starts on the next line.
            tr.setMeta(aiDraftKey, { set: { from: pos, promptTo, to: promptTo, marks, pendingBreak: true } } satisfies DraftMeta)
          }
          return true
        },

      appendAiDraft:
        (text) =>
        ({ tr, state, dispatch }) => {
          const draft = getAiDraft(state)
          if (!draft) return false
          if (dispatch) {
            noHistory(tr)
            const { pos: to, pendingBreak } = insertPlainText(tr, draft.to, text, draft.marks, draft.pendingBreak)
            tr.setMeta(aiDraftKey, { set: { ...draft, to, pendingBreak } } satisfies DraftMeta)
          }
          return true
        },

      keepAiDraft:
        () =>
        ({ tr, state, view, dispatch }) => {
          const draft = getAiDraft(state)
          if (!draft) return false
          if (!dispatch) return true
          // Two transactions on purpose: take the draft out without an undo
          // entry, then put the same content back as one recorded change —
          // so undo removes the whole kept text in one step. The command's
          // own `tr` is never dispatched (it would no longer match the state).
          tr.setMeta('preventDispatch', true)
          const slice = state.doc.slice(draft.from, draft.to)
          view.dispatch(noHistory(state.tr.delete(draft.from, draft.to)).setMeta(aiDraftKey, { set: null } satisfies DraftMeta))
          view.dispatch(view.state.tr.replace(draft.from, draft.from, slice))
          return true
        },

      discardAiDraft:
        () =>
        ({ tr, state, dispatch }) => {
          const draft = getAiDraft(state)
          if (!draft) return false
          if (dispatch) noHistory(tr.delete(draft.from, draft.to)).setMeta(aiDraftKey, { set: null } satisfies DraftMeta)
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AiDraft | null>({
        key: aiDraftKey,
        state: {
          init: () => null,
          apply(tr, draft) {
            const meta = tr.getMeta(aiDraftKey) as DraftMeta | undefined
            if (meta) return meta.set
            if (!draft || !tr.docChanged) return draft
            // The user edited the segment while the draft is open: follow
            // the edit. Typing right before or after the draft stays outside it.
            const from = tr.mapping.map(draft.from, 1)
            const to = Math.max(from, tr.mapping.map(draft.to, -1))
            const promptTo = Math.min(to, Math.max(from, tr.mapping.map(draft.promptTo, -1)))
            return { ...draft, from, promptTo, to }
          },
        },
        props: {
          decorations(state) {
            const draft = aiDraftKey.getState(state)
            if (!draft) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(draft.from, draft.to, { class: 'ai-draft' }),
              Decoration.inline(draft.from, draft.promptTo, { class: 'ai-draft-prompt' }),
            ])
          },
        },
      }),
    ]
  },
})
