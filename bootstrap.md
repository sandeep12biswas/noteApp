# FlowNote — Project Bootstrap Plan

**Status:** EXECUTED (2026-09-10) · Companion to `DESIGN.md` and `EXECUTION_PLAN.md`

## Context

`DESIGN.md` and `EXECUTION_PLAN.md` are in the repo (root, on `feature/linote`), and `EXECUTION_PLAN.md`'s "Phase 0 — Repo Bootstrap" / "Phase 1 — Dual-shell scaffold" sections already name the target layout. The repo itself is still just `README.md` + those docs — no workspace, no `package.json`, no `Cargo.toml` exist yet. This document turns that named layout into an actual runnable command sequence: initialize the pnpm + Cargo workspaces, scaffold the two shells and two shared packages, and wire up the linting/testing/CI tooling the later execution-plan phases assume is already in place, so the next PR can start writing real IPCAdapter/SQLite code instead of plumbing.

**Toolchain verified locally (2026-09-06), nothing further to install at the OS level:**

| Tool | Version |
|---|---|
| pnpm | 9.15.9 |
| node | v22.22.1 |
| rustc / cargo | 1.98.0 |
| rustup components | `clippy`, `rustfmt` already installed |
| Tauri Linux system deps | `webkit2gtk-4.1`, `javascriptcoregtk-4.1` already present |

## Target Layout

```
pnpm-workspace.yaml
package.json                 # root, private, holds shared devDeps (eslint, vitest, playwright, typescript)
tsconfig.json                 # root strict base config, extended by each package
Cargo.toml                    # workspace root
rust-toolchain.toml           # pins the toolchain used in CI
.eslintrc.cjs                 # root, includes the execCommand ban
.github/workflows/ci.yml      # ubuntu-24.04 / windows-2025 / macos-15 matrix

apps/electron/                # Linux shell (Electron v32)
apps/tauri/                   # Windows/macOS shell (Tauri v2), src-tauri/ is a Cargo workspace member
packages/frontend/            # Vite + React 19 + TS, shared by both shells
packages/ipc-adapter/         # IPCAdapter interface + ElectronIPCAdapter + TauriIPCAdapter stubs

crates/flownote-core/         # lib crate: storage/CRDT/collision/AI/plugin-storage (shared)
crates/flownote-electron/     # bin crate: sidecar entry point for the Electron shell
crates/flownote-tauri/        # lib crate: #[tauri::command] handlers, used by apps/tauri/src-tauri
crates/flownote-sync/         # bin/lib crate: Automerge WebSocket relay (axum)
```

## Command Sequence

Run from the repo root, in this order. Each step is independently verifiable before moving to the next.

**1. Root workspace files**
```bash
pnpm init                       # root package.json (private:true, add manually)
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - apps/*
  - packages/*
EOF
mkdir -p apps/electron apps/tauri packages/frontend packages/ipc-adapter \
         crates/flownote-core crates/flownote-electron crates/flownote-tauri crates/flownote-sync
```

**2. Frontend (Vite + React 19 + TS, per DESIGN.md §6.2)**
```bash
pnpm create vite@latest packages/frontend -- --template react-ts
cd packages/frontend
pnpm add zustand @tiptap/react @tiptap/starter-kit @tiptap/extension-task-list \
         @tiptap/extension-table @tiptap/extension-font-family @tiptap/extension-text-style \
         @tiptap/extension-highlight @tiptap/extension-color @tiptap/extension-subscript \
         @tiptap/extension-superscript
pnpm add -D tailwindcss @tailwindcss/vite
cd ../..
```

**3. IPC adapter package** (plain TS lib — interface + both stub implementations, DESIGN.md §3.3)
```bash
cd packages/ipc-adapter
pnpm init
mkdir -p src
# src/types.ts (IPCAdapter interface), src/electron.ts, src/tauri.ts, src/index.ts
cd ../..
```

**4. Electron shell (Linux)**
```bash
cd apps/electron
pnpm init
pnpm add electron-trpc
pnpm add -D electron@32 electron-builder
mkdir -p src
cd ../..
```

**5. Tauri shell (Windows/macOS)**
```bash
pnpm dlx create-tauri-app@latest apps/tauri --manager pnpm --template react-ts
```
Then hand-edit `apps/tauri/src-tauri/tauri.conf.json` so `build.frontendDist`/`build.devUrl` point at `packages/frontend`'s build output / dev server (shared frontend, not a private copy), and delete the copy of the frontend scaffold that `create-tauri-app` generates inside `apps/tauri` itself.
```bash
pnpm add -Dw tauri-specta
```

