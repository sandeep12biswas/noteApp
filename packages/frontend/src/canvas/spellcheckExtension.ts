// Live wavy-underline spell-check decoration — a TipTap v2 Extension
// (`@tiptap/pm/state`/`@tiptap/pm/view`, not v3's ProseMirror APIs; this
// codebase is pinned to `@tiptap/*: ^2` throughout). Added to
// `segmentEditorExtensions.ts`'s shared array, so it applies to both
// canvas (`SegmentHost`) and linear (`LinearSegmentHost`) editors for
// free — see that file's own module doc for why the two views must always
// share one extension list.
//
// Recomputation is debounced, not per-transaction: scanning a segment's
// full text against the dictionary on every keystroke, multiplied across
// every segment simultaneously open on a canvas, risks visible typing lag.
// Mirrors `canvasStore.ts`'s `scheduleHeightPersist`/`HEIGHT_SAVE_DEBOUNCE_MS`
// precedent for the same reason, just per-editor-instance here (each
// segment gets its own `Editor`/plugin instance) rather than that file's
// one-shared-timer-across-all-segments shape.
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { getSpellEngine, type Engine } from '../lib/spellcheck'

const RESCAN_DEBOUNCE_MS = 300
const WORD_PATTERN = /[A-Za-z']+/g

export const spellcheckPluginKey = new PluginKey<DecorationSet>('spellcheck')

/** Force-rescan meta flag — `triggerRescan()` uses this to bypass the debounce for an explicit user action (Add to Dictionary / Ignore), never for typing. */
const FORCE_RESCAN_META = 'flownote-spellcheck-force-rescan'

function scanDoc(state: EditorState, engine: Engine): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const match of node.text.matchAll(WORD_PATTERN)) {
      const word = match[0]
      // Skip anything that's not going to be a real dictionary hit either
      // way — a lone apostrophe or a single letter isn't worth flagging.
      if (word.length < 2) continue
      if (engine.check(word)) continue
      const from = pos + (match.index ?? 0)
      const to = from + word.length
      decorations.push(Decoration.inline(from, to, { class: 'spellcheck-error' }))
    }
  })
  return DecorationSet.create(state.doc, decorations)
}

export const Spellcheck = Extension.create({
  name: 'spellcheck',

  addProseMirrorPlugins() {
    let rescanTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    return [
      new Plugin({
        key: spellcheckPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, old: DecorationSet) {
            const forced = tr.getMeta(FORCE_RESCAN_META) as DecorationSet | undefined
            if (forced) return forced
            // Real recompute happens asynchronously (view.update, below) —
            // until that transaction lands, just remap the existing
            // decorations across this transaction's changes so they don't
            // drift out of position while typing.
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return spellcheckPluginKey.getState(state)
          },
        },
        view(view: EditorView) {
          const rescan = () => {
            if (destroyed) return
            getSpellEngine()
              .then((engine) => {
                if (destroyed) return
                const decorations = scanDoc(view.state, engine)
                view.dispatch(view.state.tr.setMeta(FORCE_RESCAN_META, decorations))
              })
              .catch((err: unknown) => {
                // Dictionary failed to load (offline asset missing, etc.) —
                // degrade to "no decorations", never crash the editor.
                // eslint-disable-next-line no-console
                console.error('spellcheck: rescan failed', err)
              })
          }

          const scheduleRescan = () => {
            if (rescanTimer) clearTimeout(rescanTimer)
            rescanTimer = setTimeout(rescan, RESCAN_DEBOUNCE_MS)
          }

          // Kick off the very first scan as soon as the dictionary is
          // ready, rather than waiting for the user's first keystroke.
          rescan()

          return {
            update(_view, prevState) {
              if (!view.state.doc.eq(prevState.doc)) scheduleRescan()
            },
            destroy() {
              destroyed = true
              if (rescanTimer) clearTimeout(rescanTimer)
            },
          }
        },
      }),
    ]
  },
})

/** Finds the misspelling decoration (if any) covering `pos` — the right-click branching logic in SegmentHost.tsx/LinearSegmentHost.tsx uses this to decide whether to open the spelling menu instead of (or, in linear mode, instead of nothing). */
export function misspelledWordAt(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const decorations = spellcheckPluginKey.getState(view.state)
  if (!decorations) return null
  const found = decorations.find(pos, pos)[0]
  if (!found) return null
  const { from, to } = found
  return { word: view.state.doc.textBetween(from, to), from, to }
}

/** Bypasses the debounce for an immediate recompute — used only by SpellingSuggestionMenu's "Add to Dictionary"/"Ignore" actions after they've mutated the shared engine, so the wavy underline disappears right away instead of waiting for the next keystroke-triggered rescan. */
export function triggerRescan(view: EditorView): void {
  getSpellEngine()
    .then((engine) => {
      const decorations = scanDoc(view.state, engine)
      view.dispatch(view.state.tr.setMeta(FORCE_RESCAN_META, decorations))
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('spellcheck: triggerRescan failed', err)
    })
}
