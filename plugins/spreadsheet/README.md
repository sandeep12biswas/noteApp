# Spreadsheet reference plugin

The reference implementation for FlowNote's plugin system (EXECUTION_PLAN.md
Phase 7, DESIGN.md §9.7) — a minimal grid block built entirely on
`@flownote/sdk`, demonstrating the full loop: registration, sandboxed
per-block rendering, `postMessage` storage, and the "disable → placeholder →
re-enable → restored" cycle DESIGN.md §9.7 step 8 describes.

A **real** third-party plugin wouldn't live in this repo at all
(`pnpm-workspace.yaml`'s comment on the `plugins/*` glob explains why this
one does) and would ship through `@flownote/cli`'s `build`/`pack` — that
tooling is a deferred follow-up this session didn't build (see
EXECUTION_PLAN.md Phase 7's notes), so this plugin is compiled and installed
by hand instead:

```bash
# 1. Compile @flownote/sdk and this plugin to plain ES modules (bare
#    `@flownote/sdk` imports are resolved at runtime via an import map —
#    PluginManager.tsx's `buildEntryDocumentUrl` and this plugin's own
#    grid.html both declare the same one — not bundled away at build time).
pnpm --filter @flownote/sdk exec tsc
pnpm --filter @flownote-plugins/spreadsheet exec tsc

# 2. Copy the compiled output to where PluginManager expects to find it —
#    `/sdk/` for the SDK, `/plugins/<pluginId>/` for each plugin (see
#    `pluginAssetUrl()` in PluginManager.tsx).
mkdir -p packages/frontend/public/sdk packages/frontend/public/plugins/com.sandeep.spreadsheet
cp packages/sdk/dist/*.js packages/frontend/public/sdk/
cp plugins/spreadsheet/dist/*.js plugins/spreadsheet/src/grid.html plugins/spreadsheet/flownote-plugin.json \
  packages/frontend/public/plugins/com.sandeep.spreadsheet/
```

Then, in the running app: Plugins (left sidebar) → Install… → paste the
contents of `flownote-plugin.json` → Install. `/sheet` in any segment then
inserts a spreadsheet block.
