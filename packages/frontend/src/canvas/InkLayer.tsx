// Ink drawing layer — DESIGN.md §5.5: an HTML5 Canvas overlay, inert
// (`pointer-events: none`) at rest and interactive only in Draw mode; sized
// via `ResizeObserver` with `devicePixelRatio` for retina displays;
// serialised to a PNG data URL and persisted via `ipc.saveInkLayer()` after
// each stroke. Stacks above `CanvasRoot` in the editor pane.
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

  // Resize the backing bitmap to match the container's on-screen size *
  // devicePixelRatio, preserving whatever was already drawn (a plain
  // width/height assignment clears the canvas, so the previous frame is
  // captured and redrawn scaled into the new size).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const container = canvas.parentElement
    if (!container) return

    const resize = (width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1
      const prev = canvas.width > 0 && canvas.height > 0 ? canvas.toDataURL('image/png') : null
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      if (prev) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, width, height)
        img.src = prev
      }
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      resize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const persist = () => {
    const canvas = canvasRef.current
    if (!canvas || !ipc) return
    const dataUrl = canvas.toDataURL('image/png')
    ipc.saveInkLayer(pageId, dataUrl).catch((err: unknown) => {
      // eslint-disable-next-line no-console -- best-effort persistence, same pattern as the Zustand stores' `persist()`
      console.error('InkLayer: saveInkLayer failed', err)
    })
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
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
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
