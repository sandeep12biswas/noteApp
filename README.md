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

Every release is one versioned bundle per OS, built from a clean slate by one command. The version comes from the root `VERSION` file; `node scripts/sync-version.mjs` (run by both bundle scripts) copies it into `apps/electron/package.json`, `tauri.conf.json` and the `Cargo.toml`s, so Linux and Windows always ship the same number.

| | Linux | Windows |
|---|---|---|
| Build the bundle | `./scripts/linux/package.sh` | `.\scripts\windows\package.ps1` |
| Output (`dist-release/`) | `FlowNote-<ver>-linux-x86_64.run` (self-extracting installer), `.tar.gz` (bundle folder) | `FlowNote-<ver>-windows-x64.zip` |
| Bundle contents | `.deb`, `.AppImage`, `install.sh`, `uninstall.sh`, `lib/ui.sh`, README, guides (PDF + Word), `SHA256SUMS` | NSIS `setup.exe`, `.msi`, `Uninstall FlowNote.cmd` + `Uninstall-FlowNote.ps1`, README, guides (PDF + Word), `SHA256SUMS.txt` |
| CI | `Linux installer` workflow | `Windows installer` workflow |

Both bundle scripts delete every previous build output first (`--no-clean` / `-NoClean` for a faster incremental build), and both CI workflows run them and then test install → launch → uninstall on a fresh runner. Prebuilt bundles are the workflows' `flownote-linux` / `flownote-windows` artifacts (on `v*` tags, or run by hand).

### Linux

```bash
./FlowNote-<ver>-linux-x86_64.run         # double-click it, or run it: guided install (graphical with zenity/kdialog, else in the terminal)
./install.sh                              # same, from the unpacked bundle; asks system (.deb) vs just-me (AppImage)
./install.sh --appimage --silent          # no questions: AppImage under ~/.local, no root
./install.sh --deb --silent               # no questions: the .deb system package (sudo)
./uninstall.sh                            # asks, including whether to delete your notes
./uninstall.sh --remove-data              # ...or decide up front (--keep-data to keep them)
~/.local/opt/flownote/uninstall.sh        # the AppImage install carries its own uninstaller
```

`packaging/linux/install.sh` offers upgrade/repair when FlowNote is already installed, logs to `~/.cache/flownote-install.log`, and keeps working without FUSE 2 (the AppImage then unpacks itself on start). Notes live in `~/.config/@flownote/electron/` and survive an uninstall unless you ask for them to be deleted. Given its answers as flags (`--deb`/`--appimage`, `--remove-data`/`--keep-data`) and no terminal, a script never opens dialogs.

**Build and install from source in one go:** `./scripts/linux/install.sh [installer flags]` runs `package.sh`, then the bundle's `install.sh`; `./scripts/linux/uninstall.sh` runs `packaging/linux/uninstall.sh`. Requires `pnpm`, `node` and `cargo` on `PATH`.

### Windows 11

From a **PowerShell** prompt:

```powershell
.\scripts\windows\package.ps1      # clean build of the bundle (needs the Tauri prerequisites)
.\scripts\windows\install.ps1      # package.ps1, then runs the setup wizard (-Silent: setup.exe /S; -Msi: the .msi)
.\scripts\windows\uninstall.ps1    # Uninstall-FlowNote.ps1: -RemoveData, -KeepData, -Silent
```

The setup wizard is Tauri's NSIS installer customised in `tauri.conf.json` → `bundle.windows` (branded header/sidebar from `apps/tauri/src-tauri/installer/`, release-notice page, language selector, Start Menu folder) plus `installer/hooks.nsh`, which adds Start Menu entries for the PDF guides and the uninstaller. Per-user install, no admin needed. Requires `pnpm`, `node`, `cargo`/`rustup` and the [Tauri Windows prerequisites](https://tauri.app/start/prerequisites/) (Visual Studio C++ Build Tools + WebView2).

Installer artwork (the Linux icon set and the NSIS/MSI images) is generated from the app icon by `python3 scripts/assets/make-installer-art.py`.

### User Guide and Feature Guide (PDF and Word)

`docs/FlowNote-Installation-Guide.pdf`, `docs/FlowNote-User-Guide.pdf` and `docs/FlowNote-Feature-Guide.pdf` ship in both bundles (and in the Windows install). The same three guides are also built as Word documents (`docs/*.docx`) for editing or sharing; the bundles' `docs/` folders carry both (the Windows installer itself installs only the PDFs). Their sources are `docs/guides/*.html`. To regenerate after a UI change (Linux, with the app built and a display available):

```bash
pnpm docs:screenshots   # drives the real Electron app with a throwaway profile -> docs/guides/screenshots/*.png
pnpm docs:pdf           # headless Chrome -> docs/*.pdf (set CHROME_PATH if Chrome/Chromium isn't found)
pnpm docs:docx          # the same HTML -> docs/*.docx (Word)
pnpm docs               # all three
```

### macOS

Not yet scripted here — build with `pnpm --filter @flownote/tauri exec tauri build` from a Mac (produces a `.dmg`/`.app` under `apps/tauri/src-tauri/target/release/bundle/`) and install the `.dmg` as usual.

## Status

Under active development on `feature/linote`; see `EXECUTION_PLAN.md` for the phased build-out and `DESIGN.md` for the full spec.
