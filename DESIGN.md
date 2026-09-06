# FlowNote — Design Document

**Status:** DRAFT · **Source version:** v1.4 · **Consolidated:** 2026-09-06 · **Author:** Sandeep Biswas

> Sourced from the Notion pages **"Requirement"** and **"FlowNote — Canvas Editor Architecture" v1.4**, both under the *Note Taking App* space. This document merges the original product brief with the detailed technical architecture into one place that travels with the code.

---

## 1. Overview & Vision

FlowNote is a modern, cross-platform note-taking application targeting **Linux (Kubuntu)**, **macOS**, and **Windows**. Its defining feature is a **canvas editor** — a free-form, infinite surface where the user clicks anywhere to begin writing inside an auto-created, invisible segment. This "click anywhere and it just flows" behavior is the app's signature fluidity, deliberately mirroring the feel of Microsoft OneNote.

Two documents define the product today:

- The **product brief** ("Requirement"), which specifies the three-panel shell and the day-to-day behavior of folders, files, and the editor.
- The **technical architecture** ("FlowNote — Canvas Editor Architecture v1.4"), which specifies how that product is actually built across three platforms, including a full plugin system.

---

## 2. Product Requirements

The app has **four sections** in total: one horizontal panel across the full width at the top (the ribbon), and three vertical panels beneath it, all mouse-drag resizable.

| Panel | Position | Width | Purpose |
|---|---|---|---|
| Folder panel | Extreme left | narrowest | Folder / sub-folder tree |
| File panel | Middle | narrow | Files inside the selected folder |
| Editor panel | Extreme right | widest | The canvas editor |

### 2.1 Folder panel (1st vertical panel)

- Shows **folders only**, never files — including sub-folders, shown when expanded.
- Folder names auto-capitalize their first letter as the user types (typing all-lowercase still yields a capitalized name).
- Each folder shows a **file count** next to its name.
- A folder with sub-folders shows an **expand affordance** to reveal them.
- Folder hierarchy depth is **configurable**, defaulting to **7 levels**.
- Folder **icons are changeable** — pickable from a built-in icon set, or importable from an external source (e.g. the local filesystem).
- Folders are shown in **natural order** (e.g. `Folder 2` before `Folder 10`, not lexicographic).
- Selecting a folder populates the file panel with that folder's files.

### 2.2 File panel (2nd vertical panel)

- Shows the list of files for the currently selected folder, in **natural order**.
- File names **cannot start with a number or a special character**, and must **start with a capital letter**.
- Includes a **new-page** action: clicking it first asks the user to either create a new folder or pick an existing one, and only then prompts for the file name.
- The **same file name may exist in different folders** (uniqueness is per-folder, not global).
- Includes **search**, in two modes:
  - **By file name** — lists all files whose name matches.
  - **By contents** — lists all files whose text contains the search string.

### 2.3 Editor panel (3rd panel) — the canvas editor

- The main section of the app.
- Top area has two zones: the **file name**, and an **options/ribbon area** (bold, italic, header size, font colour, font type, etc.).
- The **editor background colour is changeable**; when changed, the editor intelligently suggests a **contrasting ink colour**.
- The page can be **divided into segments**. Segments are resizable; by default their border is invisible, but the user can select a segment and make its border visible (and pick its colour).
- Users can choose **not to use segments** at all, and can add or delete segments freely.

*(See §4–§9 below for how the architecture doc formalizes "segments" as the invisible auto-created blocks that implement this editor.)*

### 2.4 Planned feature areas (from the brief, elaborated in later sections)

- **Menu options** — a full app menu (File, Edit, Tool, View, Format, Window, Help, …); all editor features are designed and developed **as plugins** (see §9).
- **Backup & Sync** — see §3.4 (offline-first CRDT sync).
- **AI integration** — chat-style integration with major LLMs (Claude, Gemini, ChatGPT, GitHub Copilot). See §9 for the local-AI-first design actually adopted (Ollama, with a cloud fallback).
- **Plug-ins** — spreadsheets, import/export (Markdown, PDF, Doc), print, table formatting, YouTube embedding, calendar integration (Google Calendar, Apple Calendar). These map directly onto the plugin system's `registerBlockType` extension point (§9.2).

---

## 3. Platform Strategy — v1.3

### 3.1 Why not Tauri everywhere

A compatibility analysis against Kubuntu 26.04 (KDE Plasma 6, Wayland-default) ruled out a single Tauri-everywhere shell:

- Tauri v2 uses **WebKitGTK** on Linux, which has known instability on complex applications.
- **Wayland** causes `DragDropEvent::Cancelled` instead of `DragDropEvent::Drop`, breaking segment drag.
- **Automerge WASM** combined with many concurrent TipTap editor instances hits unresolved upstream WebKit WASM bugs.

