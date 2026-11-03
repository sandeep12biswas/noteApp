# @flownote/cli

Scaffold, build, dev, and pack FlowNote plugins — DESIGN.md §9.6.

```bash
npx @flownote/cli create my-plugin
cd my-plugin
npm install
npm run build      # or: npx flownote build
npx flownote pack  # -> my-plugin-0.1.0.fnp
```

## Commands

| Command | What it does |
|---|---|
| `flownote create <name> [--dir <path>]` | Scaffolds a new plugin project: `flownote-plugin.json`, `package.json`, `tsconfig.json`, `src/index.ts` (registers one block type + its slash command), `src/block.{html,ts}` (the per-instance block UI), `README.md`. |
| `flownote build [--cwd <path>]` | Runs `tsc` (the project's own `node_modules/.bin/tsc`, falling back to `npx tsc`). |
| `flownote dev [--cwd <path>] [--install-into <dir>]` | Runs `tsc --watch`; with `--install-into` pointing at a FlowNote checkout's `packages/frontend/public`, copies the manifest + built `dist/*.js` + `src/*.html` into `<dir>/plugins/<manifest.id>/` after every successful rebuild. |
| `flownote pack [--cwd <path>] [--out <file>]` | Validates the manifest (required fields, permission whitelist) and zips it + the built assets into a `.fnp` file. |

## Scope — what this deliberately doesn't do (yet)

This is a real, working v1, not the full DESIGN.md §9.6 flow:

- **No bundler.** DESIGN.md mentions a `vite.config.ts` for sandboxed-iframe
  bundling; every plugin in this codebase (including the spreadsheet
  reference plugin) instead ships plain `tsc` output loaded via a
  browser-native `<script type="module">` + an import map for the bare
  `@flownote/sdk` specifier — that already works end-to-end, so this CLI
  follows the same proven approach rather than adding a bundler with no
  current benefit.
- **`dev`'s "hot-reload" is rebuild-and-copy, not the postMessage-driven
  iframe-destroy-and-recreate** DESIGN.md's Developer sub-view describes.
  That sub-view (hot-reload indicator, console panel, `postMessage`
  inspector) doesn't exist in the app yet — EXECUTION_PLAN.md Phase 7 lists
  it as a known gap. Reload FlowNote's window to pick up a rebuilt plugin.
- **`.fnp` isn't signed**, and — more importantly — **nothing on the
  FlowNote side reads a `.fnp` yet**. `install_plugin` (the Rust command
  both desktop shells expose) only accepts a manifest JSON string today;
  installing a plugin still means pasting `flownote-plugin.json`'s
  contents into the Plugin Manager UI, the same manual step the
  spreadsheet reference plugin's own README documents. `pack` is still
  useful on its own (a single distributable file, a stable name, a real
  ZIP a checksum can be taken of) — it's just not consumable by the app yet.
- **Not published to npm** — `@flownote/sdk` isn't either yet (both are
  alpha-versioned, workspace-private packages for now).

## Zip format

`src/zip.ts` is a small, dependency-free, store-only (uncompressed) ZIP
writer — a plugin's assets are a handful of small JS/HTML files, so
compression buys little, and this keeps `pack` self-contained rather than
adding a zip library dependency for it. Verified against a real `unzip`
binary in `zip.test.ts`, not just a hand-written reader agreeing with
itself.