**6. Rust workspace**
```bash
cat > Cargo.toml <<'EOF'
[workspace]
resolver = "2"
members = [
  "crates/flownote-core",
  "crates/flownote-electron",
  "crates/flownote-tauri",
  "crates/flownote-sync",
  "apps/tauri/src-tauri",
]
EOF
cargo init --lib crates/flownote-core
cargo init --bin crates/flownote-electron
cargo init --lib crates/flownote-tauri
cargo init --bin crates/flownote-sync
cargo add -p flownote-core rusqlite r2d2 r2d2_sqlite refinery automerge tokio axum ollama-rs serde serde_json uuid
cargo add -p flownote-tauri tauri tauri-specta --features tauri/protocol-asset
cat > rust-toolchain.toml <<'EOF'
[toolchain]
channel = "1.98.0"
components = ["clippy", "rustfmt"]
EOF
```

**7. Root TypeScript, linting, testing**
```bash
pnpm add -Dw typescript eslint @eslint/js typescript-eslint eslint-plugin-react-hooks vitest @vitest/ui @playwright/test
pnpm exec playwright install --with-deps chromium
```
- Root `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`; `packages/frontend` and `packages/ipc-adapter` each get a local `tsconfig.json` that extends it.
- Root `.eslintrc.cjs`: add a `no-restricted-syntax` (or `no-restricted-properties`) rule banning `document.execCommand` inside `packages/frontend/**`, per DESIGN.md §5.4 / §10 ("Ribbon → segment dispatch" risk) — add it now while the tree is still empty so it's never violated later.
- `vitest.config.ts` at root with per-package includes; `playwright.config.ts` for the future E2E suite (Phase 6/7 of `EXECUTION_PLAN.md`).

**8. `.gitignore` additions** (current file is a generic Python template and covers none of this stack)
```
node_modules/
dist/
.vite/
target/
apps/tauri/src-tauri/target/
apps/tauri/src-tauri/gen/
*.log
.DS_Store
```

**9. CI matrix** (`.github/workflows/ci.yml`) — `ubuntu-24.04` / `windows-2025` / `macos-15`, each running `pnpm install --frozen-lockfile`, `pnpm -w tsc --noEmit`, `pnpm -w vitest run`, `cargo test`, `cargo clippy -- -D warnings`.

## Guidelines / Gotchas to Bake In Now

- **Scope `flownote-tauri` and `apps/tauri/src-tauri` out of the Linux CI job's Rust commands** (or gate them behind `cargo test --workspace --exclude flownote-tauri --exclude src-tauri` on `ubuntu-24.04`). Per DESIGN.md §3.1, Tauri/WebKitGTK is deliberately not used on Linux — but Cargo will still try to compile those crates on every runner unless excluded, which is wasted CI time at best and a build break at worst if a Linux runner lacks a Tauri-only system dep.
- **`flownote-core` must stay platform-agnostic** — no `tauri` or `electron` crate ever appears in its `Cargo.toml`. It's the one crate both `flownote-electron` and `flownote-tauri` depend on; keep that dependency direction one-way (DESIGN.md §6.3–6.4).
- **`packages/frontend` never imports `@tauri-apps/api` or `electron` directly** — only `packages/ipc-adapter` may reference platform IPC. This is the enforcement boundary from DESIGN.md §3.3 and is worth an ESLint `no-restricted-imports` rule scoped to `packages/frontend/**`, added at the same time as the `execCommand` ban in step 7.
- **Pin `packageManager` in the root `package.json`** (e.g. `"packageManager": "pnpm@9.15.9"`) so CI and every future contributor resolve the same pnpm version via Corepack.
- **Commit in small stages**, not one giant scaffold commit: (a) workspace files + empty dirs, (b) frontend scaffold, (c) ipc-adapter, (d) electron shell, (e) tauri shell, (f) Rust workspace + crates, (g) lint/test/CI tooling. Each stage should build/typecheck on its own so a bad step is easy to `git revert`.
- **Exit criteria** (matches `EXECUTION_PLAN.md` §0/Phase 1): `pnpm install` succeeds; `pnpm -w tsc --noEmit` passes; `cargo check --workspace` passes (with the Linux exclusion above applied on that runner); both shells launch to a blank window; CI is green on all three runners before any IPCAdapter/SQLite logic is written.

## Verification (once execution starts)

- After each numbered step, run the narrowest check available (`pnpm -F <pkg> build`, `cargo check -p <crate>`) rather than waiting until the end.
- After step 9, push a throwaway branch and confirm the CI matrix actually triggers and passes on all three OSes before merging the scaffold into `feature/linote`.
- Manually launch both shells once (`pnpm -F electron start`, `pnpm tauri dev` from `apps/tauri`) to confirm each opens a window backed by the (still-stubbed) `IPCAdapter` — this is the Phase 1 exit criterion from `EXECUTION_PLAN.md`.

---

*FlowNote · Bootstrap Plan · not yet executed · September 2026*