### 3.2 The dual-shell decision

| Property | Linux (Kubuntu) | Windows | macOS |
|---|---|---|---|
| Desktop shell | Electron v32 | Tauri v2 | Tauri v2 |
| Renderer | Chromium (bundled) | WebView2 (Edge Chromium) | WebKit (WKWebView) |
| IPC transport | electron-trpc (native Electron IPC) | tauri-specta `invoke()` | tauri-specta `invoke()` |
| Rust backend | Sidecar subprocess started by Electron main process | Embedded in Tauri binary | Embedded in Tauri binary |
| Bundle size | ~120 MB (Electron + Chromium) | ~12 MB | ~12 MB |
| Package format | `.deb`, `.AppImage` | `.msi`, `.exe` | `.dmg`, `.app` |

### 3.3 The IPCAdapter abstraction

The frontend never calls `invoke()` or `ipcRenderer` directly. All backend calls go through one `IPCAdapter` interface, resolved at startup by platform detection:

```typescript
interface IPCAdapter {
  getPage(pageId: string): Promise<Page>
  saveSegment(seg: Segment): Promise<void>
  saveSegmentsBatch(segs: Segment[]): Promise<void>
  deleteSegment(id: string): Promise<void>
  saveBlock(block: Block): Promise<void>
  saveInkLayer(pageId: string, dataUrl: string): Promise<void>
  mergeSegments(idA: string, idB: string): Promise<void>
  search(query: string, notebookId: string): Promise<SearchResult[]>
  setPageMode(pageId: string, mode: 'canvas' | 'linear'): Promise<void>
  onSyncEvent(handler: (event: SyncEvent) => void): () => void
  aiComplete(prompt: string, context: string): AsyncIterableIterator<string>
  // Plugin-related IPC (added in v1.4)
  installPlugin(source: string): Promise<PluginManifest>
  uninstallPlugin(id: string): Promise<void>
  setPluginEnabled(id: string, enabled: boolean): Promise<void>
  getInstalledPlugins(): Promise<PluginManifest[]>
  pluginStorageGet(pluginId: string, key: string): Promise<string | null>
  pluginStorageSet(pluginId: string, key: string, value: string): Promise<void>
}

async function resolveIPCAdapter(): Promise<IPCAdapter> {
  if (window.__TAURI__) return new TauriIPCAdapter()
  if (window.electronIPC) return new ElectronIPCAdapter()
  throw new Error('No IPC transport found')
}
```

### 3.4 Automerge: WASM eliminated

Automerge runs only in the Rust backend, on all platforms, via the native `automerge` Rust crate. The frontend never touches an Automerge document directly — it applies `SyncEvent` IPC messages to Zustand state optimistically.

---

## 4. Core Design Decisions

| # | Decision |
|---|---|
| 4.1 Invisible segment model | Segments are invisible by default, auto-created on canvas click, auto-deleted when empty (unless coloured), each with a full rich editor inside. A collision system enforces an **8px minimum gap** between all segment boundaries. |
| 4.2 Segment colour coding | Right-click context menu assigns a persistent border colour and background fill (9 border colours, 9 matching 8%-opacity fills). Coloured segments never auto-delete when empty. |
| 4.3 Dual mode: canvas and linear | Segmented canvas (default) and linear document modes, switchable without data loss. In linear mode, "Remove boundary" permanently merges adjacent segments' block arrays. |
| 4.4 Slash command block insertion | `/` at the start of an empty line opens a block-type picker. Plugins can register additional slash commands via the SDK. |
| 4.5 Offline-first with CRDT sync | SQLite-first local storage. Automerge (Rust crate) for CRDT sync over an Axum WebSocket relay. No server-side document storage. |
| 4.6 Non-overlapping segment collision system | Solid spatial objects with an enforced 8px gap. Four pure TypeScript functions — `overlaps()`, `resolvePosition()`, `findFreePosition()`, `clampResizeWidth()` — called synchronously on every `mousemove` and `ResizeObserver` tick. |

---

## 5. UI Shell Architecture

### 5.1 Overall layout

| Zone | Height | Contents |
|---|---|---|
| Ribbon header | ~88px | Tab bar (Home / Insert / Draw / View) + active ribbon panel |
| Three-panel body | flex-1 | Section sidebar (160px, includes Plugins tab) · Page list (170px) · Editor pane (flex-1) |
| Status bar | ~24px | Word count · editing mode · draw mode indicator |

### 5.2 Three-panel layout

