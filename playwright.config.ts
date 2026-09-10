import { defineConfig, devices } from '@playwright/test'

// E2E suite lands in Phase 6/7 of EXECUTION_PLAN.md — this config exists
// now so `pnpm exec playwright install` and CI wiring are already correct
// by the time specs show up under e2e/.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
