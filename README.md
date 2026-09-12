# FlowNote

FlowNote is a cross-platform note-taking app with a free-form **canvas editor** — click anywhere on the page to start writing inside an auto-created, invisible segment (the "click anywhere and it just flows" feel of Microsoft OneNote). It targets **Linux**, **Windows**, and **macOS**, with a folder → file → editor three-panel shell, a ribbon toolbar, drawing/ink support, and a plugin system. See [`DESIGN.md`](DESIGN.md) for the full product and architecture spec.

## Repository layout

This is a pnpm + Cargo monorepo. Two desktop shells share one frontend:

```
apps/electron/          Linux desktop shell (Electron) — the only shell packaged for Linux
apps/tauri/              Windows/macOS desktop shell (Tauri v2)
packages/frontend/       Vite + React 19 + TypeScript UI, shared by both shells
packages/ipc-adapter/    IPCAdapter interface + ElectronIPCAdapter/TauriIPCAdapter implementations
packages/sdk/            Plugin SDK
packages/cli/            @flownote/cli — plugin scaffolding/packaging tool
plugins/                 First-party example plugin(s)
crates/flownote-core/    Storage/CRDT/collision/plugin-storage — shared by both native backends
crates/flownote-electron/  Sidecar binary spawned by the Electron shell
crates/flownote-tauri/   #[tauri::command] handlers used by apps/tauri/src-tauri
crates/flownote-sync/    Automerge WebSocket relay
scripts/linux/           Linux install/uninstall scripts (see below)
scripts/windows/         Windows install/uninstall scripts (see below)
```

**Why two shells?** Electron only ships a Linux package; Windows and macOS are built with Tauri instead (smaller installers, native WebView2/WKWebView). Both wrap the exact same `packages/frontend` build — the shell is just the native chrome + IPC.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| [pnpm](https://pnpm.io) | 9.15.9 | Pinned via `packageManager` in `package.json`; use Corepack (`corepack enable`) or install directly |
| [Node.js](https://nodejs.org) | 22.x | |
| [Rust](https://rustup.rs) | 1.98.0 (pinned in `rust-toolchain.toml`) | `clippy` and `rustfmt` components |
| Linux only | `webkit2gtk-4.1`, `javascriptcoregtk-4.1` system packages | needed by Tauri tooling even on a Linux dev machine, and by `electron-builder`'s AppImage step |

## Development

```bash
pnpm install                       # install all workspace deps
pnpm -w run tsc                    # typecheck every package
pnpm -w run lint                   # eslint
pnpm -w run test                   # vitest (unit tests, all packages)
pnpm -w run test:e2e               # Playwright, browser-driven suite
pnpm -w run test:e2e:electron      # Playwright, drives the real Electron shell
cargo check --workspace            # Rust
```

Run a shell in dev mode:

```bash
# Linux (Electron)
pnpm --filter @flownote/electron run start

# Windows/macOS (Tauri)
pnpm --filter @flownote/tauri exec tauri dev
```

The `run-electron` and `run` skills in `.claude/skills/` automate driving the Electron shell headlessly for agents; see `.claude/skills/run-electron/SKILL.md`.

## Building & installing FlowNote

FlowNote isn't distributed as prebuilt binaries yet — building an installer means building it from this source tree on the target OS. `scripts/` wraps that into one command per OS. Each script builds the frontend, builds the native shell, produces a real platform installer (`.deb`/`.AppImage` on Linux, `.msi`/NSIS `.exe` on Windows), and installs it; the matching uninstaller removes it again.

### Linux

```bash
./scripts/linux/install.sh      # builds + installs FlowNote (prefers a .deb via apt/dpkg, falls back to an AppImage under ~/.local)
./scripts/linux/uninstall.sh    # removes it again, whichever install path was used
```

Requires `pnpm`, `node`, and `cargo` on `PATH`; `sudo` is used only for the `.deb` path (installing a system package and registering a desktop entry). Run `./scripts/linux/install.sh --help` for flags (e.g. `--appimage` to force the AppImage path even when `apt`/`dpkg` are available).

This is the same packaging `apps/electron/electron-builder.yml` and `pnpm --filter @flownote/electron run package` already produce — the script just builds all three pieces (frontend, Electron main process, Rust sidecar) in the right order and installs the result, instead of leaving you to run each step and the package manager by hand.

### Windows 11

Run from a **PowerShell** prompt (elevated if you don't already have Node/Rust/pnpm on `PATH` for all users):

```powershell
.\scripts\windows\install.ps1      # builds + runs the generated .msi installer
.\scripts\windows\uninstall.ps1    # finds FlowNote's registered uninstaller and runs it
```

Requires `pnpm`, `node`, and `cargo`/`rustup` on `PATH`, plus the [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/) (Microsoft Visual Studio C++ Build Tools + WebView2, which ships with Windows 11 by default). `install.ps1 -Silent` runs the `.msi` unattended (`/qn`); omit it to see the normal installer UI. `uninstall.ps1` reads the registered uninstall command from the Windows registry (the same one Settings → Apps uses), so it works regardless of whether the last install was silent.

### macOS

Not yet scripted here — build with `pnpm --filter @flownote/tauri exec tauri build` from a Mac (produces a `.dmg`/`.app` under `apps/tauri/src-tauri/target/release/bundle/`) and install the `.dmg` as usual.

## Status

Under active development on `feature/linote`; see `EXECUTION_PLAN.md` for the phased build-out and `DESIGN.md` for the full spec.