- **Section sidebar** — colour-coded vertical list, with a Plugins section at the bottom.
- **Page list** — title + auto-timestamp ("DD Mon YYYY HH:MM"), active item marked with a 2px left border.
- **Editor pane** — borderless 26px title, timestamp below, infinite segment canvas.

### 5.3 Multi-tab ribbon

| Tab | Contents |
|---|---|
| **Home** | Undo/Redo · Font family + size · Bold/Italic/Underline/Strikethrough/Sub/Super · Highlight · Text colour · Clear · Bullets/Numbers/Checklist/Indent/Outdent · all 4 alignments · H1/H2/H3/Quote/Code/Table · Tags · Find · *plugin ribbon groups render here* |
| **Insert** | Table · Divider · Link · Date stamp · Draw mode toggle · Image placeholder · *plugin block types appear here* |
| **Draw** | Pen / Marker / Eraser · 7 ink colours · Thin/Med/Thick · Clear · Done |
| **View** | Ruler · Dot-grid overlay · Zoom in/out |

### 5.4 Ribbon-to-segment dispatch

All ribbon commands route through `getActiveEditor()` via an `editorRefs` map in Zustand. `document.execCommand()` is **never** used — this is enforced by an ESLint rule (see §10, §11 open risk "Ribbon → segment dispatch"). Plugin ribbon buttons follow the same dispatch pattern.

### 5.5 Ink drawing layer

An HTML5 Canvas overlay, `pointer-events: none` at rest, switched to `pointer-events: all` in Draw mode. Sized via `ResizeObserver` with `devicePixelRatio` for retina displays. Serialised as a PNG data URL and saved to the `ink_layer` column.

---

## 6. Technology Stack

### 6.1 Desktop shell (platform-specific)

| Component | Linux | Windows / macOS | Rationale |
|---|---|---|---|
| Shell | Electron v32 | Tauri v2 | Chromium on Linux for reliability; Tauri on Win/macOS for bundle size. |
| IPC transport | electron-trpc | tauri-specta `invoke()` | Both expose the same IPCAdapter surface. |
| Rust backend | Sidecar binary via Electron main | Embedded in Tauri binary | Same `flownote-core` crate compiled for all targets. |
| Package | `.deb`, `.AppImage` | `.msi`/`.exe`, `.dmg`/`.app` | Native formats per platform. |

### 6.2 Frontend (100% shared)

| Library | Role |
|---|---|
| React 19 | UI framework — same component tree on all platforms |
| TypeScript 5.x | Strict mode; shared types via tauri-specta (Win/macOS) and electron-trpc (Linux) |
| TipTap v2 | One editor per segment; ribbon dispatch via `editorRefs`; plugin block types registered as TipTap extensions |
| Vite 5 | Integrates with both Tauri and Electron dev servers |
| Zustand | Segments, AABB cache, editorRefs, activeSegId, IPCAdapter, plugin registry state |
| Tailwind CSS 4 | Identical output on Chromium and WebKit; plugin UI also uses Tailwind |

### 6.3 Rust backend (shared — `flownote-core`)

| Component | Role |
|---|---|
| rusqlite + r2d2 + refinery | Primary storage. WAL mode. FTS5. Spatial index. Plugin storage namespace table. |
| automerge (Rust crate) | Native Rust CRDT — no WASM |
| tokio | Async runtime; single write-queue task |
| axum | WebSocket relay for CRDT sync |
| ollama-rs | Local AI, with ROCm acceleration on Linux AMD iGPU |

### 6.4 Rust crate workspace

```toml
[workspace]
members = [
  "crates/flownote-core",     # Storage + CRDT + collision + AI + plugin storage
  "crates/flownote-electron", # Sidecar binary (Linux)
  "crates/flownote-tauri",    # Tauri command handlers (Win/macOS)
  "crates/flownote-sync",     # Automerge WebSocket relay
]
```

### 6.5 CI build matrix

| Runner | Shell | Build command | Output |
|---|---|---|---|
| `ubuntu-24.04` | Electron | `electron-builder --linux` | `.deb`, `.AppImage` |
| `windows-2025` | Tauri v2 | `cargo tauri build` | `.msi`, `.exe` |
| `macos-15` | Tauri v2 | `cargo tauri build` | `.dmg`, `.app` (universal) |

---

## 7. Data Model

### 7.1 TypeScript interfaces

```typescript
interface Segment {
  id:          string
  pageId:      string
  x: number; y: number; w: number; h: number
  zIndex:      number
  borderColor: string | null
  fillColor:   string | null
  blocks:      Block[]
  createdAt:   number; updatedAt: number
}

interface CanvasStore {
  ipc:         IPCAdapter
  segments:    Map<string, Segment>
  aabbCache:   Map<string, AABB>
  editorRefs:  Map<string, Editor>
  activeSegId: string | null
  dragState:   DragState | null
  resizeState: ResizeState | null
  mode:        'canvas' | 'linear'
  plugins:     PluginManifest[]        // loaded plugin manifests
  pluginExts:  ExtensionPointRegistry  // registered extension points
}
```

