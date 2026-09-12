import { defineConfig } from '@playwright/test'

// Electron-hosted E2E — EXECUTION_PLAN.md Phase 7 "Plugin system E2E
// tests". Deliberately a *separate* config/testDir from the top-level
// `playwright.config.ts` (whose own comment explains it's browser-only, no
// IPCAdapter, by design): the plugin system needs a real Electron shell —
// `flownote-plugin://` is a privileged custom protocol only `main.ts`
// registers, `resolveIPCAdapter()` only resolves against `window.electronTRPC`,
// and plugin installs/storage are real SQLite rows via the Rust sidecar. No
// `webServer` here — each spec launches/closes its own Electron process
// (see `launchApp()` in `helpers.ts`), the same way the `run-electron`
// skill's driver does, not `vite preview`.
export default defineConfig({
  testDir: '.',
  fullyParallel: false, // one Electron instance (and one SQLite file) per spec file, run serially
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    trace: 'on-first-retry',
  },
})
