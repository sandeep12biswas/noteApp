# Plugin system E2E (Electron-hosted)

EXECUTION_PLAN.md Phase 7's "Plugin system E2E tests" gate. Separate from
the top-level `e2e/` Playwright suite, which is deliberately browser-only
(no IPCAdapter — see its `playwright.config.ts`); the plugin system needs a
real Electron shell (`flownote-plugin://` is a privileged scheme only
`apps/electron/src/main.ts` registers, and plugin install/storage are real
SQLite rows through the Rust sidecar).

## Prerequisites (build once, or after changing source)

```bash
pnpm --filter @flownote/sdk exec tsc
pnpm --filter @flownote-plugins/spreadsheet exec tsc
mkdir -p packages/frontend/public/sdk packages/frontend/public/plugins/com.sandeep.spreadsheet
cp packages/sdk/dist/*.js packages/frontend/public/sdk/
cp plugins/spreadsheet/dist/*.js plugins/spreadsheet/src/grid.html plugins/spreadsheet/flownote-plugin.json \
  packages/frontend/public/plugins/com.sandeep.spreadsheet/

pnpm --filter @flownote/electron run build
pnpm --filter @flownote/frontend run build
cargo build --release -p flownote-electron
```

(The `public/plugins`/`public/sdk` copy only needs redoing after changing
the SDK or the spreadsheet plugin; the frontend build copies `public/`
through automatically via Vite.)

## Run

```bash
pnpm run test:e2e:electron
```

Each spec file gets its own Electron process and a fresh `--user-data-dir`
(so a fresh SQLite file — no state from a previous run, or from the
`run-electron` skill's own driver, leaks in); `helpers.ts`'s `launchApp()`
uses the same `--no-sandbox --disable-gpu --disable-software-rasterizer`
flags the `run-electron` skill's driver needs in this container (see that
skill's SKILL.md for why).