### 7.2 SQLite schema

```sql
CREATE TABLE pages (
  id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL,
  title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'canvas',
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE segments (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,
  w REAL NOT NULL DEFAULT 280, h REAL NOT NULL DEFAULT 40,
  z_index INTEGER DEFAULT 0,
  border_color TEXT, fill_color TEXT,
  ink_layer TEXT,
  created_at INTEGER, updated_at INTEGER,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
CREATE INDEX idx_segments_page_pos ON segments(page_id, x, y);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY, segment_id TEXT NOT NULL,
  position INTEGER NOT NULL, type TEXT NOT NULL,
  content TEXT NOT NULL, attrs TEXT DEFAULT '{}',
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE blocks_fts USING fts5(
  block_id UNINDEXED, content, content=blocks, content_rowid=rowid
);

-- Plugin system tables (added v1.4)
CREATE TABLE plugins (
  id           TEXT PRIMARY KEY,     -- e.g. com.sandeep.spreadsheet
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  manifest_json TEXT NOT NULL,       -- full flownote-plugin.json stored as JSON
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL
);
CREATE TABLE plugin_storage (
  plugin_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
```

---

## 8. System Architecture

### 8.1 Layered architecture

| Layer | Linux | Windows / macOS |
|---|---|---|
| Desktop shell | Electron v32. Starts Rust sidecar. electron-trpc router. | Tauri v2 binary. Rust commands via `#[tauri::command]`. |
| IPC transport | electron-trpc: `createIPCHandler` + `ipcLink`. | tauri-specta: `invoke()` with serde JSON. |
| Plugin host *(new)* | Plugin Manager (React). Loads enabled plugins. Creates a sandboxed iframe per plugin. Routes `postMessage` between the plugin SDK and the Extension Point Registry. | *(shared)* |
| IPCAdapter *(shared)* | `ElectronIPCAdapter` \| `TauriIPCAdapter`, resolved at startup. Includes plugin IPC methods. | *(shared)* |
| UI shell *(shared)* | RibbonRoot, SectionSidebar (incl. Plugins tab), PageList, EditorPane, StatusBar. | *(shared)* |
| Presentation *(shared)* | CanvasRoot, SegmentHost, TipTap editors, drag/resize, slash menu, context menu. Plugin block types render as sandboxed iframes within TipTap nodes. | *(shared)* |
| Ribbon dispatch *(shared)* | All commands → `getActiveEditor()` via `editorRefs`. Plugin ribbon buttons follow the same pattern. | *(shared)* |
| Collision layer *(shared)* | `overlaps()`, `resolvePosition()`, `findFreePosition()`, `clampResizeWidth()`, `onHeightChange()`. Pure TypeScript. | *(shared)* |
| Rust core *(shared binary)* | `flownote-electron` sidecar. | `flownote-tauri` embedded. |
| Storage + sync + AI *(shared)* | SQLite WAL + FTS5 · Automerge Rust · Axum relay · ollama-rs · `plugin_storage` table. | *(shared)* |

### 8.2 IPC command surface

| IPCAdapter method | Linux: electron-trpc | Win/macOS: Tauri |
|---|---|---|
| `getPage(pageId)` | `trpc.getPage.query()` | `invoke('get_page')` |
| `saveSegment(seg)` | `trpc.saveSegment.mutate()` | `invoke('save_segment')` |
| `saveSegmentsBatch(segs)` | `trpc.saveSegmentsBatch.mutate()` | `invoke('save_segments_batch')` |
| `deleteSegment(id)` | `trpc.deleteSegment.mutate()` | `invoke('delete_segment')` |
| `saveBlock(block)` | `trpc.saveBlock.mutate()` | `invoke('save_block')` |
| `saveInkLayer(pageId, url)` | `trpc.saveInkLayer.mutate()` | `invoke('save_ink_layer')` |
| `mergeSegments(a, b)` | `trpc.mergeSegments.mutate()` | `invoke('merge_segments')` |
| `search(q, nbId)` | `trpc.search.query()` | `invoke('search')` |
| `setPageMode(id, mode)` | `trpc.setPageMode.mutate()` | `invoke('set_page_mode')` |
| `onSyncEvent(handler)` | `ipcRenderer.on('sync-event')` | `listen('sync-event')` |
| `aiComplete(prompt, ctx)` | `trpc.aiComplete` streaming | `listen('ai-token')` |
| `installPlugin(source)` | `trpc.installPlugin.mutate()` | `invoke('install_plugin')` |
| `uninstallPlugin(id)` | `trpc.uninstallPlugin.mutate()` | `invoke('uninstall_plugin')` |
| `setPluginEnabled(id, on)` | `trpc.setPluginEnabled.mutate()` | `invoke('set_plugin_enabled')` |
| `getInstalledPlugins()` | `trpc.getInstalledPlugins.query()` | `invoke('get_installed_plugins')` |
| `pluginStorageGet(pId, key)` | `trpc.pluginStorageGet.query()` | `invoke('plugin_storage_get')` |
| `pluginStorageSet(pId, k, v)` | `trpc.pluginStorageSet.mutate()` | `invoke('plugin_storage_set')` |

