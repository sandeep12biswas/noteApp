// Ink drawing layer — DESIGN.md §5.5: an HTML5 Canvas overlay, inert
// (`pointer-events: none`) at rest and interactive only in Draw mode; sized
// via `ResizeObserver` with `devicePixelRatio` for retina displays;
// serialised to a PNG data URL and persisted via `ipc.saveInkLayer()` after
// each stroke, and loaded back via `ipc.getInkLayer()` whenever `pageId`
// changes. Stacks above `CanvasRoot` in the editor pane.
//
// Ink is anchored to fixed positions on the page, exactly like segments
// (which sit at fixed x/y in the same scroll container): it's never scaled.
// The canvas covers the visible editor area *or* the area the drawing
// actually reaches, whichever is larger — so when the editor gets narrower
// (a side panel widened, or the window resized) the drawing doesn't move or
// squash; the container just scrolls to the rest of it, as it does for a
// segment past the edge. (Until 2026-10-24 the drawing was rescaled to the
// new size on every resize and stretched to fit on load, and the distorted
// bitmap was then saved with the next stroke — permanently pulling ink out
// of line with the text it annotated.) A saved layer is assumed to have been
// drawn at the current devicePixelRatio; moving between a high-DPI and a
// standard screen changes its displayed size.
//
// This component isn't remounted between pages (EditorPane.tsx doesn't key
// it by pageId — only the `pageId` prop changes), so the load-on-page-open
// effect below must explicitly clear the previous page's drawing itself;
// there's no unmount to do it for free.
import { useEffect, useRef } from 'react'
import type { IPCAdapter } from '@flownote/ipc-adapter'
import { useInkStore, TOOL_WIDTH } from '../store/inkStore'

let ipc: IPCAdapter | null = null

/** Called once at startup (App.tsx) once `resolveIPCAdapter()` settles — same pattern as the Zustand stores. */
export function setIPCAdapter(adapter: IPCAdapter | null): void {
  ipc = adapter
}

export function InkLayer({ pageId, active }: { pageId: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const tool = useInkStore((s) => s.tool)
  const color = useInkStore((s) => s.color)

  // On-screen size of the scroll container, and the area the drawing
  // reaches (logical CSS px, from the canvas's top-left).
  const containerSizeRef = useRef({ w: 0, h: 0 })
  const extentRef = useRef({ w: 0, h: 0 })

  /**
   * (Re)sizes the canvas to max(container, drawing extent) * devicePixelRatio,
   * keeping the existing drawing at 1:1 — copied through an offscreen canvas
   * synchronously (a plain width/height assignment clears the canvas, and an
   * async PNG round-trip could race a stroke in progress).
   */
  const fitCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(containerSizeRef.current.w, extentRef.current.w)
    const h = Math.max(containerSizeRef.current.h, extentRef.current.h)
    const oldW = parseFloat(canvas.style.width) || 0
    const oldH = parseFloat(canvas.style.height) || 0
    if (Math.round(w) === Math.round(oldW) && Math.round(h) === Math.round(oldH)) return

    let copy: HTMLCanvasElement | null = null
    if (canvas.width > 1 && canvas.height > 1) {
      copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      copy.getContext('2d')?.drawImage(canvas, 0, 0)
    }
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    if (copy) ctx.drawImage(copy, 0, 0, oldW, oldH)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const container = canvas.parentElement
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      containerSizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height }
      fitCanvas()
    })
    observer.observe(container)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fitCanvas only reads refs
  }, [])

  // Load (or clear) this page's persisted ink layer whenever `pageId`
  // changes. Guarded by `cancelled` against a stale response landing after
  // the user has already switched to a *different* page (two `getInkLayer`
  // calls racing, e.g. a slow first response overtaken by a fast second).
  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    extentRef.current = { w: 0, h: 0 }
    fitCanvas()

    ipc
      .getInkLayer(pageId)
      .then((dataUrl) => {
        if (cancelled || !dataUrl) return
        const c = canvasRef.current
        const context = c?.getContext('2d')
        if (!c || !context) return
        const img = new Image()
        img.onload = () => {
          if (cancelled) return
          // Draw at its own size (never stretched), after growing the
          // canvas to cover wherever its ink actually is.
          const dpr = window.devicePixelRatio || 1
          const logicalW = img.naturalWidth / dpr
          const logicalH = img.naturalHeight / dpr
          const reach = inkExtentOf(img)
          extentRef.current = { w: reach.w / dpr, h: reach.h / dpr }
          fitCanvas()
          canvasRef.current?.getContext('2d')?.drawImage(img, 0, 0, logicalW, logicalH)
        }
        img.src = dataUrl
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console -- best-effort load, same pattern as `persist()`'s save
        console.error('InkLayer: getInkLayer failed', err)
      })
    return () => {
      cancelled = true
    }
  }, [pageId])

  const persist = () => {
    const canvas = canvasRef.current
    if (!canvas || !ipc) return
    const dataUrl = canvas.toDataURL('image/png')
    ipc.saveInkLayer(pageId, dataUrl).catch((err: unknown) => {
      // eslint-disable-next-line no-console -- best-effort persistence, same pattern as the Zustand stores' `persist()`
      console.error('InkLayer: saveInkLayer failed', err)
    })
  }

  /** Records that ink reaches (x, y) — the canvas then never shrinks below it. */
  const growExtent = (x: number, y: number) => {
    const pad = TOOL_WIDTH[tool]
    extentRef.current = {
      w: Math.max(extentRef.current.w, x + pad),
      h: Math.max(extentRef.current.h, y + pad),
    }
  }

  const strokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = TOOL_WIDTH[tool]
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = color
      ctx.globalAlpha = tool === 'marker' ? 0.5 : 1
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const rect = canvas.getBoundingClientRect()
    strokeStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    growExtent(e.clientX - rect.left, e.clientY - rect.top)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
    growExtent(e.clientX - rect.left, e.clientY - rect.top)
  }

  const endStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    const ctx = canvasRef.current?.getContext('2d')
    ctx?.closePath()
    persist()
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="ink-layer"
      aria-label="Ink drawing layer"
      className="absolute inset-0"
      style={{ pointerEvents: active ? 'all' : 'none', touchAction: active ? 'none' : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerLeave={endStroke}
    />
  )
}

/**
 * The bottom-right corner (in image pixels) of the non-transparent content
 * of a saved ink layer — its own canvas may have been much larger than the
 * drawing. Scans inwards from the bottom and right edges, so it stops early
 * for typical drawings.
 */
function inkExtentOf(img: HTMLImageElement): { w: number; h: number } {
  const { naturalWidth: w, naturalHeight: h } = img
  const scratch = document.createElement('canvas')
  scratch.width = w
  scratch.height = h
  const ctx = scratch.getContext('2d')
  if (!ctx || w === 0 || h === 0) return { w: 0, h: 0 }
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, w, h).data
  const alphaAt = (x: number, y: number) => data[(y * w + x) * 4 + 3]!
  let maxY = -1
  for (let y = h - 1; y >= 0 && maxY < 0; y--) {
    for (let x = 0; x < w; x++) if (alphaAt(x, y) > 0) { maxY = y; break }
  }
  if (maxY < 0) return { w: 0, h: 0 }
  let maxX = -1
  for (let x = w - 1; x >= 0 && maxX < 0; x--) {
    for (let y = 0; y <= maxY; y++) if (alphaAt(x, y) > 0) { maxX = x; break }
  }
  return { w: maxX + 1, h: maxY + 1 }
}
