import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Electron's unpackaged/packaged windows both load this build over
  // `file://` (apps/electron/src/main.ts's `frontendIndexPath()`), where an
  // absolute `/assets/...` path resolves to filesystem root, not relative
  // to index.html — 404s on every asset. `base: './'` makes the emitted
  // references relative instead. Harmless for `vite dev`, which doesn't use
  // `base` for its in-memory serving.
  base: './',
  plugins: [react(), tailwindcss()],
})