---

## 9. Plugin System (v1.4)

FlowNote features are built as independent, pluggable capabilities — installed, activated, deactivated, and removed through the UI without touching core app code. Each plugin runs in a sandboxed iframe with a declared permission model. The plugin development environment is completely separate from the main app codebase.

### 9.1 Design principles

| Principle | Decision | Rationale |
|---|---|---|
| Sandboxed by default | Each plugin runs in `<iframe sandbox="allow-scripts">`. No DOM access to the host app, no `localStorage`, no cross-frame reads. | A crashing or malicious plugin cannot affect the host app or access user notes — same model as VS Code extensions and Figma plugins. |
| Declarative extension points | A plugin declares what it wants to occupy; the host renders those slots from the plugin's returned descriptions. Plugins never reach into app DOM. | Host keeps full rendering control; a misbehaving plugin can't break the layout. |
| Explicit permissions | The plugin manifest declares every capability it needs. Plugin Manager shows these before install. Violations are blocked at the IPC bridge. | Users see exactly what a plugin can access — least privilege. |
| Isolated storage | Each plugin gets its own namespace in `plugin_storage`. Plugins cannot read other plugins' data or user notes. | Enforced at the Rust backend, not in JavaScript. |
| Separate dev environment | `@flownote/sdk` and `@flownote/cli` are separate npm packages. Plugin developers never clone or modify the main FlowNote repo. | Plugin ecosystem grows independently of core app releases. |

### 9.2 Extension points (v1.0 SDK)

| Extension point | What it enables | Example plugins |
|---|---|---|
| `registerBlockType` | A new TipTap node type with a custom renderer, slash-menu entry, and ribbon button; renders as a sandboxed iframe inside TipTap; serialises to Markdown for linear-mode export | Spreadsheet, Mermaid diagram, Kanban board, Math equation, Audio player |
| `registerSectionTab` | A new tab in the left section sidebar with its own page-list logic, below the user's notebook sections | Git notes (recent commits), Calendar view, Bookmarks, Starred pages |
| `registerRibbonGroup` | A new button group appended to the Home ribbon tab | Spreadsheet toolbar (format cells, insert row/col), Diagram tools |
| `registerSlashCommand` | A new entry in the `/` picker, under a "Plugins" section; inserting calls the plugin's `insertBlock` handler | `/sheet`, `/diagram`, `/kanban`, `/equation` |
| `registerSidePanel` | A new panel in the right-side info area (alongside Tags, TOC, Linked pages), rendered as a sandboxed iframe, receiving the current page + active segment as context | Backlinks panel, Word frequency, Reading time, plugin-specific properties |
| `registerStorageNamespace` | Declares the plugin needs persistent storage; creates a namespaced partition in `plugin_storage`, accessed via `plugin.storage.get/set/delete/list` | Spreadsheet cell data, diagram state, Kanban card positions |

### 9.3 Plugin manifest

Every plugin ships a `flownote-plugin.json`, validated by the Plugin Manager before install:

```json
{
  "id": "com.sandeep.spreadsheet",
  "name": "Spreadsheet",
  "version": "1.0.0",
  "description": "Embed live spreadsheets inside any note segment",
  "author": "Sandeep Biswas",
  "entry": "dist/index.js",
  "sdkVersion": "^1.0.0",
  "permissions": [
    "storage:read",
    "storage:write",
    "clipboard:read",
    "clipboard:write"
  ],
  "extensionPoints": [
    "blockType:spreadsheet",
    "slashCommand:/sheet",
    "ribbonGroup:spreadsheet-tools"
  ],
  "minAppVersion": "1.0.0"
}
```

**Permission model**

