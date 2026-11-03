---
name: run-electron
description: Build, launch, and drive FlowNote's Electron desktop shell (apps/electron). Use when asked to start/run/launch the desktop app, take a screenshot of it, or interact with its UI.
---

FlowNote's Linux shell is Electron (`apps/electron`), backed by the
`flownote-electron` Rust sidecar over electron-trpc. For agent/automated use,
drive it via the Playwright REPL at `driver.mjs` in this directory. Launch is
~2-3s once built; the app is a single `BrowserWindow`, no BrowserView split.

All paths below are relative to the repo root.

## Build (once, or after changing source)

```bash
pnpm --filter @flownote/electron run build      # apps/electron/dist/*.js
pnpm --filter @flownote/frontend run build       # packages/frontend/dist (loaded via file://)
cargo build --release -p flownote-electron       # target/release/flownote-electron sidecar
```

The Electron window loads `packages/frontend/dist/index.html` over `file://`
and spawns `target/release/flownote-electron` (or `target/debug/...` when
`VITE_DEV_SERVER_URL` is set) — see `apps/electron/src/main.ts`. All three
build steps above must be current, or you'll be looking at a stale build.

## Run (agent path)

```bash
node .claude/skills/run-electron/driver.mjs
```

This repo's container has a real X display at `:0` (`DISPLAY=:0`, no xvfb
needed here — check `echo $DISPLAY` and `ls /tmp/.X11-unix` first; if neither
exists, install `xvfb` and prefix with `xvfb-run -a`).

Wrap in tmux for interactive use:

```bash
tmux new-session -d -s flownote -x 200 -y 50
tmux send-keys -t flownote 'cd /home/sandeep/workspace/nodeJs/noteApp && DISPLAY=:0 node .claude/skills/run-electron/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t flownote -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t flownote 'launch' Enter
timeout 60 bash -c 'until tmux capture-pane -t flownote -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t flownote 'ss landing' Enter
tmux capture-pane -t flownote -p
```

Screenshots land in `/tmp/shots/` (override: `SCREENSHOT_DIR`).

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for the window |
| `ss [name]` | screenshot -> `/tmp/shots/<name>.png` |
| `click <css-sel>` | click element (via DOM, not coords) |
| `click-text <text>` | click button/link containing text |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `eval <js>` | evaluate in the page, print JSON |
| `text [css-sel]` | print innerText |
| `windows` | list all windows |
| `new-folder <name>` | drives SectionSidebar's "new folder" flow |
| `new-page <folderName> <fileName>` | drives PageList's "new page" flow (picks the existing folder by name) |
| `quit` | close app, exit |

## Run (human path)

```bash
pnpm --filter @flownote/electron run start   # opens a real window; useless headless
```

## Gotchas

- **Launch hangs ~30s with no error without `--disable-gpu` /
  `--disable-software-rasterizer`.** Electron gets stuck at native Chromium
  GPU init in this container. Always pass both flags (the driver does).
- **The unpackaged frontend build must use relative asset paths.**
  `packages/frontend/vite.config.ts` sets `base: './'` — without it, the
  built `index.html`'s `/assets/...` paths 404 under `file://` (a leading
  `/` resolves to filesystem root, not relative to the HTML file), and the
  window renders blank.
- **`electron-trpc`'s renderer preload needs `sandbox: false`.** Electron's
  default sandboxed preload can only resolve Node/Electron built-ins;
  `preload.ts`'s `require('electron-trpc/main')` throws "module not found"
  under it since the preload is only `tsc`-compiled, not bundled. Set on the
  `BrowserWindow`'s `webPreferences` (`apps/electron/src/main.ts`).
- **`electron-trpc@0.7.1` is only really compatible with `@trpc/client` /
  `@trpc/server` `10.45.2`**, not v11, despite its `>10.0.0` peer range —
  v11 restructured the client `runtime`/router internals (`transformer`,
  `getErrorShape`) that electron-trpc's IPC bridge reads directly. Symptoms
  under v11: a `TypeError: ...transformer... serialize` in the renderer, or
  (once patched around) requests that hang forever with an
  `UnhandledPromiseRejectionWarning: n.getErrorShape is not a function` in
  the **main process** output (not the renderer console — you have to pipe
  `app.process().stdout/stderr` to see it). Both `apps/electron` and
  `packages/ipc-adapter` pin `@trpc/client`/`@trpc/server` to `10.45.2`;
  `ElectronIPCAdapter` uses `createTRPCProxyClient` (the v10 API), not
  `createTRPCClient`. Don't bump these without re-verifying a real save
  round-trips through `launch` -> `new-folder` -> checking the SQLite file.
- **A stale `target/release/flownote-electron` silently skips new
  migrations/commands.** The unpackaged app always runs the `release`
  profile binary unless `VITE_DEV_SERVER_URL` is set — after any Rust
  change, `cargo build --release -p flownote-electron` or you're testing
  against old backend code with no error to tell you so.
- **New segments don't auto-focus.** Clicking empty canvas creates a
  segment (`CanvasRoot`/`canvasStore.createSegment`) but doesn't move focus
  into its TipTap editor, so `type` immediately after a click lands nowhere
  — click into the segment's box first (or `wait` for it, then `click` its
  `[data-testid="segment-<id>"]`).
- **contentEditable (TipTap) inputs aren't `<input>`.** Use `type`/`press`
  after clicking into the editor, not a `fill`-style command.

## Troubleshooting

- **Launch timeout:** re-run the three build steps above in order.
- **Blank white window:** check `packages/frontend/dist/index.html` for
  absolute `/assets/...` paths — the Vite `base` config regressed.
- **A save/mutation never resolves, no console error:** check
  `app.process().stderr` for main-process `UnhandledPromiseRejectionWarning`
  — the renderer's `console`/`pageerror` events never see main-process
  errors.
- **"Missing X server":** `echo $DISPLAY` / `ls /tmp/.X11-unix` — if empty,
  install `xvfb` and prefix the launch with `xvfb-run -a`.
