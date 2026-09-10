import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'packages/frontend/src/**/*.{test,spec}.{ts,tsx}',
      'packages/ipc-adapter/src/**/*.{test,spec}.ts',
      'apps/electron/src/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/target/**', 'e2e/**'],
    globals: false,
    passWithNoTests: true,
  },
})