| Permission | What it grants | Blocked without it |
|---|---|---|
| `storage:read` | Read from own `plugin_storage` namespace | `pluginStorageGet` calls return 403 |
| `storage:write` | Write to own `plugin_storage` namespace | `pluginStorageSet` calls return 403 |
| `clipboard:read` | Read from system clipboard | `navigator.clipboard.readText()` blocked |
| `clipboard:write` | Write to system clipboard | `navigator.clipboard.writeText()` blocked |
| `network:fetch` | External HTTP requests from the plugin iframe | `fetch()` to external URLs blocked by CSP |
| `theme:read` | Read current app theme (light/dark, accent colour) | Plugin renders without theme awareness |

### 9.4 FlowNote SDK (`@flownote/sdk`)

Plugin developers import the SDK, declare extension points, and call `plugin.activate()`; the SDK handles all `postMessage` communication with the host.

```typescript
import { FlowNotePlugin } from '@flownote/sdk'

const plugin = new FlowNotePlugin()

// Register a new block type — spreadsheet example
plugin.registerBlockType({
  name: 'spreadsheet',
  label: 'Spreadsheet',
  icon: 'ti-table',
  slashCommand: '/sheet',

  // Declarative render spec — host creates a sandboxed iframe at this URL
  // Plugin never touches TipTap or the app DOM directly
  render: (attrs, context) => ({
    type: 'iframe',
    src: plugin.resolveAsset('grid.html'),
    height: (attrs.rows ?? 5) * 28 + 40,
    onHeightChange: (h) => context.updateAttrs({ height: h }),
    onDataChange: (data) => context.updateAttrs({ data }),
  }),

  defaultAttrs: { rows: 5, cols: 4, data: {} },

  serialize: (attrs) =>
    `[Spreadsheet ${attrs.rows}×${attrs.cols} — open in FlowNote]`,

  parseJSON: (json) => json,
})

// Isolated key-value storage — backed by plugin_storage SQLite table
const store = plugin.storage
await store.set('sheet-data-block-123', JSON.stringify(cellData))
const raw = await store.get('sheet-data-block-123')

// Register a ribbon group
plugin.registerRibbonGroup({
  id: 'spreadsheet-tools',
  label: 'Spreadsheet',
  buttons: [
    { id: 'insert-row', icon: 'ti-row-insert-bottom', label: 'Row',
      onClick: (ctx) => ctx.sendToActiveBlock({ type: 'INSERT_ROW' }) },
    { id: 'insert-col', icon: 'ti-column-insert-right', label: 'Column',
      onClick: (ctx) => ctx.sendToActiveBlock({ type: 'INSERT_COL' }) },
  ],
  visibleWhen: (ctx) => ctx.activeBlockType === 'spreadsheet',
})

plugin.activate()
```

### 9.5 Plugin Manager UI

A dedicated **Plugins** tab in the left sidebar, with three sub-views:

| Sub-view | Contents |
|---|---|
| **Installed** | All installed plugins: name, version, author, description, active/inactive toggle (hot-toggle, no restart), settings gear (opens a plugin-defined sandboxed config panel), uninstall button. |
| **Browse** | Available plugins from a configured registry (local folder or registry URL): name, description, author, version, required permissions. Install downloads, validates the manifest, installs to `plugins/`, and hot-loads without restart. |
| **Developer** | Local plugin loader for development: point at a folder with `flownote-plugin.json`; hot-reloads on file change; shows plugin console output; exposes devtools (postMessage inspector, storage viewer, extension point inspector). |

```typescript
interface PluginManifest {
  id:             string    // reverse-domain unique ID
  name:           string
  version:        string
  description:    string
  author:         string
  entry:          string    // path to bundled JS entry point
  sdkVersion:     string    // semver range for @flownote/sdk
  permissions:    string[]
  extensionPoints: string[]
  minAppVersion:  string
  enabled:        boolean   // runtime state, stored in plugins table
  installedAt:    number
}
```

### 9.6 Plugin developer environment

Plugin developers never touch the FlowNote source code — the workflow uses `@flownote/cli`:

```bash
npx @flownote/cli create my-spreadsheet-plugin
cd my-spreadsheet-plugin

# flownote-plugin.json      — manifest
# src/index.ts              — plugin entry point with SDK imports
# src/blocks/grid.html      — sandboxed iframe UI for the block
# src/blocks/grid.ts        — block-specific logic
# tsconfig.json             — pre-configured for @flownote/sdk
# vite.config.ts            — handles sandboxed iframe bundling
# package.json              — dev dependencies only

npm run dev     # start dev server — opens FlowNote with plugin loaded
npm run build   # bundles to dist/
npm run pack    # creates my-spreadsheet-plugin-1.0.0.fnp (signed zip)
```

**Dev mode hot-reload flow:** `npm run dev` starts a Vite dev server → FlowNote's Developer sub-view detects it and loads the plugin in dev mode → on every save, an HMR update destroys and recreates the plugin's sandboxed iframe with the new code → the devtools panel shows live `postMessage` traffic, storage contents, and registered extension points.

