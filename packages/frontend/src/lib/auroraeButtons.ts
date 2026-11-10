// Turns a KDE Aurorae theme's button SVGs (see apps/electron/src/windowTheme.ts)
// into one small image per button state, for the title bar (layout/TitleBar.tsx).
//
// An Aurorae button file holds every state as a separately named element —
// `active-center`, `hover-center`, `pressed-center`, `inactive-center`,
// `hover-inactive-center`, … — usually placed side by side, often outside
// the nominal canvas. KWin draws a state by cropping the file to that
// element's bounds; this does the same: measure the element, drop the other
// states, set the viewBox to the element's box, and hand back a data: URL.
// The result is shown through <img>, so nothing in the SVG can run; it's
// also stripped of scripts/handlers before being briefly attached for
// measuring.
import type { ButtonTheme } from '@flownote/ipc-adapter'

export type ButtonArtName = keyof ButtonTheme['svgs']
export type ButtonState = 'active' | 'inactive' | 'hover' | 'hover-inactive' | 'pressed'
export const BUTTON_STATES: ButtonState[] = ['active', 'inactive', 'hover', 'hover-inactive', 'pressed']

export type ButtonArt = Record<ButtonArtName, Partial<Record<ButtonState, string>>>

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Bounds of `el` in the root <svg>'s user space; needs `root` attached to the document. */
export type Measure = (root: SVGSVGElement, el: SVGGraphicsElement) => Box | null

const SVG_NS = 'http://www.w3.org/2000/svg'

function sanitize(root: Element) {
  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((n) => n.remove())
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const external = (name === 'href' || name === 'xlink:href') && !attr.value.startsWith('#')
      if (name.startsWith('on') || external) el.removeAttribute(attr.name)
    }
  }
}

/** The SVG cropped to one state's element, as a data: URL; null if the file has no such state or can't be measured. */
export function cropState(svgText: string, state: ButtonState, measure: Measure = domMeasure): string | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (root.namespaceURI !== SVG_NS || root.localName !== 'svg' || doc.querySelector('parsererror')) return null
  sanitize(root)
  const target = doc.getElementById(`${state}-center`)
  if (!target) return null

  const live = document.importNode(root, true) as unknown as SVGSVGElement
  const box = measure(live, live.querySelector(`[id="${state}-center"]`) as SVGGraphicsElement)
  if (!box || !(box.width > 0) || !(box.height > 0)) return null

  // Drop every other state (but never an ancestor of the one we keep).
  for (const el of [...root.querySelectorAll('[id$="-center"]')]) {
    if (el !== target && !el.contains(target)) el.remove()
  }
  root.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
  root.setAttribute('width', String(box.width))
  root.setAttribute('height', String(box.height))
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root))
}

/** Real measurement: attach off-screen, map the element's box into the root's user space. */
export const domMeasure: Measure = (root, el) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none'
  host.appendChild(root)
  document.body.appendChild(host)
  try {
    const bb = el.getBBox()
    const toRoot = root.getScreenCTM()?.inverse().multiply(el.getScreenCTM() ?? new DOMMatrix())
    if (!toRoot) return null
    const pts = [
      [bb.x, bb.y],
      [bb.x + bb.width, bb.y],
      [bb.x, bb.y + bb.height],
      [bb.x + bb.width, bb.y + bb.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(toRoot))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  } catch {
    return null
  } finally {
    host.remove()
  }
}

export function buildButtonArt(theme: ButtonTheme, measure: Measure = domMeasure): ButtonArt {
  const art = {} as ButtonArt
  for (const name of Object.keys(theme.svgs) as ButtonArtName[]) {
    art[name] = {}
    for (const state of BUTTON_STATES) {
      const url = cropState(theme.svgs[name], state, measure)
      if (url) art[name][state] = url
    }
  }
  return art
}

/** The image for a state, falling back the way KWin does when a theme leaves one out. */
export function artFor(art: ButtonArt, name: ButtonArtName, state: ButtonState): string | undefined {
  const s = art[name]
  const chain: Record<ButtonState, ButtonState[]> = {
    active: ['active'],
    inactive: ['inactive', 'active'],
    hover: ['hover', 'active'],
    'hover-inactive': ['hover-inactive', 'hover', 'inactive', 'active'],
    pressed: ['pressed', 'hover', 'active'],
  }
  for (const c of chain[state]) if (s[c]) return s[c]
  return undefined
}
