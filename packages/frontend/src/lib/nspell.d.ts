// `nspell` ships no types of its own and there's no @types/nspell package —
// this covers only the small slice of its API spellcheck.ts actually uses.
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
    add(word: string): NSpell
    remove(word: string): NSpell
  }

  function nspell(aff: string, dic?: string): NSpell

  export default nspell
}
