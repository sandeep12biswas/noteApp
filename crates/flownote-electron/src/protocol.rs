//! The sidecar's wire protocol: newline-delimited JSON on stdin/stdout.
//!
//! Electron's main process (apps/electron/src/sidecar.ts) spawns this binary
//! and speaks one JSON request per line, one JSON response per line, framed
//! by `\n`. Each request carries an `id` the response echoes back so the
//! Electron side can correlate concurrent in-flight calls. This is
//! deliberately the simplest thing that works — no length-prefixing, no
//! framing library — because both ends already parse/emit newline-delimited
//! JSON as their native mode (Node's `readline`, Rust's `BufRead::lines`).
//!
//! `dispatch` is the pure core: given a request and an open connection, it
//! returns a response. Keeping it pure (no I/O of its own) is what makes it
//! unit-testable without spawning a process — see the tests below and
//! apps/electron/src/sidecar.test.ts for the Node-side framing tests.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    fn ok(id: u64, result: Value) -> Self {
        Response { id, result: Some(result), error: None }
    }

    fn err(id: u64, message: impl Into<String>) -> Self {
        Response { id, result: None, error: Some(message.into()) }
    }
}

/// Handles one request against the given connection. Every branch is
/// infallible from the caller's perspective — SQLite/JSON errors are caught
/// and turned into an `error` response rather than propagated, since one bad
/// request must never kill the sidecar process (DESIGN.md §10 "Rust sidecar
/// crash on Linux").
pub fn dispatch(conn: &Connection, req: Request) -> Response {
    match req.method.as_str() {
        "ping" => Response::ok(req.id, Value::String("pong".into())),

        "get_page" => match req.params.get("pageId").and_then(Value::as_str) {
            None => Response::err(req.id, "get_page requires a string `pageId` param"),
            Some(page_id) => match get_page(conn, page_id) {
                Ok(Some(page)) => Response::ok(req.id, page),
                Ok(None) => Response::err(req.id, format!("no such page: {page_id}")),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "save_folder" => match save_folder(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "list_folders" => match list_folders(conn) {
            Ok(folders) => Response::ok(req.id, Value::Array(folders)),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "save_page" => match save_page(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "list_pages" => match req.params.get("folderId").and_then(Value::as_str) {
            None => Response::err(req.id, "list_pages requires a string `folderId` param"),
            Some(folder_id) => match list_pages(conn, folder_id) {
                Ok(pages) => Response::ok(req.id, Value::Array(pages)),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "list_segments" => match req.params.get("pageId").and_then(Value::as_str) {
            None => Response::err(req.id, "list_segments requires a string `pageId` param"),
            Some(page_id) => match list_segments(conn, page_id) {
                Ok(segs) => Response::ok(req.id, Value::Array(segs)),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "save_segment" => match save_segment(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "save_segments_batch" => match req.params.get("segments").and_then(Value::as_array) {
            None => Response::err(req.id, "save_segments_batch requires an array `segments` param"),
            Some(segments) => match save_segments_batch(conn, segments) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "delete_segment" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "delete_segment requires a string `id` param"),
            Some(id) => match delete_segment(conn, id) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "set_page_mode" => match set_page_mode(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "save_ink_layer" => match save_ink_layer(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e),
        },

        "get_ink_layer" => match req.params.get("pageId").and_then(Value::as_str) {
            None => Response::err(req.id, "get_ink_layer requires a string `pageId` param"),
            Some(page_id) => match get_ink_layer(conn, page_id) {
                Ok(value) => Response::ok(req.id, value),
                Err(e) => Response::err(req.id, e),
            },
        },

        "search" => match search(conn, &req.params) {
            Ok(results) => Response::ok(req.id, Value::Array(results)),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "install_plugin" => match req.params.get("source").and_then(Value::as_str) {
            None => Response::err(req.id, "install_plugin requires a string `source` param"),
            Some(source) => match install_plugin(conn, source) {
                Ok(manifest) => Response::ok(req.id, manifest),
                Err(e) => Response::err(req.id, e),
            },
        },

        "uninstall_plugin" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "uninstall_plugin requires a string `id` param"),
            Some(id) => match conn.execute("DELETE FROM plugins WHERE id = ?1", [id]) {
                Ok(_) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "set_plugin_enabled" => match set_plugin_enabled(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        "get_installed_plugins" => match list_installed_plugins(conn) {
            Ok(plugins) => Response::ok(req.id, Value::Array(plugins)),
            Err(e) => Response::err(req.id, e.to_string()),
        },

        // `plugin_storage_get`/`plugin_storage_set` deliberately take
        // `pluginId` from `req.params` here — that's fine *at this layer*,
        // since this whole sidecar process is already trusted (it's Rust
        // code Electron's main process spawned, not plugin JS). The actual
        // isolation boundary DESIGN.md §10 "Plugin storage isolation
        // failure" cares about is one layer up, in
        // `packages/frontend/src/plugins/PluginIPCBridge.ts`: it resolves
        // `pluginId` from *which iframe* a `postMessage` came from (a host-
        // side registry keyed by the iframe's own `contentWindow`
        // reference), never from a field inside the plugin's message
        // payload — see that file's module doc for the full argument. By
        // the time a call reaches here, `pluginId` has already been
        // authenticated by that layer.
        "plugin_storage_get" => match plugin_storage_get(conn, &req.params) {
            Ok(value) => Response::ok(req.id, value),
            Err(e) => Response::err(req.id, e),
        },

        "plugin_storage_set" => match plugin_storage_set(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e),
        },

        "plugin_storage_delete" => match plugin_storage_delete(conn, &req.params) {
            Ok(()) => Response::ok(req.id, Value::Null),
            Err(e) => Response::err(req.id, e),
        },

        "plugin_storage_list" => match plugin_storage_list(conn, &req.params) {
            Ok(keys) => Response::ok(req.id, Value::Array(keys)),
            Err(e) => Response::err(req.id, e),
        },

        other => Response::err(req.id, format!("method not implemented: {other}")),
    }
}

fn get_page(conn: &Connection, page_id: &str) -> rusqlite::Result<Option<Value>> {
    conn.query_row(
        "SELECT id, notebook_id, title, mode, created_at, updated_at FROM pages WHERE id = ?1",
        [page_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "notebookId": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "mode": row.get::<_, String>(3)?,
                "createdAt": row.get::<_, i64>(4)?,
                "updatedAt": row.get::<_, i64>(5)?,
            }))
        },
    )
    .optional()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Upserts a folder row (DESIGN.md §2.1's `Folder` shape). `created_at` is
/// only set the first time a given id is seen; every call refreshes
/// `updated_at` and the mutable fields.
fn save_folder(conn: &Connection, params: &Value) -> Result<(), String> {
    let id = params.get("id").and_then(Value::as_str).ok_or("save_folder requires `id`")?;
    let name = params.get("name").and_then(Value::as_str).ok_or("save_folder requires `name`")?;
    let parent_id = params.get("parentId").and_then(Value::as_str);
    let icon = params.get("icon").and_then(Value::as_str);
    let expanded = params.get("expanded").and_then(Value::as_bool).unwrap_or(false);
    let now = now_ms();

    conn.execute(
        "INSERT INTO folders (id, name, parent_id, icon, expanded, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, parent_id = excluded.parent_id,
           icon = excluded.icon, expanded = excluded.expanded, updated_at = excluded.updated_at",
        rusqlite::params![id, name, parent_id, icon, expanded, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_folders(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, icon, expanded FROM folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "parentId": row.get::<_, Option<String>>(2)?,
                "icon": row.get::<_, Option<String>>(3)?,
                "expanded": row.get::<_, bool>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Upserts a page/file row (DESIGN.md §2.2's `FileEntry`, `pages` table).
fn save_page(conn: &Connection, params: &Value) -> Result<(), String> {
    let id = params.get("id").and_then(Value::as_str).ok_or("save_page requires `id`")?;
    let folder_id = params.get("folderId").and_then(Value::as_str).ok_or("save_page requires `folderId`")?;
    let title = params.get("title").and_then(Value::as_str).ok_or("save_page requires `title`")?;
    let now = now_ms();

    conn.execute(
        "INSERT INTO pages (id, notebook_id, folder_id, title, mode, created_at, updated_at)
         VALUES (?1, 'nb-1', ?2, ?3, 'canvas', ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           folder_id = excluded.folder_id, title = excluded.title, updated_at = excluded.updated_at",
        rusqlite::params![id, folder_id, title, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_pages(conn: &Connection, folder_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, notebook_id, folder_id, title, mode, created_at, updated_at FROM pages WHERE folder_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([folder_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "notebookId": row.get::<_, String>(1)?,
                "folderId": row.get::<_, Option<String>>(2)?,
                "title": row.get::<_, String>(3)?,
                "mode": row.get::<_, String>(4)?,
                "createdAt": row.get::<_, i64>(5)?,
                "updatedAt": row.get::<_, i64>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn list_segments(conn: &Connection, page_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, x, y, w, h, z_index, border_color, fill_color, content
             FROM segments WHERE page_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([page_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (id, page_id, x, y, w, h, z_index, border_color, fill_color, content) =
            row.map_err(|e| e.to_string())?;
        let content: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        out.push(serde_json::json!({
            "id": id, "pageId": page_id, "x": x, "y": y, "w": w, "h": h,
            "zIndex": z_index, "borderColor": border_color, "fillColor": fill_color,
            "content": content,
        }));
    }
    Ok(out)
}

/// Upserts a segment row (DESIGN.md §4.1/§7.1's `Segment`). `content` is the
/// TipTap JSON document, stored as serialised text (see V2 migration notes).
/// Also upserts one `blocks` row per segment — flattening the full TipTap
/// document to plain text — so `search()` has something to `MATCH` against;
/// the V3 migration's triggers keep `blocks_fts` in sync with it for free.
/// One block per segment (`blocks.id = segments.id`) is the simplest thing
/// that satisfies "Full-text search" (EXECUTION_PLAN.md Phase 5) without yet
/// decomposing a segment's document into its individual TipTap nodes — see
/// the V2 migration's notes on why that split hasn't happened yet.
fn save_segment(conn: &Connection, seg: &Value) -> Result<(), String> {
    let id = seg.get("id").and_then(Value::as_str).ok_or("save_segment requires `id`")?;
    let page_id = seg.get("pageId").and_then(Value::as_str).ok_or("save_segment requires `pageId`")?;
    let x = seg.get("x").and_then(Value::as_f64).ok_or("save_segment requires `x`")?;
    let y = seg.get("y").and_then(Value::as_f64).ok_or("save_segment requires `y`")?;
    let w = seg.get("w").and_then(Value::as_f64).ok_or("save_segment requires `w`")?;
    let h = seg.get("h").and_then(Value::as_f64).ok_or("save_segment requires `h`")?;
    let z_index = seg.get("zIndex").and_then(Value::as_i64).unwrap_or(0);
    let border_color = seg.get("borderColor").and_then(Value::as_str);
    let fill_color = seg.get("fillColor").and_then(Value::as_str);
    let content_value = seg.get("content");
    let content = content_value.map(Value::to_string).unwrap_or_else(|| "null".into());
    let now = now_ms();

    conn.execute(
        "INSERT INTO segments (id, page_id, x, y, w, h, z_index, border_color, fill_color, content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT(id) DO UPDATE SET
           x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
           z_index = excluded.z_index, border_color = excluded.border_color,
           fill_color = excluded.fill_color, content = excluded.content,
           updated_at = excluded.updated_at",
        rusqlite::params![id, page_id, x, y, w, h, z_index, border_color, fill_color, content, now],
    )
    .map_err(|e| e.to_string())?;

    let text = content_value.map(flatten_tiptap_text).unwrap_or_default();
    conn.execute(
        "INSERT INTO blocks (id, segment_id, position, type, content, attrs)
         VALUES (?1, ?1, 0, 'text', ?2, '{}')
         ON CONFLICT(id) DO UPDATE SET content = excluded.content",
        rusqlite::params![id, text],
    )
    .map_err(|e| e.to_string())?;
    sync_block_fts(conn, id, &text)?;
    Ok(())
}

/// Keeps `blocks_fts` (self-contained FTS5, V3 migration) in sync with one
/// block's row: delete-then-insert is simplest for a table with no
/// `UPDATE`-by-key support that also doesn't need one at our write volume.
fn sync_block_fts(conn: &Connection, block_id: &str, text: &str) -> Result<(), String> {
    conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [block_id]).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO blocks_fts (block_id, content) VALUES (?1, ?2)",
        rusqlite::params![block_id, text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn save_segments_batch(conn: &Connection, segments: &[Value]) -> Result<(), String> {
    for seg in segments {
        save_segment(conn, seg)?;
    }
    Ok(())
}

/// Deleting a segment cascades (`ON DELETE CASCADE`, V1 schema) to its
/// `blocks` row automatically; `blocks_fts` (V3 migration, self-contained
/// FTS5 — no rowid/FK coupling to `blocks`) needs its own explicit delete.
fn delete_segment(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM segments WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Walks a TipTap JSON document's `content` tree and concatenates every
/// `text` node, space-separated — the same flattening
/// `packages/frontend/src/canvas/CanvasRoot.tsx`'s `segmentText()` does
/// client-side for the notebook's in-memory filename/content search; this is
/// the server-side equivalent that feeds FTS5 instead.
fn flatten_tiptap_text(doc: &Value) -> String {
    fn walk(node: &Value, out: &mut Vec<String>) {
        if let Some(text) = node.get("text").and_then(Value::as_str) {
            out.push(text.to_string());
        }
        if let Some(children) = node.get("content").and_then(Value::as_array) {
            for child in children {
                walk(child, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(doc, &mut out);
    out.join(" ")
}

/// Updates a page's canvas/linear mode (DESIGN.md §4.3, Phase 5 "Mode toggle").
fn set_page_mode(conn: &Connection, params: &Value) -> Result<(), String> {
    let page_id = params.get("pageId").and_then(Value::as_str).ok_or("set_page_mode requires `pageId`")?;
    let mode = params.get("mode").and_then(Value::as_str).ok_or("set_page_mode requires `mode`")?;
    if mode != "canvas" && mode != "linear" {
        return Err(format!("set_page_mode: invalid mode `{mode}` (expected \"canvas\" or \"linear\")"));
    }
    let now = now_ms();
    let changed = conn
        .execute(
            "UPDATE pages SET mode = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![mode, now, page_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("no such page: {page_id}"));
    }
    Ok(())
}

/// Persists a page's ink layer as a PNG data URL (DESIGN.md §5.5) — the V4
/// migration's `pages.ink_layer` column, one blob per page rather than
/// decomposed into strokes (same "simplest thing that round-trips" call V2
/// made for `segments.content`).
fn save_ink_layer(conn: &Connection, params: &Value) -> Result<(), String> {
    let page_id = params.get("pageId").and_then(Value::as_str).ok_or("save_ink_layer requires `pageId`")?;
    let data_url = params.get("dataUrl").and_then(Value::as_str).ok_or("save_ink_layer requires `dataUrl`")?;
    let now = now_ms();
    let changed = conn
        .execute(
            "UPDATE pages SET ink_layer = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![data_url, now, page_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("no such page: {page_id}"));
    }
    Ok(())
}

/// Returns `null` for a page with no ink layer saved yet (never drawn on),
/// same as `plugin_storage_get` returning `null` for an unset key — the
/// frontend treats both identically ("nothing to load").
fn get_ink_layer(conn: &Connection, page_id: &str) -> Result<Value, String> {
    conn.query_row("SELECT ink_layer FROM pages WHERE id = ?1", [page_id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no such page: {page_id}"))
        .map(|ink_layer| ink_layer.map(Value::String).unwrap_or(Value::Null))
}

/// Full-text search over segment content (DESIGN.md §2.2, Phase 5 "Full-text
/// search") — `blocks_fts MATCH` against the flattened text `save_segment`
/// keeps in `blocks`, scoped to one notebook, with a `snippet()`-generated
/// excerpt per hit. Filename search stays the existing client-side
/// `notebookStore` search (DESIGN.md §2.2) — the two are complementary, not
/// this one call doing both.
fn search(conn: &Connection, params: &Value) -> Result<Vec<Value>, String> {
    let query = params.get("query").and_then(Value::as_str).ok_or("search requires `query`")?;
    let notebook_id = params.get("notebookId").and_then(Value::as_str).ok_or("search requires `notebookId`")?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT s.page_id, b.segment_id, snippet(blocks_fts, 1, '', '', '…', 8)
             FROM blocks_fts
             JOIN blocks b ON b.id = blocks_fts.block_id
             JOIN segments s ON s.id = b.segment_id
             JOIN pages p ON p.id = s.page_id
             WHERE blocks_fts MATCH ?1 AND p.notebook_id = ?2
             ORDER BY blocks_fts.rank",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![query, notebook_id], |row| {
            Ok(serde_json::json!({
                "pageId": row.get::<_, String>(0)?,
                "segmentId": row.get::<_, String>(1)?,
                "snippet": row.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Minimal `X.Y.Z` semver validation — good enough to reject an obviously
/// malformed manifest without pulling in the `semver` crate for one check.
/// Not a range/compatibility resolver (`sdkVersion: "^1.0.0"` is accepted as
/// long as its numeric part parses; real range matching against
/// `@flownote/sdk`'s actual version is Phase 7's CLI/registry follow-up,
/// not this validation gate).
fn looks_like_semver(v: &str) -> bool {
    let core = v.trim_start_matches(['^', '~', '>', '=', '<']).trim();
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// The full set of permissions the manifest schema recognises (DESIGN.md
/// §9.3) — `install_plugin` rejects a manifest declaring anything outside
/// this whitelist, so a typo'd or made-up permission string can never
/// silently grant nothing while looking like it granted something.
const KNOWN_PERMISSIONS: &[&str] =
    &["storage:read", "storage:write", "clipboard:read", "clipboard:write", "network:fetch", "theme:read"];

/// Validates a `flownote-plugin.json` manifest (DESIGN.md §9.3) and, if
/// valid, upserts it into `plugins`. `source` is the manifest JSON itself
/// (not a `.fnp` file path or URL — fetching/unzipping a real plugin
/// package is Phase 7's `@flownote/cli`/registry follow-up, not this local-
/// install path) so the frontend's `PluginManager` can read a local
/// `flownote-plugin.json` off disk and pass its contents straight through.
fn install_plugin(conn: &Connection, source: &str) -> Result<Value, String> {
    let manifest: Value = serde_json::from_str(source).map_err(|e| format!("invalid manifest JSON: {e}"))?;

    let id = manifest.get("id").and_then(Value::as_str).ok_or("manifest requires `id`")?;
    let name = manifest.get("name").and_then(Value::as_str).ok_or("manifest requires `name`")?;
    let version = manifest.get("version").and_then(Value::as_str).ok_or("manifest requires `version`")?;
    if !looks_like_semver(version) {
        return Err(format!("manifest `version` is not valid semver: {version}"));
    }
    let sdk_version = manifest.get("sdkVersion").and_then(Value::as_str).ok_or("manifest requires `sdkVersion`")?;
    if !looks_like_semver(sdk_version) {
        return Err(format!("manifest `sdkVersion` is not valid semver: {sdk_version}"));
    }
    manifest.get("entry").and_then(Value::as_str).ok_or("manifest requires `entry`")?;

    let permissions = manifest.get("permissions").and_then(Value::as_array).ok_or("manifest requires `permissions` (array)")?;
    for p in permissions {
        let p = p.as_str().ok_or("`permissions` entries must be strings")?;
        if !KNOWN_PERMISSIONS.contains(&p) {
            return Err(format!("unknown permission `{p}` (DESIGN.md §9.3 whitelist: {})", KNOWN_PERMISSIONS.join(", ")));
        }
    }

    let now = now_ms();
    conn.execute(
        "INSERT INTO plugins (id, name, version, manifest_json, enabled, installed_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, version = excluded.version,
           manifest_json = excluded.manifest_json, installed_at = excluded.installed_at",
        rusqlite::params![id, name, version, manifest.to_string(), now],
    )
    .map_err(|e| e.to_string())?;

    Ok(manifest_response(&manifest, true, now))
}

/// Merges a stored `flownote-plugin.json` with the two columns `plugins`
/// tracks itself (`enabled`, `installedAt`) into the full `PluginManifest`
/// shape `packages/ipc-adapter/src/types.ts` declares — filling in the
/// handful of optional descriptive fields DESIGN.md's example manifest has
/// but `install_plugin` doesn't require, so the frontend never has to
/// guess whether they're present.
fn manifest_response(manifest: &Value, enabled: bool, installed_at: i64) -> Value {
    let mut out = manifest.clone();
    let obj = out.as_object_mut().expect("manifest is always a JSON object by this point");
    obj.entry("description".to_string()).or_insert(Value::String(String::new()));
    obj.entry("author".to_string()).or_insert(Value::String(String::new()));
    obj.entry("minAppVersion".to_string()).or_insert(Value::String("*".to_string()));
    obj.insert("enabled".to_string(), Value::Bool(enabled));
    obj.insert("installedAt".to_string(), Value::Number(installed_at.into()));
    out
}

fn set_plugin_enabled(conn: &Connection, params: &Value) -> Result<(), String> {
    let id = params.get("id").and_then(Value::as_str).ok_or("set_plugin_enabled requires `id`")?;
    let enabled = params.get("enabled").and_then(Value::as_bool).ok_or("set_plugin_enabled requires `enabled`")?;
    let changed = conn
        .execute("UPDATE plugins SET enabled = ?1 WHERE id = ?2", rusqlite::params![enabled, id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("no such plugin: {id}"));
    }
    Ok(())
}

fn list_installed_plugins(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare("SELECT manifest_json, enabled, installed_at FROM plugins").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let manifest_json: String = row.get(0)?;
            let enabled: bool = row.get(1)?;
            let installed_at: i64 = row.get(2)?;
            let manifest: Value = serde_json::from_str(&manifest_json).unwrap_or(Value::Null);
            Ok(manifest_response(&manifest, enabled, installed_at))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Every `plugin_storage_*` query filters by `plugin_id` — see the
/// `plugin_storage_get`/`_set` dispatch arms' comment on why a
/// client-supplied `pluginId` reaching *this* function is still safe
/// (resolved upstream from iframe identity, not message contents).
fn plugin_storage_get(conn: &Connection, params: &Value) -> Result<Value, String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_get requires `pluginId`")?;
    let key = params.get("key").and_then(Value::as_str).ok_or("plugin_storage_get requires `key`")?;
    conn.query_row(
        "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        rusqlite::params![plugin_id, key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map(|v| v.map(Value::String).unwrap_or(Value::Null))
    .map_err(|e| e.to_string())
}

fn plugin_storage_set(conn: &Connection, params: &Value) -> Result<(), String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_set requires `pluginId`")?;
    let key = params.get("key").and_then(Value::as_str).ok_or("plugin_storage_set requires `key`")?;
    let value = params.get("value").and_then(Value::as_str).ok_or("plugin_storage_set requires `value`")?;
    conn.execute(
        "INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value",
        rusqlite::params![plugin_id, key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn plugin_storage_delete(conn: &Connection, params: &Value) -> Result<(), String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_delete requires `pluginId`")?;
    let key = params.get("key").and_then(Value::as_str).ok_or("plugin_storage_delete requires `key`")?;
    conn.execute("DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2", rusqlite::params![plugin_id, key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn plugin_storage_list(conn: &Connection, params: &Value) -> Result<Vec<Value>, String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_list requires `pluginId`")?;
    let mut stmt = conn.prepare("SELECT key FROM plugin_storage WHERE plugin_id = ?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([plugin_id], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|r| r.map(Value::String)).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flownote_core::db;
    use serde_json::json;

    fn conn_with_page(id: &str) -> Connection {
        let conn = db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at)
             VALUES (?1, 'nb-1', 'Untitled', 'canvas', 0, 0)",
            [id],
        )
        .unwrap();
        conn
    }

    #[test]
    fn ping_returns_pong() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 1, method: "ping".into(), params: Value::Null });
        assert_eq!(res.id, 1);
        assert_eq!(res.result, Some(json!("pong")));
        assert!(res.error.is_none());
    }

    #[test]
    fn get_page_returns_the_row() {
        let conn = conn_with_page("page-1");
        let res = dispatch(
            &conn,
            Request { id: 2, method: "get_page".into(), params: json!({ "pageId": "page-1" }) },
        );
        assert!(res.error.is_none());
        assert_eq!(res.result.unwrap()["title"], json!("Untitled"));
    }

    #[test]
    fn get_page_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request { id: 3, method: "get_page".into(), params: json!({ "pageId": "missing" }) },
        );
        assert!(res.result.is_none());
        assert!(res.error.unwrap().contains("no such page"));
    }

    #[test]
    fn get_page_errors_on_missing_param() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 4, method: "get_page".into(), params: Value::Null });
        assert!(res.error.unwrap().contains("pageId"));
    }

    #[test]
    fn unknown_method_errors_without_panicking() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 5, method: "merge_segments".into(), params: Value::Null });
        assert_eq!(res.error.unwrap(), "method not implemented: merge_segments");
    }

    #[test]
    fn save_folder_then_list_folders_round_trips() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request {
                id: 6,
                method: "save_folder".into(),
                params: json!({ "id": "folder-1", "name": "Work", "parentId": null, "icon": null, "expanded": true }),
            },
        );
        assert!(res.error.is_none());

        let res = dispatch(&conn, Request { id: 7, method: "list_folders".into(), params: Value::Null });
        let folders = res.result.unwrap();
        assert_eq!(folders.as_array().unwrap().len(), 1);
        assert_eq!(folders[0]["name"], json!("Work"));
        assert_eq!(folders[0]["expanded"], json!(true));
    }

    #[test]
    fn save_folder_upserts_on_repeat_id() {
        let conn = db::open_in_memory().unwrap();
        for name in ["Work", "Work Renamed"] {
            dispatch(
                &conn,
                Request {
                    id: 8,
                    method: "save_folder".into(),
                    params: json!({ "id": "folder-1", "name": name, "parentId": null, "icon": null, "expanded": false }),
                },
            );
        }
        let res = dispatch(&conn, Request { id: 9, method: "list_folders".into(), params: Value::Null });
        let folders = res.result.unwrap();
        assert_eq!(folders.as_array().unwrap().len(), 1);
        assert_eq!(folders[0]["name"], json!("Work Renamed"));
    }

    #[test]
    fn save_page_then_list_pages_round_trips() {
        let conn = db::open_in_memory().unwrap();
        dispatch(
            &conn,
            Request {
                id: 10,
                method: "save_folder".into(),
                params: json!({ "id": "folder-1", "name": "Work", "parentId": null, "icon": null, "expanded": false }),
            },
        );
        let res = dispatch(
            &conn,
            Request {
                id: 11,
                method: "save_page".into(),
                params: json!({ "id": "page-1", "folderId": "folder-1", "title": "Notes" }),
            },
        );
        assert!(res.error.is_none());

        let res = dispatch(
            &conn,
            Request { id: 12, method: "list_pages".into(), params: json!({ "folderId": "folder-1" }) },
        );
        let pages = res.result.unwrap();
        assert_eq!(pages.as_array().unwrap().len(), 1);
        assert_eq!(pages[0]["title"], json!("Notes"));
    }

    #[test]
    fn save_segment_persists_and_get_page_unaffected() {
        let conn = conn_with_page("page-1");
        let res = dispatch(
            &conn,
            Request {
                id: 13,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-1", "pageId": "page-1", "x": 10.0, "y": 20.0, "w": 320.0, "h": 80.0,
                    "zIndex": 0, "borderColor": null, "fillColor": null,
                    "content": { "type": "doc", "content": [] },
                }),
            },
        );
        assert!(res.error.is_none());

        let stored: String = conn
            .query_row("SELECT content FROM segments WHERE id = 'seg-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, json!({ "type": "doc", "content": [] }).to_string());
    }

    #[test]
    fn save_segment_rejects_a_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request {
                id: 14,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-1", "pageId": "missing-page", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                }),
            },
        );
        assert!(res.error.unwrap().contains("FOREIGN KEY"));
    }

    #[test]
    fn save_segments_batch_persists_all() {
        let conn = conn_with_page("page-1");
        let res = dispatch(
            &conn,
            Request {
                id: 15,
                method: "save_segments_batch".into(),
                params: json!({ "segments": [
                    { "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 },
                    { "id": "seg-2", "pageId": "page-1", "x": 10.0, "y": 10.0, "w": 1.0, "h": 1.0 },
                ] }),
            },
        );
        assert!(res.error.is_none());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn list_segments_returns_only_that_pages_segments() {
        let conn = conn_with_page("page-1");
        conn.execute(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at)
             VALUES ('page-2', 'nb-1', 'Other', 'canvas', 0, 0)",
            [],
        )
        .unwrap();
        dispatch(
            &conn,
            Request {
                id: 18,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-1", "pageId": "page-1", "x": 5.0, "y": 6.0, "w": 1.0, "h": 1.0,
                    "content": { "type": "doc", "content": [] },
                }),
            },
        );
        dispatch(
            &conn,
            Request {
                id: 19,
                method: "save_segment".into(),
                params: json!({ "id": "seg-2", "pageId": "page-2", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );

        let res = dispatch(
            &conn,
            Request { id: 20, method: "list_segments".into(), params: json!({ "pageId": "page-1" }) },
        );
        let segs = res.result.unwrap();
        assert_eq!(segs.as_array().unwrap().len(), 1);
        assert_eq!(segs[0]["id"], json!("seg-1"));
        assert_eq!(segs[0]["x"], json!(5.0));
        assert_eq!(segs[0]["content"], json!({ "type": "doc", "content": [] }));
    }

    #[test]
    fn set_page_mode_updates_the_row() {
        let conn = conn_with_page("page-1");
        let res = dispatch(
            &conn,
            Request { id: 21, method: "set_page_mode".into(), params: json!({ "pageId": "page-1", "mode": "linear" }) },
        );
        assert!(res.error.is_none());
        let mode: String = conn.query_row("SELECT mode FROM pages WHERE id = 'page-1'", [], |row| row.get(0)).unwrap();
        assert_eq!(mode, "linear");
    }

    #[test]
    fn set_page_mode_rejects_an_invalid_mode() {
        let conn = conn_with_page("page-1");
        let res = dispatch(
            &conn,
            Request { id: 22, method: "set_page_mode".into(), params: json!({ "pageId": "page-1", "mode": "sideways" }) },
        );
        assert!(res.error.unwrap().contains("invalid mode"));
    }

    #[test]
    fn set_page_mode_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request { id: 23, method: "set_page_mode".into(), params: json!({ "pageId": "missing", "mode": "linear" }) },
        );
        assert!(res.error.unwrap().contains("no such page"));
    }

    #[test]
    fn get_ink_layer_returns_null_for_a_page_never_drawn_on() {
        let conn = conn_with_page("page-1");
        let res = dispatch(&conn, Request { id: 60, method: "get_ink_layer".into(), params: json!({ "pageId": "page-1" }) });
        assert_eq!(res.result.unwrap(), Value::Null);
    }

    #[test]
    fn save_ink_layer_then_get_ink_layer_round_trips() {
        let conn = conn_with_page("page-1");
        dispatch(
            &conn,
            Request {
                id: 61,
                method: "save_ink_layer".into(),
                params: json!({ "pageId": "page-1", "dataUrl": "data:image/png;base64,abc123" }),
            },
        );
        let res = dispatch(&conn, Request { id: 62, method: "get_ink_layer".into(), params: json!({ "pageId": "page-1" }) });
        assert_eq!(res.result.unwrap(), json!("data:image/png;base64,abc123"));
    }

    #[test]
    fn save_ink_layer_overwrites_the_previous_stroke() {
        let conn = conn_with_page("page-1");
        dispatch(&conn, Request { id: 63, method: "save_ink_layer".into(), params: json!({ "pageId": "page-1", "dataUrl": "first" }) });
        dispatch(&conn, Request { id: 64, method: "save_ink_layer".into(), params: json!({ "pageId": "page-1", "dataUrl": "second" }) });
        let res = dispatch(&conn, Request { id: 65, method: "get_ink_layer".into(), params: json!({ "pageId": "page-1" }) });
        assert_eq!(res.result.unwrap(), json!("second"));
    }

    #[test]
    fn save_ink_layer_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 66, method: "save_ink_layer".into(), params: json!({ "pageId": "missing", "dataUrl": "x" }) });
        assert!(res.error.unwrap().contains("no such page"));
    }

    #[test]
    fn get_ink_layer_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 67, method: "get_ink_layer".into(), params: json!({ "pageId": "missing" }) });
        assert!(res.error.unwrap().contains("no such page"));
    }

    #[test]
    fn ink_layer_is_isolated_per_page() {
        let conn = conn_with_page("page-1");
        conn.execute(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at)
             VALUES ('page-2', 'nb-1', 'Other', 'canvas', 0, 0)",
            [],
        )
        .unwrap();
        dispatch(&conn, Request { id: 68, method: "save_ink_layer".into(), params: json!({ "pageId": "page-1", "dataUrl": "page-1's ink" }) });
        let other = dispatch(&conn, Request { id: 69, method: "get_ink_layer".into(), params: json!({ "pageId": "page-2" }) });
        assert_eq!(other.result.unwrap(), Value::Null);
    }

    #[test]
    fn save_segment_makes_its_text_searchable() {
        let conn = conn_with_page("page-1");
        dispatch(
            &conn,
            Request {
                id: 24,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                    "content": { "type": "doc", "content": [
                        { "type": "paragraph", "content": [{ "type": "text", "text": "hello searchable world" }] }
                    ] },
                }),
            },
        );

        let res = dispatch(
            &conn,
            Request { id: 25, method: "search".into(), params: json!({ "query": "searchable", "notebookId": "nb-1" }) },
        );
        assert!(res.error.is_none());
        let results = res.result.unwrap();
        assert_eq!(results.as_array().unwrap().len(), 1);
        assert_eq!(results[0]["pageId"], json!("page-1"));
        assert_eq!(results[0]["segmentId"], json!("seg-1"));
        assert!(results[0]["snippet"].as_str().unwrap().contains("searchable"));
    }

    #[test]
    fn search_does_not_cross_notebooks() {
        let conn = conn_with_page("page-1");
        conn.execute(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at)
             VALUES ('page-2', 'nb-2', 'Other', 'canvas', 0, 0)",
            [],
        )
        .unwrap();
        dispatch(
            &conn,
            Request {
                id: 26,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-2", "pageId": "page-2", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                    "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "unicorn" }] }] },
                }),
            },
        );

        let res = dispatch(
            &conn,
            Request { id: 27, method: "search".into(), params: json!({ "query": "unicorn", "notebookId": "nb-1" }) },
        );
        assert_eq!(res.result.unwrap().as_array().unwrap().len(), 0);
    }

    #[test]
    fn search_returns_nothing_for_a_blank_query() {
        let conn = conn_with_page("page-1");
        let res = dispatch(&conn, Request { id: 28, method: "search".into(), params: json!({ "query": "  ", "notebookId": "nb-1" }) });
        assert!(res.error.is_none());
        assert_eq!(res.result.unwrap().as_array().unwrap().len(), 0);
    }

    #[test]
    fn deleting_a_segment_removes_it_from_search() {
        let conn = conn_with_page("page-1");
        dispatch(
            &conn,
            Request {
                id: 29,
                method: "save_segment".into(),
                params: json!({
                    "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                    "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "ephemeral" }] }] },
                }),
            },
        );
        dispatch(&conn, Request { id: 30, method: "delete_segment".into(), params: json!({ "id": "seg-1" }) });

        let res = dispatch(
            &conn,
            Request { id: 31, method: "search".into(), params: json!({ "query": "ephemeral", "notebookId": "nb-1" }) },
        );
        assert_eq!(res.result.unwrap().as_array().unwrap().len(), 0);
    }

    #[test]
    fn editing_a_segment_updates_its_search_text() {
        let conn = conn_with_page("page-1");
        for text in ["original", "revised"] {
            dispatch(
                &conn,
                Request {
                    id: 32,
                    method: "save_segment".into(),
                    params: json!({
                        "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0,
                        "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] },
                    }),
                },
            );
        }

        let stale = dispatch(&conn, Request { id: 33, method: "search".into(), params: json!({ "query": "original", "notebookId": "nb-1" }) });
        assert_eq!(stale.result.unwrap().as_array().unwrap().len(), 0);

        let fresh = dispatch(&conn, Request { id: 34, method: "search".into(), params: json!({ "query": "revised", "notebookId": "nb-1" }) });
        assert_eq!(fresh.result.unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn delete_segment_removes_the_row() {
        let conn = conn_with_page("page-1");
        dispatch(
            &conn,
            Request {
                id: 16,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );
        let res = dispatch(&conn, Request { id: 17, method: "delete_segment".into(), params: json!({ "id": "seg-1" }) });
        assert!(res.error.is_none());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    /// `plugin_storage.plugin_id` has a `FOREIGN KEY ... REFERENCES
    /// plugins(id)` (V1 schema) — a storage write for a plugin id with no
    /// matching `plugins` row fails the constraint (silently, from these
    /// tests' perspective, since they don't check every setup call's
    /// result), so multi-plugin storage tests need a real row for each id
    /// first.
    fn install_bare_plugin(conn: &Connection, id: &str) {
        let res = dispatch(
            conn,
            Request {
                id: 999,
                method: "install_plugin".into(),
                params: json!({ "source": json!({
                    "id": id, "name": id, "version": "1.0.0", "entry": "dist/index.js",
                    "sdkVersion": "1.0.0", "permissions": [],
                }).to_string() }),
            },
        );
        assert!(res.error.is_none(), "install_bare_plugin({id}) failed: {:?}", res.error);
    }

    fn spreadsheet_manifest() -> Value {
        json!({
            "id": "com.sandeep.spreadsheet",
            "name": "Spreadsheet",
            "version": "1.0.0",
            "entry": "dist/index.js",
            "sdkVersion": "1.0.0",
            "permissions": ["storage:read", "storage:write"],
            "extensionPoints": ["blockType:spreadsheet", "slashCommand:/sheet", "ribbonGroup:spreadsheet-tools"],
        })
    }

    #[test]
    fn install_plugin_then_list_installed_plugins_round_trips() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request { id: 35, method: "install_plugin".into(), params: json!({ "source": spreadsheet_manifest().to_string() }) },
        );
        assert!(res.error.is_none(), "{:?}", res.error);
        let installed = res.result.unwrap();
        assert_eq!(installed["id"], json!("com.sandeep.spreadsheet"));
        assert_eq!(installed["enabled"], json!(true));
        assert!(installed["installedAt"].as_i64().unwrap() > 0);

        let res = dispatch(&conn, Request { id: 36, method: "get_installed_plugins".into(), params: Value::Null });
        let plugins = res.result.unwrap();
        assert_eq!(plugins.as_array().unwrap().len(), 1);
        assert_eq!(plugins[0]["name"], json!("Spreadsheet"));
        assert_eq!(plugins[0]["enabled"], json!(true));
        // The full manifest round-trips, not just the four `plugins` columns —
        // `PluginManager` needs `permissions`/`extensionPoints`/`entry` to
        // create the iframe and register it with the IPC bridge.
        assert_eq!(plugins[0]["entry"], json!("dist/index.js"));
        assert_eq!(plugins[0]["permissions"], json!(["storage:read", "storage:write"]));
        assert_eq!(plugins[0]["extensionPoints"], json!(["blockType:spreadsheet", "slashCommand:/sheet", "ribbonGroup:spreadsheet-tools"]));
    }

    #[test]
    fn install_plugin_rejects_an_unknown_permission() {
        let conn = db::open_in_memory().unwrap();
        let mut manifest = spreadsheet_manifest();
        manifest["permissions"] = json!(["storage:read", "filesystem:write"]);
        let res = dispatch(&conn, Request { id: 37, method: "install_plugin".into(), params: json!({ "source": manifest.to_string() }) });
        assert!(res.error.unwrap().contains("unknown permission"));
    }

    #[test]
    fn install_plugin_rejects_invalid_semver() {
        let conn = db::open_in_memory().unwrap();
        let mut manifest = spreadsheet_manifest();
        manifest["version"] = json!("not-a-version");
        let res = dispatch(&conn, Request { id: 38, method: "install_plugin".into(), params: json!({ "source": manifest.to_string() }) });
        assert!(res.error.unwrap().contains("semver"));
    }

    #[test]
    fn install_plugin_rejects_a_missing_required_field() {
        let conn = db::open_in_memory().unwrap();
        let mut manifest = spreadsheet_manifest();
        manifest.as_object_mut().unwrap().remove("entry");
        let res = dispatch(&conn, Request { id: 39, method: "install_plugin".into(), params: json!({ "source": manifest.to_string() }) });
        assert!(res.error.unwrap().contains("entry"));
    }

    #[test]
    fn set_plugin_enabled_toggles_and_uninstall_removes() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 40, method: "install_plugin".into(), params: json!({ "source": spreadsheet_manifest().to_string() }) });

        let res = dispatch(
            &conn,
            Request {
                id: 41,
                method: "set_plugin_enabled".into(),
                params: json!({ "id": "com.sandeep.spreadsheet", "enabled": false }),
            },
        );
        assert!(res.error.is_none());
        let plugins = dispatch(&conn, Request { id: 42, method: "get_installed_plugins".into(), params: Value::Null }).result.unwrap();
        assert_eq!(plugins[0]["enabled"], json!(false));

        let res = dispatch(&conn, Request { id: 43, method: "uninstall_plugin".into(), params: json!({ "id": "com.sandeep.spreadsheet" }) });
        assert!(res.error.is_none());
        let plugins = dispatch(&conn, Request { id: 44, method: "get_installed_plugins".into(), params: Value::Null }).result.unwrap();
        assert_eq!(plugins.as_array().unwrap().len(), 0);
    }

    #[test]
    fn plugin_storage_set_then_get_round_trips() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 45, method: "install_plugin".into(), params: json!({ "source": spreadsheet_manifest().to_string() }) });

        let res = dispatch(
            &conn,
            Request {
                id: 46,
                method: "plugin_storage_set".into(),
                params: json!({ "pluginId": "com.sandeep.spreadsheet", "key": "sheet-1", "value": "{\"a1\":\"hi\"}" }),
            },
        );
        assert!(res.error.is_none());

        let res = dispatch(
            &conn,
            Request { id: 47, method: "plugin_storage_get".into(), params: json!({ "pluginId": "com.sandeep.spreadsheet", "key": "sheet-1" }) },
        );
        assert_eq!(res.result.unwrap(), json!("{\"a1\":\"hi\"}"));
    }

    #[test]
    fn plugin_storage_get_returns_null_for_an_unset_key() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(
            &conn,
            Request { id: 48, method: "plugin_storage_get".into(), params: json!({ "pluginId": "com.sandeep.spreadsheet", "key": "missing" }) },
        );
        assert!(res.error.is_none());
        assert_eq!(res.result.unwrap(), Value::Null);
    }

    /// DESIGN.md §10 "Plugin storage isolation failure" — the exact
    /// scenario the mitigation exists for: one plugin must never be able to
    /// read or overwrite another plugin's namespace, even though both share
    /// the same `plugin_storage` table.
    #[test]
    fn plugin_storage_is_isolated_by_plugin_id() {
        let conn = db::open_in_memory().unwrap();
        install_bare_plugin(&conn, "plugin-a");
        install_bare_plugin(&conn, "plugin-b");
        dispatch(&conn, Request { id: 49, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-a", "key": "secret", "value": "a's data" }) });
        dispatch(&conn, Request { id: 50, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-b", "key": "secret", "value": "b's data" }) });

        let a = dispatch(&conn, Request { id: 51, method: "plugin_storage_get".into(), params: json!({ "pluginId": "plugin-a", "key": "secret" }) });
        let b = dispatch(&conn, Request { id: 52, method: "plugin_storage_get".into(), params: json!({ "pluginId": "plugin-b", "key": "secret" }) });
        assert_eq!(a.result.unwrap(), json!("a's data"));
        assert_eq!(b.result.unwrap(), json!("b's data"));

        // plugin-a overwriting its own "secret" must never touch plugin-b's.
        dispatch(&conn, Request { id: 53, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-a", "key": "secret", "value": "a's new data" }) });
        let b_after = dispatch(&conn, Request { id: 54, method: "plugin_storage_get".into(), params: json!({ "pluginId": "plugin-b", "key": "secret" }) });
        assert_eq!(b_after.result.unwrap(), json!("b's data"));
    }

    #[test]
    fn plugin_storage_delete_only_removes_that_plugins_key() {
        let conn = db::open_in_memory().unwrap();
        install_bare_plugin(&conn, "plugin-a");
        install_bare_plugin(&conn, "plugin-b");
        dispatch(&conn, Request { id: 55, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-a", "key": "k", "value": "v" }) });
        dispatch(&conn, Request { id: 56, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-b", "key": "k", "value": "v" }) });

        dispatch(&conn, Request { id: 57, method: "plugin_storage_delete".into(), params: json!({ "pluginId": "plugin-a", "key": "k" }) });

        let a = dispatch(&conn, Request { id: 58, method: "plugin_storage_get".into(), params: json!({ "pluginId": "plugin-a", "key": "k" }) });
        let b = dispatch(&conn, Request { id: 59, method: "plugin_storage_get".into(), params: json!({ "pluginId": "plugin-b", "key": "k" }) });
        assert_eq!(a.result.unwrap(), Value::Null);
        assert_eq!(b.result.unwrap(), json!("v"));
    }

    #[test]
    fn plugin_storage_list_returns_only_that_plugins_keys() {
        let conn = db::open_in_memory().unwrap();
        install_bare_plugin(&conn, "plugin-a");
        install_bare_plugin(&conn, "plugin-b");
        dispatch(&conn, Request { id: 60, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-a", "key": "k1", "value": "v" }) });
        dispatch(&conn, Request { id: 61, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-a", "key": "k2", "value": "v" }) });
        dispatch(&conn, Request { id: 62, method: "plugin_storage_set".into(), params: json!({ "pluginId": "plugin-b", "key": "k3", "value": "v" }) });

        let res = dispatch(&conn, Request { id: 63, method: "plugin_storage_list".into(), params: json!({ "pluginId": "plugin-a" }) });
        let mut keys: Vec<String> = res.result.unwrap().as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
        keys.sort();
        assert_eq!(keys, vec!["k1", "k2"]);
    }

    #[test]
    fn uninstalling_a_plugin_cascades_to_its_storage() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 64, method: "install_plugin".into(), params: json!({ "source": spreadsheet_manifest().to_string() }) });
        dispatch(
            &conn,
            Request {
                id: 65,
                method: "plugin_storage_set".into(),
                params: json!({ "pluginId": "com.sandeep.spreadsheet", "key": "k", "value": "v" }),
            },
        );

        dispatch(&conn, Request { id: 66, method: "uninstall_plugin".into(), params: json!({ "id": "com.sandeep.spreadsheet" }) });

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM plugin_storage", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
