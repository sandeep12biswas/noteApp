# FlowNote — Execution Plan

**Status:** IN PROGRESS — Phase 0 complete, Phase 1 scaffolding complete (2026-09-10); Phase 2 rows all done as of 2026-09-11, including a real Electron window launch (see that phase's Electron shell row for the three bugs that surfaced and were fixed) · **Based on:** `DESIGN.md` §3, §6, §9 (source: Notion "FlowNote — Canvas Editor Architecture" v1.4, §9 Implementation Plan) · **Repo state at time of writing:** empty scaffold (`README.md` only), branch `feature/linote`

This turns the design's 7-phase plan into a checklist-driven execution plan, scoped to actually bootstrapping this repo from scratch. Each phase lists concrete tasks, its testing gate, and an explicit exit criterion.

---

## 0. Repo Bootstrap (pre-Phase 1)

Nothing exists yet beyond `README.md`, so this has to happen before Phase 1's tasks make sense.

- [x] Initialize a **pnpm workspace** at the repo root:
  ```
  apps/electron/          # Electron shell (Linux)
  apps/tauri/             # Tauri shell (Windows/macOS)
  packages/frontend/      # Shared React UI (100% shared per DESIGN.md §6.2)
  packages/ipc-adapter/   # IPCAdapter interface + both implementations
  crates/flownote-core/       # Storage + CRDT + collision + AI + plugin storage
  crates/flownote-electron/   # Sidecar binary entry point (Linux)
  crates/flownote-tauri/      # Tauri command handlers (Win/macOS)
  crates/flownote-sync/       # Automerge WebSocket relay
  ```
- [x] Add root `pnpm-workspace.yaml`, root `tsconfig.json` (strict mode), root `.eslintrc` with a rule **banning `document.execCommand()`** in `packages/frontend` (DESIGN.md §5.4, §10 "Ribbon → segment dispatch" risk).
- [x] Add a Rust `Cargo.toml` workspace matching DESIGN.md §6.4.
- [x] Add `vitest` config for TypeScript unit tests and `Playwright` config for E2E (used from Phase 2 onward).
- [x] Add `cargo clippy` to the toolchain; wire both `cargo test`/`clippy` and `pnpm test` as local scripts before wiring CI.
- [x] Commit as the first change on `feature/linote` (or a sub-branch) — this is the literal starting point for Phase 1.

**Exit criteria:** ✅ met — `pnpm install` succeeds, `cargo check --workspace` (Tauri-excluded set on Linux) succeeds, `pnpm exec vitest run` / `cargo test` / `cargo clippy -- -D warnings` all pass green. See `bootstrap.md` (now marked executed) for the exact command sequence run.

---

## Phase 1 — Dual-shell scaffold (Week 1–2)

| Task | Details |
|---|---|
| Monorepo structure | ✅ Done — confirmed from Bootstrap above. |
| Rust workspace | ✅ Done — `flownote-core`, `flownote-electron`, `flownote-tauri`, `flownote-sync` crates present and compiling (`cargo check`/`test`/`clippy` clean locally on the Linux exclusion set). |
| SQLite setup | ✅ Schema v1.4 from DESIGN.md §7.2 (`pages`, `segments` + `idx_segments_page_pos`, `blocks`, `blocks_fts` FTS5, `plugins`, `plugin_storage`) in `crates/flownote-core/migrations/V1__init.sql`, applied by an in-house migration runner (`src/migrations.rs`) rather than `refinery` — refinery 0.9's `rusqlite` feature link-conflicts with the rusqlite 0.40 this crate needs; see that file's header comment. WAL mode + foreign keys wired in `src/db.rs`. 4 unit tests green. |
| IPCAdapter interface | ✅ Interface + stub `ElectronIPCAdapter`/`TauriIPCAdapter` in `packages/ipc-adapter` done (return-mock-data / throw-not-implemented stubs, typecheck+lint clean). ✅ Shared contract suite (`src/contract.test.ts`, 34 assertions) now runs identically against both stubs (DESIGN.md §10 "IPCAdapter type drift" mitigation) — extend its per-method cases as each adapter gains a real implementation. |
| Electron shell (Linux) | ✅ Sidecar start (`SidecarSupervisor`, crash-restart with backoff per DESIGN.md §10), the `electron-trpc` router (thin pass-through to the sidecar per method), and the preload bridge (`window.electronTRPC`) are wired and unit-tested (11 tests) — verified end-to-end by driving the real compiled sidecar binary over the actual protocol from Node. ✅ `electron-builder.yml` packages the frontend + release sidecar binary as `extraResources`; verified with a real `--dir` build (correct `resources/frontend`, `resources/bin/flownote-electron`, executable named `flownote`) — this also caught and fixed a real path-resolution bug in `main.ts`. ✅ **Launched as a real window** — this environment turned out to have a live X display (`:0`) after all; driven via a new Playwright REPL at `.claude/skills/run-electron/`. First launch surfaced three real bugs, all fixed and re-verified end-to-end (folder → page → segment created through the UI, confirmed written to the real SQLite file, surviving a full app restart): (1) `packages/frontend/vite.config.ts` needed `base: './'` — the built `index.html`'s absolute `/assets/...` paths 404 under `file://` loading, rendering a blank window; (2) `BrowserWindow`'s `webPreferences` needed `sandbox: false` — Electron's default sandboxed preload can't resolve `electron-trpc/main`, a third-party package, so it never exposed `window.electronTRPC`; (3) `electron-trpc@0.7.1` turned out only to actually work with `@trpc/client`/`@trpc/server` `10.45.2`, not the `^11` this repo had — v11 restructured internals electron-trpc's IPC bridge reads directly, so every save silently hung forever (no renderer-visible error; the failure only appeared as an `UnhandledPromiseRejectionWarning` in the **main process** output). Both packages pinned to `10.45.2`; `ElectronIPCAdapter` now uses `createTRPCProxyClient` (the v10 API). ✅ Also fixed: new segments now auto-focus their TipTap editor on creation (`SegmentHost`'s `isActive` effect), so click-to-create → type works in one click — verified live (typed text landed and round-tripped to SQLite via `saveSegment`). |
| Tauri shell (Win/macOS) | ✅ `flownote-tauri` has real `ping`/`get_page` commands over the SQLite pool (mirroring flownote-electron's sidecar protocol) and a `tauri-specta` builder that exports typed TS bindings to `packages/ipc-adapter/src/generated/tauri-bindings.ts` on every debug build; `TauriIPCAdapter.getPage` calls them for real. 12 Rust + 3 TS tests. Also fixed a pre-existing bug: `main.rs` referenced the scaffold's original crate name and wouldn't have compiled. ⬜ Compiles/tests locally only (this Linux env happens to have Tauri's system deps) — untested on actual Windows/macOS. |
| CI matrix | ✅ Done — `.github/workflows/ci.yml` runs `cargo test`, `cargo clippy`, `pnpm -w run tsc`, `pnpm -w vitest run`, `pnpm -w eslint .` on `ubuntu-24.04`/`windows-2025`/`macos-15`. Not yet pushed/verified actually green on GitHub Actions. |

