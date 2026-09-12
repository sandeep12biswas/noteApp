import { describe, expect, it } from 'vitest'
import nspell from 'nspell'
import { Engine } from './spellcheck'

// A tiny real Hunspell aff/dic — small enough to keep tests fast, real
// enough to exercise the actual nspell parsing path (not a stub).
const AFF = 'SET UTF-8\n'
const DIC = '2\nhello\nworld\n'

function makeEngine(): Engine {
  return new Engine(nspell(AFF, DIC))
}

describe('Engine', () => {
  it('check() is true for a dictionary word, false for an unknown one', () => {
    const engine = makeEngine()
    expect(engine.check('hello')).toBe(true)
    expect(engine.check('flownotex')).toBe(false)
  })

  it('addPersonalWord() makes an unknown word pass check(), case-insensitively', () => {
    const engine = makeEngine()
    engine.addPersonalWord('Sandeep')
    expect(engine.check('sandeep')).toBe(true)
    expect(engine.check('Sandeep')).toBe(true)
  })

  it('ignoreWord() makes check() pass for this engine instance, but never calls nspell.add() — a fresh Engine still rejects the word', () => {
    const engine = makeEngine()
    engine.ignoreWord('flownotex')
    expect(engine.check('flownotex')).toBe(true)

    const fresh = makeEngine()
    expect(fresh.check('flownotex')).toBe(false)
  })

  it('hydratePersonalWords() bulk-applies previously-persisted words without a prior addPersonalWord() call', () => {
    const engine = makeEngine()
    engine.hydratePersonalWords(['foo', 'bar'])
    expect(engine.check('foo')).toBe(true)
    expect(engine.check('bar')).toBe(true)
  })

  it('suggest() returns candidates for a near-miss misspelling, capped to 5', () => {
    const engine = makeEngine()
    const suggestions = engine.suggest('helo')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.length).toBeLessThanOrEqual(5)
    expect(suggestions).toContain('hello')
  })
})