### 9.7 The spreadsheet plugin — end-to-end flow (reference example)

1. User opens Plugin Manager → Browse, finds "Spreadsheet", clicks Install.
2. FlowNote downloads the `.fnp`, validates the manifest (`storage:read`, `storage:write`), shows a permission summary, user confirms.
3. Plugin installed: the spreadsheet block type registers in TipTap, `/sheet` appears in the slash menu, a "Spreadsheet" ribbon group appears on Home (hidden unless a spreadsheet block is focused).
4. User types `/sheet` → a spreadsheet block is inserted, rendered as a sandboxed iframe grid UI.
5. User edits cells → the grid iframe sends changes via `postMessage` → host calls `pluginStorageSet('com.sandeep.spreadsheet', 'sheet-data-block-{id}', ...)` via IPC → Rust writes to `plugin_storage`.
6. Focusing the block reveals the Spreadsheet ribbon group (row/column insert).
7. Switching to Linear mode serialises the block to `[Spreadsheet 5×4 — open in FlowNote]`.
8. Disabling the plugin shows a "Plugin inactive" placeholder on all spreadsheet blocks; re-enabling restores full functionality with no data loss.

### 9.8 Plugin system — component map

| Component | Lives in | Responsibility |
|---|---|---|
| PluginManager (React) | `packages/frontend` | Loads enabled plugins on startup; creates one sandboxed iframe per active plugin; routes `postMessage` between the plugin SDK and `ExtensionPointRegistry`. |
| ExtensionPointRegistry | `packages/frontend` | Zustand slice holding all registered block types, section tabs, ribbon groups, slash commands, side panels — consulted by CanvasRoot, RibbonRoot, SlashMenu, SectionSidebar, SidePanel. |
| PluginIPCBridge | `packages/frontend` | Receives `postMessage` from plugin iframes, validates against the plugin's declared permissions, forwards approved messages to IPCAdapter or ExtensionPointRegistry. |
| Plugin sandbox iframe | Browser renderer | One per active plugin. Runs plugin code + SDK. `sandbox="allow-scripts"`. No DOM access, no `localStorage`. Communicates only via `postMessage`. |
| `plugin_storage` table | `flownote-core` (Rust) | Isolated key-value store per plugin; `pluginStorageGet/Set` IPC commands enforce namespace isolation. |
| `plugins` table | `flownote-core` (Rust) | Installed plugin registry: manifest JSON, enabled state, install timestamp. |
| `@flownote/sdk` | Separate npm package | TypeScript SDK exposing `FlowNotePlugin` with all six `registerX()` methods and `plugin.storage`. |
| `@flownote/cli` | Separate npm package | Scaffold, dev server, build, and pack commands for plugin development. |

---

## 10. Key Risks and Mitigations

| Risk | Description | Mitigation |
|---|---|---|
| **Plugin sandbox escape** *(new v1.4)* | A malicious plugin tries to escape the sandboxed iframe (prototype pollution, eval injection, postMessage spoofing) to reach user notes or the host DOM. | `sandbox="allow-scripts"` with no `allow-same-origin` prevents DOM access. Every `postMessage` is validated against the plugin's manifest permissions before any action. Storage namespace isolation is enforced in Rust regardless of what JS runs in the iframe. |
| **TipTap schema conflict** *(new v1.4)* | Two plugins register block types with the same name, corrupting the ProseMirror schema. | ExtensionPointRegistry rejects duplicate block-type-name registrations; the second plugin is disabled with a conflict error in Plugin Manager. Block type names are namespaced by plugin ID (e.g. `com.sandeep.spreadsheet/spreadsheet`). |
| **Plugin storage isolation failure** *(new v1.4)* | A Rust IPC bug lets a plugin read/overwrite another plugin's storage namespace. | `plugin_storage_get/set` always filter by the authenticated `plugin_id` from the calling context — never a client-supplied parameter — resolved from the manifest registered at install time. Rust unit tests verify cross-namespace isolation. |
| **Dual-shell divergence** | Electron and Tauri shells drift in behaviour over time. | All user-facing logic lives in `packages/frontend`. IPCAdapter is the enforcement boundary. Playwright E2E tests run on all three platforms. |
| **Electron bundle on Linux** | ~120 MB vs ~12 MB for Tauri; users on limited storage may object. | Accept the trade-off (VS Code is already installed). Offer AppImage as a portable option. Revisit if Tauri Servo matures. |
| **Rust sidecar crash on Linux** | The backend subprocess exits unexpectedly, leaving Electron with no backend. | Electron main watches the exit code. Non-zero → error dialog + auto-restart with exponential backoff (max 3 attempts). Stderr logged to a crash file. |
| **IPCAdapter type drift** | The two adapter implementations diverge subtly. | TypeScript strict mode; integration tests call every method on both adapters against the same Rust backend. |
| **Ribbon → segment dispatch** | Ribbon commands must target the active segment's TipTap editor. | All ribbon commands go through `getActiveEditor()`. ESLint rule bans `execCommand()` in `packages/frontend`. |
| **Collision performance at scale** | `resolvePosition()` is O(n) per `mousemove` at 100+ segments. | Spatial partitioning (quadtree or grid) limits candidates to the local neighbourhood. Benchmark at 50/100/200 segments. |
| **ResizeObserver cascade loops** | Height change → push → ResizeObserver → loop. | Guard flag; max cascade depth 20. |
| **Cross-platform CSS rendering** | Chromium/WebView2/WebKit render fonts and variables differently. | Use `getBoundingClientRect()`, not `offsetHeight`. Full dark-mode audit on all three platforms in Phase 6. |
| **CRDT position conflict** | Two users drag the same segment simultaneously. | Remote position changes go through `resolvePosition()` before applying; a correction toast is shown. |
| **Ollama availability** | Local AI requires Ollama installed and running. | Health check on startup; graceful unavailable state; Claude API fallback. |

