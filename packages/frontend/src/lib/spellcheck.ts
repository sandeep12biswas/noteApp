// Spell-check engine — DESIGN.md-adjacent feature: a bundled offline
// dictionary (no network calls) with right-click suggestions, live
// wavy-underline decoration (spellcheckExtension.ts), and a persisted
// personal dictionary ("Add to Dictionary").
//
// The dictionary data itself is NOT imported as a JS module. `dictionary-en`
// (a devDependency here, kept only as the *source* of the two data files
// under `public/dictionaries/en/`) loads its data via `node:fs/promises` at
// its own module's top level — Node-only, and fatal in a browser bundle.
// Instead, `public/dictionaries/en/{en.aff,en.dic}` are fetched at runtime
// as plain static assets, same pattern as the plugin system's `public/sdk`/
// `public/plugins` assets (Vite copies `public/` straight through to
// `dist/`). To refresh the dictionary: reinstall `dictionary-en`, then
// re-copy its `index.aff`/`index.dic` over these two files.
//
// `nspell`'s own `is-buffer`-based Buffer detection doesn't recognise a
// plain `Uint8Array` (only a real Node `Buffer`), and its parsers call
// `.toString('utf8')` on whatever they're given — a `Uint8Array` doesn't
// have a string-decoding `toString(encoding)` overload, so passing one
// through silently corrupts the dictionary. Fetching the files as *text*
// (not `arrayBuffer()`) and passing plain strings to `nspell(aff, dic)`
// sidesteps this entirely — `nspell`'s constructor explicitly supports a
// plain string for both arguments (`typeof aff === 'string'`).
import nspell from 'nspell'
import type { IPCAdapter } from '@flownote/ipc-adapter'

const MAX_SUGGESTIONS = 5

export class Engine {
  #speller: ReturnType<typeof nspell>
  #personalWords = new Set<string>()
  #ignoredWords = new Set<string>()

  constructor(speller: ReturnType<typeof nspell>) {
    this.#speller = speller
  }

  check(word: string): boolean {
    const lower = word.toLowerCase()
    return this.#speller.correct(word) || this.#personalWords.has(lower) || this.#ignoredWords.has(lower)
  }

  suggest(word: string): string[] {
    return this.#speller.suggest(word).slice(0, MAX_SUGGESTIONS)
  }

  /** "Add to Dictionary" — permanent (caller persists via IPC), reflected in `nspell` itself so `correct()` also starts accepting it. */
  addPersonalWord(word: string): void {
    const lower = word.toLowerCase()
    this.#speller.add(word)
    this.#personalWords.add(lower)
  }

  /**
   * "Ignore" — session-only. Deliberately does NOT call `nspell.add()`: a
   * separate set keeps ignored words from ever being mistaken for
   * permanent personal-dictionary entries (e.g. by a future "manage my
   * dictionary" UI that would otherwise have no way to tell the two apart).
   */
  ignoreWord(word: string): void {
    this.#ignoredWords.add(word.toLowerCase())
  }

  /** Called once at startup (App.tsx) with previously-persisted words, before the user starts typing. Order-independent — safe to call whenever the persisted list and the engine both happen to be ready. */
  hydratePersonalWords(words: string[]): void {
    for (const word of words) this.addPersonalWord(word)
  }
}

async function fetchDictionaryText(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`failed to fetch ${path}: ${res.status}`)
  return res.text()
}

let enginePromise: Promise<Engine> | null = null

/** Lazily loads the bundled dictionary + constructs the one shared `Engine` instance — never re-fetches on repeat calls. */
export function getSpellEngine(): Promise<Engine> {
  enginePromise ??= loadEngine()
  return enginePromise
}

async function loadEngine(): Promise<Engine> {
  // Root-relative ("/dictionaries/...") resolves to the filesystem root
  // under Electron's unpacked `file://` load (found live) — this app's own
  // `vite.config.ts` already sets `base: './'` for exactly this reason
  // (favicon.svg etc. are referenced the same relative way in index.html).
  // A plain relative fetch resolves against the current document's own
  // URL either way (dev server or `file://`), so it works in both.
  const [aff, dic] = await Promise.all([fetchDictionaryText('dictionaries/en/en.aff'), fetchDictionaryText('dictionaries/en/en.dic')])
  return new Engine(nspell(aff, dic))
}

let ipc: IPCAdapter | null = null

/** Called once at startup (App.tsx) once `resolveIPCAdapter()` settles — same pattern as `InkLayer.tsx`'s module-level adapter injection. */
export function setIPCAdapter(adapter: IPCAdapter | null): void {
  ipc = adapter
}

/** Loads the persisted personal dictionary and applies it to the engine. No-op outside a real Electron/Tauri shell (no `ipc` set), same "client-only" fallback every other IPC-backed feature already has. */
export async function hydratePersonalDictionary(): Promise<void> {
  if (!ipc) return
  const words = await ipc.listDictionaryWords()
  const engine = await getSpellEngine()
  engine.hydratePersonalWords(words)
}

/** Persists a word via IPC, then applies it to the engine — used by SpellingSuggestionMenu's "Add to Dictionary". A no-op IPC call (client-only mode) still updates the engine locally so the word stops being flagged for the rest of the session. */
export async function addToPersonalDictionary(word: string): Promise<void> {
  if (ipc) await ipc.addDictionaryWord(word)
  const engine = await getSpellEngine()
  engine.addPersonalWord(word)
}
