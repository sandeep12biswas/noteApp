import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine, so it doesn't implement the geometry APIs
// ProseMirror (TipTap's engine) calls on every keystroke — `coordsAtPos`,
// `scrollToSelection`, and its own mousedown handler all end up calling
// these. Without them, typing into any TipTap editor under test throws.
// Real browsers implement both fully; these are just enough for jsdom not
// to crash — the actual geometry is meaningless here either way.
if (typeof document !== 'undefined') {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  }
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null
  }
}

// spellcheckExtension.ts fetches the bundled dictionary via plain
// same-origin `fetch('/dictionaries/en/...')` (see spellcheck.ts's module
// doc for why — a static asset, not an npm import). jsdom's environment
// has a real `fetch` (Node's own, via undici) but no origin to resolve a
// root-relative URL against, so every test that mounts a segment editor
// would otherwise log a "Failed to parse URL" rejection — harmless (the
// extension already degrades to "no decorations" on any load failure) but
// noisy across unrelated test files. A tiny valid-enough Hunspell aff/dic
// pair keeps the real code path exercised without real dictionary content
// mattering to any test that isn't specifically about spellcheck.
if (typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('dictionaries/en/en.aff')) return Promise.resolve(new Response('SET UTF-8\nTRY esianrtolcdugmphbyfvkwzESIANRTOLCDUGMPHBYFVKWZ\n'))
    if (url.includes('dictionaries/en/en.dic')) return Promise.resolve(new Response('0\n'))
    return realFetch(input, init)
  }) as typeof fetch
}

// jsdom has no Blob-backed object URL store — `PluginManager` wraps a
// plugin's entry script in a `blob:` URL so a sandboxed iframe can load it
// without a real file on disk. Real browsers implement both fully; a
// counter-based fake URL is enough for jsdom not to crash on it.
if (typeof URL !== 'undefined' && !URL.createObjectURL) {
  let nextBlobUrlId = 1
  URL.createObjectURL = () => `blob:mock-${nextBlobUrlId++}`
  URL.revokeObjectURL = () => {}
}