---

## 11. Open Questions

- **Plugin registry hosting** — a static JSON file on GitHub Pages + CDN is enough for v1.0; a full registry UI (search, ratings, version history) is a future consideration.
- **Plugin signing** — should `.fnp` files be signed with a developer certificate? Are unsigned plugins shown with a warning? Required for any plugin using `network:fetch`?
- **Tauri Servo future** — if Tauri ships a stable Servo webview for Linux, the Electron shell could be retired; the architecture makes this swap easy (replace `ElectronIPCAdapter` with `TauriIPCAdapter`).
- **Ink layer per segment vs. per page** — current design stores one `ink_layer` per page. Should ink move with a segment when it's dragged?
- **Quadtree threshold** — at what segment count does spatial partitioning become necessary? Benchmark at 50/100/200 on a Ryzen 7840HS.
- **Export formats** — Markdown via linear mode, PDF via headless renderer. OneNote / Docx import? Plugin serialisers contribute to export.
- **Segment linking** — @mention a segment from another, creating a navigable reference; requires a segment-level URI scheme.

---

## 12. Appendix — Recommended Libraries

| Package | Used on | Purpose |
|---|---|---|
| `electron` v32 | Linux only | Desktop shell — Chromium renderer |
| `electron-builder` | Linux only | `.deb` and `.AppImage` packaging |
| `electron-trpc` | Linux only | Type-safe IPC over Electron native IPC channel |
| `@tauri-apps/api` | Win/macOS only | Tauri IPC and event system |
| `tauri-specta` (Rust) | Win/macOS only | TypeScript types from Rust commands |
| `@tiptap/react` | All | TipTap React integration |
| `@tiptap/starter-kit` | All | Core extensions bundle |
| `@tiptap/extension-task-list` | All | Checklist support |
| `@tiptap/extension-table` | All | Resizable tables |
| `@tiptap/extension-font-family` | All | Font family from ribbon |
| `@tiptap/extension-text-style` | All | Required peer for font-family |
| `@tiptap/extension-highlight` | All | Highlight marks from ribbon |
| `@tiptap/extension-color` | All | Text colour marks from ribbon |
| `@tiptap/extension-subscript` | All | Subscript from ribbon |
| `@tiptap/extension-superscript` | All | Superscript from ribbon |
| `zustand` | All | Client state: segments, AABB cache, editorRefs, IPCAdapter, ExtensionPointRegistry |
| `tailwindcss` v4 | All | Utility CSS — identical on Chromium and WebKit |
| `automerge` (Rust crate) | All | CRDT engine — native Rust, no WASM |
| `rusqlite` | All | Rust SQLite bindings |
| `refinery` | All | Rust SQLite migrations |
| `r2d2-sqlite` | All | SQLite connection pool |
| `serde` + `serde_json` | All | Rust serialisation |
| `tokio` | All | Async runtime; write-queue task |
| `axum` | All | WebSocket relay server |
| `ollama-rs` | All | Local LLM client |
| `uuid` (Rust + npm) | All | UUID v4 on both sides of IPC |
| `@flownote/sdk` | Plugin devs only | Plugin SDK — `FlowNotePlugin` class, six extension points, storage API |
| `@flownote/cli` | Plugin devs only | Scaffold, dev server, build, pack for plugin development |

---

*FlowNote · Design Document · consolidated from Notion "Requirement" + "FlowNote — Canvas Editor Architecture" v1.4 · September 2026*
