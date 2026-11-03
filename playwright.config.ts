import { defineConfig, devices } from '@playwright/test'

// E2E suite — EXECUTION_PLAN.md Phase 6: "segment create/drag/colour/ink/
// slash/search" against the built frontend in a real Chromium browser
// (`webServer` below runs `vite preview` over the production build, not
// `vite dev`, so there's no dev-only behavior to account for). This
// deliberately tests the frontend standalone — no Electron, no IPCAdapter —
// the same "client-only state, no persistence" fallback App.tsx already has
// for exactly this case (`resolveIPCAdapter()` rejecting outside a real
// shell). CRDT sync and cross-platform (Windows/WebView2, macOS/WebKit) are
// out of reach here; Electron-specific behavior is covered separately by
// the `run-electron` skill, not this suite.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm --filter @flownote/frontend run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