**Testing gate:** ⬜ Not yet met — local `cargo test`/`clippy`/`tsc`/`vitest` all pass, but nothing has run on the actual three-OS CI matrix yet, and the shared IPCAdapter-stub integration suite doesn't exist.

**Exit criteria:** ⬜ Not yet met — both shells build/typecheck, but "launch to a blank window ... on all three target OSes in CI" hasn't been verified (this session has no display server and no Windows/macOS runner).

---

## Phase 2 — Canvas editor core + UI shell (Week 3–5)

| Task | Details |
|---|---|
| Three-panel chrome | ✅ Done — `RibbonRoot`, `SectionSidebar` (with a Plugins tab stub), `PageList`, `EditorPane`, `StatusBar` assembled in `AppShell`, per DESIGN.md §5.1–5.2. Tailwind CSS 4 wired in as part of this (was speced but never actually added when the frontend was scaffolded). 4 component tests. Panel widths are fixed, not yet drag-resizable (needs Phase 3's collision machinery). |
| Multi-tab ribbon | ✅ Tab bar done (Home/Insert/Draw/View, switch on click, tested) — `RibbonRoot`'s per-tab panel is still an empty placeholder. ⬜ The actual button groups from DESIGN.md §5.3 (Bold/Italic/font family/etc.) need `editorRefs`/`getActiveEditor()` to dispatch through, which doesn't exist until `CanvasRoot` does. Plugin ribbon-group slots not defined yet either (needs `ExtensionPointRegistry`, Phase 7). |
| Folder & file panels | ✅ Done, client-side state only — folder-only tree with auto-capitalized names, file counts, expand affordance (only shown when a folder has children), configurable max depth (default 7), natural ordering (both panels); file panel with natural ordering, filename validation (must start with a capital letter), new-page flow (pick-or-create folder → name), per-folder filename uniqueness, and both search modes (name / content, across all folders). 24 new tests (13 component + 11 store). ⬜ Not wired to IPCAdapter/SQLite yet (separate "IPCAdapter calls wired" row below) — state is lost on reload. ⬜ Changeable folder icons (built-in set + external import) not built — `Folder.icon` exists in the store shape for it to land in later. |
| `CanvasRoot` + `SegmentHost` | ✅ Done — `CanvasRoot` (click-to-create via `findFreePosition()`/`overlaps()` in new `lib/collision.ts`, 8px min gap) + `SegmentHost` (hover-to-reveal border, one TipTap `Editor` per segment, `ResizeObserver`-driven height, auto-delete-when-empty-unless-coloured). New `canvasStore` (DESIGN.md §7.1 shape: `segments`/`activeSegmentId`/`editorRefs`), client-side only. Segment text mirrors into `notebookStore.updateFileContent` so content search stays live. 10 new tests (7 collision + 3 CanvasRoot). ⬜ `resolvePosition()`/`clampResizeWidth()` (drag/resize) and the AABB cache are Phase 3's job — not started. |
| IPCAdapter calls wired | ✅ Done — new `folders` table + `pages.folder_id` + `segments.content` (V2 migration); `save_folder`/`list_folders`/`save_page`/`list_pages`/`list_segments`/`save_segment`/`save_segments_batch`/`delete_segment` implemented in both `flownote-electron`'s sidecar protocol and `flownote-tauri`'s commands (mirrored 1:1, 23 new Rust tests), plus a `cargo run -p flownote-tauri --example export_bindings` script to regenerate `tauri-bindings.ts` without a display server. `ElectronIPCAdapter` now has a real `electron-trpc` client (previously unwired — every method was a stub throw with nothing to call); `TauriIPCAdapter`'s new methods call the generated bindings. `notebookStore`/`canvasStore` reducers stay synchronous (existing callers/tests untouched) and fire-and-forget the matching IPC call after each mutation; `App.tsx` resolves the adapter once at startup, injects it into both stores, and hydrates folders/pages; `CanvasRoot` loads a page's persisted segments on mount. 10 new frontend IPC-wiring tests. ⬜ Not yet verified against a real running Electron/Tauri window (no display server in this environment — same limitation as Phase 1); `saveBlock`/`mergeSegments`/`search`/`setPageMode`/plugin IPC remain stubs, scoped to their own later phases. |
| Ink canvas layer | ✅ Done — `InkLayer` (DESIGN.md §5.5): HTML5 Canvas overlay stacked above `CanvasRoot`, `pointer-events: none` at rest and `all` only while the Draw ribbon tab is active, `ResizeObserver` + `devicePixelRatio`-aware resize that preserves the existing drawing (captured to a data URL and redrawn scaled rather than cleared). Pen/Marker/Eraser + a 5-colour swatch live in a new `inkStore` and render as the Draw tab's ribbon panel; Eraser uses `destination-out` compositing, Marker draws at 50% alpha. Calls `ipc.saveInkLayer(pageId, dataUrl)` after each stroke, same fire-and-forget + adapter-injection pattern as `notebookStore`/`canvasStore`. Verified live via the `run-electron` driver — drew a stroke, confirmed it survives switching tabs and that `pointer-events` genuinely toggles. 7 new tests (2 component, since jsdom has no `CanvasRenderingContext2D` to assert pixels against — stroke rendering itself is only exercised live). ⬜ `ipc.saveInkLayer` is still a stub on both `IPCAdapter` implementations (no `ink_layer` column on `pages`, no Rust command) — persistence is a no-op beyond the fire-and-forget call; loading a persisted ink layer back on page open isn't wired either. Both are natural follow-ups to the "IPCAdapter calls wired" pattern, scoped out here to keep this item to the frontend layer DESIGN.md §5.5 actually describes. |
| Page header | ✅ Done — page title (`EditorPane`'s `PageTitle`) is now a real borderless 26px `<input>`, not static text: commits on blur/Enter via a new `notebookStore.renameFile` (same validation + per-folder uniqueness rules as `createFile`, persisted via `ipc.savePage`), reverts with an inline error on an invalid/duplicate name, and reverts silently on Escape. Because `PageList` reads the same `notebookStore.files` map, a rename is reflected there immediately with no extra plumbing ("real-time sync to the page list"). 4 new tests + 4 new `renameFile` store tests. |
| ExtensionPointRegistry stub | ✅ Done — `extensionRegistry.ts`: empty Zustand slice for the five extension kinds DESIGN.md §8.1 lists (block types, section tabs, ribbon groups, slash commands, side panels), each entry namespaced `${pluginId}/${id}` (DESIGN.md §10 "TipTap schema conflict" mitigation) with a bulk `unregisterPlugin()` for disable/uninstall. Real (currently-empty) consultation wired into `RibbonRoot` (renders `ribbonGroups` for the active tab) and `SectionSidebar`'s Plugins area (renders `sectionTabs`) — `CanvasRoot`/`SlashMenu`/`SidePanel` consult it once their own features exist (Phase 4/7). 3 new tests. |

**Testing gate:** `vitest` unit tests for panel behaviors (capitalization, filename validation, natural ordering, search); manual smoke test of segment creation across all three shells.

**Exit criteria:** A user can create/select folders and files per §2.1–2.2 rules, and click anywhere in the editor pane to create a segment and type into it, backed by real SQLite storage (not stubs) on all three platforms.

---

## Phase 3 — Collision system (Week 6)

| Task | Details |
|---|---|
| AABB utility module | ✅ Done — `overlaps()`/`findFreePosition()` (Phase 2) plus new `resolvePosition()` (minimum-translation-vector depenetration, up to 20 iterations, clamped non-negative), `clampResizeWidth()` (caps rightward growth against vertically-overlapping neighbours, floors at `MIN_SEGMENT_WIDTH`), and `idsWithinGap()` (drives the gap highlight). All pure TypeScript, 20 new unit tests (28 collision tests total). |
| AABB cache in Zustand | Deliberately **not** a separate cache — `Segment.{x,y,w,h}` in `canvasStore.segments` already is the AABB (DESIGN.md's split into `segments`/`aabbCache` was to avoid recomputing from a richer Segment shape; here they're the same fields, so a mirror cache would just be a second source of truth to keep in sync). `aabbsForPage()` derives it on demand. |
| Drag + resize with collision | ✅ Done — `SegmentHost` gained a drag handle (top-left grip) and a resize handle (right edge): `pointermove` calls `resolvePosition()`/`clampResizeWidth()` and mutates the segment's own DOM `style.left/top/width` directly (no React re-render, no store write) every frame; `pointerup` commits once via new `canvasStore.updateSegmentPosition`/`updateSegmentWidth` (persisted through `ipc.saveSegment`, same fire-and-forget pattern as other mutations). Verified live via `run-electron`: two segments dragged together stop at exactly the 8px minimum gap; resize clamped correctly. |
| Height propagation | ✅ Done — `updateSegmentHeight` calls new `cascadePushBelow(id, visited, depth)`: pushes every segment now overlapping the grown one down to clear the gap, recursing onto whatever *those* newly overlap, guarded by both a `visited` set (cycle safety) and DESIGN.md §10's max-depth-20 cap; all pushed segments are saved in one `ipc.saveSegmentsBatch()` call. 6 new cascade tests (chain of 3, no-op on shrink, no-op across columns, etc). ⬜ No explicit 100ms debounce — each `ResizeObserver` tick currently fires its own batch save; acceptable for now since typing-driven height changes are already coalesced by TipTap's own update batching, revisit if it shows up as excessive IPC traffic. |
| Gap highlight + unit tests | ✅ Done — a segment within 16px (`GAP_HIGHLIGHT_THRESHOLD`) of the one being dragged/resized gets its border set to blue-400 via **inline style**, not a Tailwind class (a highlighted segment is very often not `revealed`/visible at rest, and a same-specificity class toggle loses to `border-transparent` depending on the generated stylesheet's order, not JS toggle order — a real bug hit and fixed live, see below). Full `vitest` suite for all collision functions (28 tests) + 6 `canvasStore` drag/resize/cascade tests + a regression test for the height-measurement bug below. ⬜ No dashed 1px gap line rendered — the border highlight alone was judged sufficient signal; flagged as a follow-up if it reads as insufficient in practice. |

**A real bug found via live QA, not caught by any unit test:** `ResizeObserver`'s `contentRect` excludes padding and border, undercounting a segment's actual on-screen footprint by ~10px (`px-2 py-1` + the 1px border) — every collision function measures in border-box terms, so `segment.h` was silently ~10px too small, meaning the *actual* rendered gap under drag could end up smaller than the intended 8px minimum before the math caught it. Fixed by measuring `el.getBoundingClientRect().height` instead; a regression test (mocking `ResizeObserver` and asserting the committed height matches `getBoundingClientRect`, not `contentRect`) now guards it. Found by actually dragging two segments together in the real Electron app via the `run-electron` driver and computing the true pixel gap — exactly the kind of thing DESIGN.md's collision-system testing gate below calls for.

**Testing gate:** ✅ `vitest` collision-function suite (28 tests, effectively 100% coverage of all functions in `lib/collision.ts`); manual drag/resize QA done on Linux via the `run-electron` driver (screenshots + measured pixel gaps) — Windows/macOS (Tauri) untested, no such environment available here.

**Exit criteria:** ✅ met on Linux — segments never overlap by less than 8px under drag, resize (width), or programmatic height change (verified both by unit test and by measuring real rendered pixel gaps in the running app). Windows/macOS unverified (no Tauri-capable environment in this session).

---

## Phase 4 — Colour coding + slash commands (Week 7)

| Task | Details |
|---|---|
| Context menu colour picker | Right-click → 9 border + 9 fill swatches; active ring; None/clear; `ipc.saveSegment()`. |
| Highlight + colour underbars | Word-style coloured underbar on both ribbon buttons; updates on each cycle. |
| Slash command menu | TipTap keydown `/` at an empty paragraph opens a `SlashMenu` portal; core block types in the top section; a "Plugins" section (populated from `ExtensionPointRegistry`, empty until Phase 7). |

**Testing gate:** `vitest` for colour persistence and the empty/non-empty auto-delete rule (coloured segments never auto-delete); manual QA of the slash menu.

**Exit criteria:** Colour coding persists across restarts; coloured segments survive going empty; `/` reliably opens the block picker only at an empty line start.

---

## Phase 5 — Linear mode + search + CRDT sync (Week 8–9)

| Task | Details |
|---|---|
| Mode toggle | Canvas vs. linear view; `ipc.setPageMode()`; plugin block types serialise to Markdown in linear mode. |
| Linear renderer | Segments sorted by `(y, x)`; vertical stack with coloured left borders; one TipTap instance per segment. |
| Full-text search | `ipc.search()` → FTS5, covering both the file-panel filename search and the content search from DESIGN.md §2.2; plugin block content searchable if the plugin provides a text serialiser. |
| CRDT sync | Automerge changes broadcast on save; incoming remote changes pass through `resolvePosition()` before applying (DESIGN.md §10 "CRDT position conflict"). |

**Testing gate:** `vitest` for mode-switch data integrity (no data loss); integration test simulating two concurrent writers to verify the correction-toast path.

**Exit criteria:** Switching canvas ↔ linear is lossless; search returns correct results for both filename and content queries; two clients editing the same page converge without corrupting segment positions.

---

## Phase 6 — AI + polish + platform QA (Week 10)

| Task | Details |
|---|---|
| Ollama integration | Health check on startup; graceful unavailable state; Claude API fallback (DESIGN.md §10 "Ollama availability"); `ipc.aiComplete()` streams tokens into the active segment. |
| Keyboard shortcut audit | Cmd/Ctrl+B/I/U, headings, etc. — all via `editorRefs`; tested on all three platforms. |
| Zoom + dark mode | Zoom corrects AABB coordinates and the ink canvas; full CSS-variable audit across Chromium/WebView2/WebKit (DESIGN.md §10 "Cross-platform CSS rendering" — use `getBoundingClientRect()`, not `offsetHeight`). |
| Accessibility pass | Ribbon `aria-label`s; keyboard navigation in section/page lists; focus trap in menus. |
| E2E test suite | Playwright on all three platforms: segment create/drag/colour/ink/slash/search/sync. (Plugin Manager UI is tested in Phase 7.) |

**Testing gate:** Full Playwright suite green on all three CI runners; manual accessibility pass with a screen reader on at least one platform.

**Exit criteria:** Feature-complete v1.0 core (pre-plugins) passes E2E on Linux, Windows, and macOS.

---

## Phase 7 — Plugin system foundation + SDK alpha (Week 11–13)

| Task | Details |
|---|---|
| `ExtensionPointRegistry` implementation | Populate the Zustand slice; wire `CanvasRoot` (block types), `SectionSidebar` (section tabs), `RibbonRoot` (ribbon groups), `SlashMenu` (plugin commands). |
| `PluginManager` component | Loads enabled plugins via `ipc.getInstalledPlugins()` on startup; creates a sandboxed iframe per active plugin; manages iframe lifecycle (create on enable, destroy on disable). |
| `PluginIPCBridge` | `postMessage` handler on the host side; validates incoming messages against the plugin's declared permissions (DESIGN.md §9.3); routes storage calls to IPCAdapter and extension registrations to `ExtensionPointRegistry`. |
| Plugin sandbox iframe | `sandbox="allow-scripts"`; CSP blocks network access unless `network:fetch` is declared; no host DOM/cookie/`localStorage` access. |
| Plugin storage IPC (Rust) | `plugin_storage_get`/`plugin_storage_set` in `flownote-core`; enforce namespace isolation by resolving `plugin_id` from the calling context, never a client-supplied parameter (DESIGN.md §10 "Plugin storage isolation failure"). |
| Plugin install flow (Rust) | `install_plugin` IPC command accepting a local path or `.fnp` file; validates manifest JSON, semver, and the permission whitelist; writes to `plugins`; returns the `PluginManifest`. |
| Plugin Manager UI | Installed / Browse / Developer sub-views per DESIGN.md §9.5; hot enable/disable; uninstall with confirmation; settings gear opens a sandboxed config iframe; Developer view with local-folder input, hot-reload indicator, console panel, `postMessage` inspector. |
| `@flownote/sdk` package | Publish to npm as alpha; `FlowNotePlugin` class with all six `registerX()` methods, `plugin.storage`, `plugin.resolveAsset()`, typed context objects. |
| `@flownote/cli` package | Publish to npm; `create`/`dev`/`build`/`pack` commands per DESIGN.md §9.6; dev server integrates with the FlowNote Developer sub-view via a local port. |
| Spreadsheet plugin (reference impl) | Built entirely on `@flownote/sdk` + `@flownote/cli`; registers the spreadsheet block type, `/sheet`, and the spreadsheet ribbon group; uses `plugin.storage`; serialises to Markdown; published to the plugin registry as the reference implementation (DESIGN.md §9.7). |
| Plugin system E2E tests | Playwright: install → block type appears in slash menu → insert block → enter data → verify storage → disable (placeholder shown) → re-enable (data restored) → uninstall (placeholder persists with fallback message). |

**Testing gate:** Rust unit tests specifically verifying cross-namespace storage isolation (DESIGN.md §10); Playwright plugin E2E suite green; a manual sandbox-escape attempt (per the risk in DESIGN.md §10) documented as tested and blocked.

**Exit criteria:** The spreadsheet reference plugin installs, works, and uninstalls cleanly through the Plugin Manager UI with no data loss across disable/enable, on all three platforms; `@flownote/sdk` and `@flownote/cli` are published as alpha npm packages.

---

## Cross-Phase Sequencing Notes

- The **`ExtensionPointRegistry` stub** must exist by the end of Phase 2 (even though it's empty) — Phases 2–6's UI code all reads from it, and Phase 7 only needs to *populate* it, not introduce it.
- **Collision system (Phase 3)** and **ink layer (Phase 2)** are independent of each other and can be parallelized if there are two engineers.
- **CRDT sync (Phase 5)** depends on the collision system (Phase 3) being in place, since remote position changes must pass through `resolvePosition()`.
- **Plugin system (Phase 7)** is deliberately last: it depends on a stable ribbon, slash menu, section sidebar, and side-panel implementation to have real slots to extend. Per DESIGN.md, the SDK is published as alpha *during* Phase 7 so external developers can start building before v1.0 ships — it does not need to wait for Phase 7 to fully complete.
- **IPCAdapter type drift** (DESIGN.md §10) is cheapest to catch early — the Phase 1 exit criteria already requires both adapter stubs to pass the same integration suite; keep extending that same suite in every later phase instead of writing platform-specific tests.

## Immediate Next Actions for This Repo

Since the repo currently contains only `README.md`:

1. Do the **Repo Bootstrap** checklist above (§0).
2. Start Phase 1 with the SQLite schema and the IPCAdapter interface — these are the two artifacts every later phase depends on, and they can be written and unit-tested before either desktop shell exists.
3. Stand up the CI matrix early (even against the near-empty scaffold) so every subsequent PR is gated on all three platforms from day one, rather than retrofitting CI later.

---

*FlowNote · Execution Plan · derived from DESIGN.md §9 (Notion "FlowNote — Canvas Editor Architecture" v1.4, §9 Implementation Plan) · September 2026*
