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

        "search" => match search(conn, &req.params) {
            Ok(results) => Response::ok(req.id, Value::Array(results)),
            Err(e) => Response::err(req.id, e.to_string()),
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
}
