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
