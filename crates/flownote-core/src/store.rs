//! The storage layer both desktop shells share — DESIGN.md §6.3: "Same
//! `flownote-core` crate compiled for all targets."
//!
//! Every function takes an open `&Connection` and works in plain JSON
//! (`serde_json::Value`) params/results — the exact shapes the IPCAdapter
//! speaks (`packages/ipc-adapter/src/types.ts`, camelCase keys). Two thin
//! front-ends call into it:
//!
//! - `flownote-electron`'s `protocol::dispatch` (Linux sidecar), which maps
//!   one newline-delimited JSON request to one of these calls;
//! - `flownote-tauri`'s `#[tauri::command]` handlers (Windows/macOS), which
//!   convert their typed, specta-exported inputs/outputs to and from these
//!   JSON shapes.
//!
//! Until 2026-10-24 each shell carried its own copy of this logic, and they
//! drifted (the Tauri copy never indexed segments for search or cleaned up
//! attachment files on delete). Keeping it here is what stops that: add new
//! storage behaviour to this module, then expose it from both front-ends.

use base64::Engine;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::path::PathBuf;

pub fn get_page(conn: &Connection, page_id: &str) -> rusqlite::Result<Option<Value>> {
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

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Upserts a folder row (DESIGN.md §2.1's `Folder` shape). `created_at` is
/// only set the first time a given id is seen; every call refreshes
/// `updated_at` and the mutable fields.
pub fn save_folder(conn: &Connection, params: &Value) -> Result<(), String> {
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

pub fn list_folders(conn: &Connection) -> Result<Vec<Value>, String> {
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
pub fn save_page(conn: &Connection, params: &Value) -> Result<(), String> {
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

pub fn list_pages(conn: &Connection, folder_id: &str) -> Result<Vec<Value>, String> {
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

/// Deletes a page and everything under it. `segments.page_id`,
/// `blocks.segment_id`, and `attachments.segment_id` (V6__attachments.sql)
/// are all `ON DELETE CASCADE`, so one `DELETE FROM pages` removes the
/// segments/blocks/attachments *rows* too — but two things aren't SQLite
/// rows, so foreign keys alone don't clean them up: `blocks_fts` is an
/// external-content FTS5 table (`content = blocks`), and an attachment's
/// actual bytes are a file on disk, not a DB row. Collect the block ids and
/// attachment paths *before* the cascading delete removes their source
/// rows, then purge/unlink both after.
pub fn delete_page(conn: &Connection, page_id: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT b.id FROM blocks b JOIN segments s ON b.segment_id = s.id WHERE s.page_id = ?1")
        .map_err(|e| e.to_string())?;
    let block_ids: Vec<String> = stmt
        .query_map([page_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    // Same "collect before the cascading delete, clean up the non-cascaded
    // side effect after" shape as the block_ids above — attachment *files*
    // aren't SQLite rows, so `ON DELETE CASCADE` removes the `attachments`
    // rows but never touches the files those rows point at. Collecting
    // `relative_path` (not just `id`) here, before the delete, matters:
    // once `DELETE FROM pages` cascades the `attachments` rows away, a
    // by-id lookup afterward would find nothing to clean up.
    let mut attach_stmt = conn
        .prepare("SELECT a.relative_path FROM attachments a JOIN segments s ON a.segment_id = s.id WHERE s.page_id = ?1")
        .map_err(|e| e.to_string())?;
    let attachment_paths: Vec<String> = attach_stmt
        .query_map([page_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(attach_stmt);

    conn.execute("DELETE FROM pages WHERE id = ?1", [page_id]).map_err(|e| e.to_string())?;
    for block_id in block_ids {
        conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [&block_id]).map_err(|e| e.to_string())?;
    }
    delete_attachment_files(conn, &attachment_paths)?;
    Ok(())
}

/// Deletes a folder, every subfolder nested under it, and every page/
/// segment/block/attachment those folders contain. `folders.parent_id`,
/// `pages.folder_id`, and (transitively via `segments`) `attachments.
/// segment_id` are all `ON DELETE CASCADE`, so a single `DELETE FROM
/// folders` on the top folder cascades through the whole subtree down to
/// `blocks`/`attachments` — the recursive CTEs below only exist to collect
/// block ids and attachment paths first, for the same `blocks_fts`/on-disk-
/// file cleanup `delete_page` needs (see its own doc comment).
pub fn delete_folder(conn: &Connection, folder_id: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE sub(id) AS (
               SELECT ?1
               UNION ALL
               SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
             )
             SELECT b.id FROM blocks b
             JOIN segments s ON b.segment_id = s.id
             JOIN pages p ON s.page_id = p.id
             WHERE p.folder_id IN (SELECT id FROM sub)",
        )
        .map_err(|e| e.to_string())?;
    let block_ids: Vec<String> = stmt
        .query_map([folder_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut attach_stmt = conn
        .prepare(
            "WITH RECURSIVE sub(id) AS (
               SELECT ?1
               UNION ALL
               SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
             )
             SELECT a.relative_path FROM attachments a
             JOIN segments s ON a.segment_id = s.id
             JOIN pages p ON s.page_id = p.id
             WHERE p.folder_id IN (SELECT id FROM sub)",
        )
        .map_err(|e| e.to_string())?;
    let attachment_paths: Vec<String> = attach_stmt
        .query_map([folder_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(attach_stmt);

    conn.execute("DELETE FROM folders WHERE id = ?1", [folder_id]).map_err(|e| e.to_string())?;
    for block_id in block_ids {
        conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [&block_id]).map_err(|e| e.to_string())?;
    }
    delete_attachment_files(conn, &attachment_paths)?;
    Ok(())
}

pub fn list_segments(conn: &Connection, page_id: &str) -> Result<Vec<Value>, String> {
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
pub fn save_segment(conn: &Connection, seg: &Value) -> Result<(), String> {
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
pub fn sync_block_fts(conn: &Connection, block_id: &str, text: &str) -> Result<(), String> {
    conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [block_id]).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO blocks_fts (block_id, content) VALUES (?1, ?2)",
        rusqlite::params![block_id, text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_segments_batch(conn: &Connection, segments: &[Value]) -> Result<(), String> {
    for seg in segments {
        save_segment(conn, seg)?;
    }
    Ok(())
}

/// Deleting a segment cascades (`ON DELETE CASCADE`, V1/V6 schema) to its
/// `blocks` and `attachments` rows automatically; `blocks_fts` (V3
/// migration, self-contained FTS5 — no rowid/FK coupling to `blocks`) needs
/// its own explicit delete, and an attachment's actual bytes are a file on
/// disk, not a DB row, so those need collecting *before* the cascade too.
pub fn delete_segment(conn: &Connection, id: &str) -> Result<(), String> {
    let attachment_paths: Vec<String> = conn
        .prepare("SELECT relative_path FROM attachments WHERE segment_id = ?1")
        .map_err(|e| e.to_string())?
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM segments WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM blocks_fts WHERE block_id = ?1", [id]).map_err(|e| e.to_string())?;
    delete_attachment_files(conn, &attachment_paths)?;
    Ok(())
}

/// Where attachment files live: a sibling of the SQLite database file
/// itself (`<db path's parent>/attachments/`), created on first use. Using
/// `rusqlite::Connection::path()` (the open database's own file path) means
/// this needs no separate CLI arg/plumbing through `main.rs` alongside
/// `FLOWNOTE_DB_PATH` — errors (e.g. an in-memory `:memory:` test
/// connection, which has no path) only surface when there's actually an
/// attachment to read/write, never for the vast majority of calls that have
/// none.
pub fn attachments_dir(conn: &Connection) -> Result<PathBuf, String> {
    let db_path = conn.path().ok_or("no attachments directory: connection has no database file path")?;
    let dir = std::path::Path::new(db_path)
        .parent()
        .ok_or("database path has no parent directory")?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Deletes the on-disk files at the given `attachments.relative_path`
/// values. Best-effort per file — one already missing from disk (e.g.
/// removed out-of-band) doesn't stop cleaning up the rest, and doesn't fail
/// the DB delete this is always called alongside. No-op (skips even
/// resolving `attachments_dir`) when the list is empty, which is every
/// existing call site before this feature ever created an attachment.
pub fn delete_attachment_files(conn: &Connection, relative_paths: &[String]) -> Result<(), String> {
    if relative_paths.is_empty() {
        return Ok(());
    }
    let dir = attachments_dir(conn)?;
    for rel in relative_paths {
        let _ = std::fs::remove_file(dir.join(rel));
    }
    Ok(())
}

/// Sanitizes a user-supplied file name into something safe to use as (part
/// of) a path component — strips any path separators/`..` a malicious or
/// just plain unusual OS-provided clipboard filename might carry, since
/// this ends up joined onto `attachments_dir()` verbatim.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !matches!(c, '/' | '\\' | ':' | '\0')).collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "attachment".to_string()
    } else {
        cleaned.to_string()
    }
}

pub fn save_attachment(conn: &Connection, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(Value::as_str).ok_or("save_attachment requires `id`")?;
    let segment_id = params.get("segmentId").and_then(Value::as_str).ok_or("save_attachment requires `segmentId`")?;
    let file_name = params.get("fileName").and_then(Value::as_str).ok_or("save_attachment requires `fileName`")?;
    let mime_type = params.get("mimeType").and_then(Value::as_str).ok_or("save_attachment requires `mimeType`")?;
    let data_base64 = params.get("dataBase64").and_then(Value::as_str).ok_or("save_attachment requires `dataBase64`")?;

    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    let size = bytes.len() as i64;
    let relative_path = format!("{id}-{}", sanitize_file_name(file_name));

    let dir = attachments_dir(conn)?;
    std::fs::write(dir.join(&relative_path), &bytes).map_err(|e| e.to_string())?;

    let now = now_ms();
    conn.execute(
        "INSERT INTO attachments (id, segment_id, file_name, mime_type, size, relative_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, segment_id, file_name, mime_type, size, relative_path, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "id": id, "fileName": file_name, "mimeType": mime_type, "size": size }))
}

pub fn get_attachment(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, file_name, mime_type, size, relative_path FROM attachments WHERE id = ?1",
        [id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .map(|(id, file_name, mime_type, size, relative_path)| -> Result<Value, String> {
        let dir = attachments_dir(conn)?;
        let path = dir.join(relative_path);
        Ok(serde_json::json!({
            "id": id,
            "fileName": file_name,
            "mimeType": mime_type,
            "size": size,
            "path": path.to_string_lossy(),
        }))
    })
    .transpose()
}

pub fn delete_attachment(conn: &Connection, id: &str) -> Result<(), String> {
    let relative_path: Option<String> = conn
        .query_row("SELECT relative_path FROM attachments WHERE id = ?1", [id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM attachments WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    if let Some(rel) = relative_path {
        delete_attachment_files(conn, &[rel])?;
    }
    Ok(())
}

/// Walks a TipTap JSON document's `content` tree and concatenates every
/// `text` node, space-separated — the same flattening
/// `packages/frontend/src/canvas/CanvasRoot.tsx`'s `segmentText()` does
/// client-side for the notebook's in-memory filename/content search; this is
/// the server-side equivalent that feeds FTS5 instead.
pub fn flatten_tiptap_text(doc: &Value) -> String {
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
pub fn set_page_mode(conn: &Connection, params: &Value) -> Result<(), String> {
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
pub fn save_ink_layer(conn: &Connection, params: &Value) -> Result<(), String> {
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
pub fn get_ink_layer(conn: &Connection, page_id: &str) -> Result<Value, String> {
    conn.query_row("SELECT ink_layer FROM pages WHERE id = ?1", [page_id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no such page: {page_id}"))
        .map(|ink_layer| ink_layer.map(Value::String).unwrap_or(Value::Null))
}

/// "Add to Dictionary" — global, not scoped to a page/plugin (V5 migration's
/// `dictionary_words` table). Lower-cased before storing so "Add to
/// Dictionary" on "Sandeep" and later typing "sandeep" both match; `INSERT
/// OR IGNORE` makes repeated adds of the same word a no-op rather than an
/// error.
pub fn add_dictionary_word(conn: &Connection, word: &str) -> Result<(), String> {
    let lower = word.to_lowercase();
    conn.execute("INSERT OR IGNORE INTO dictionary_words (word) VALUES (?1)", [&lower]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ordered by `added_at` so a future "manage my dictionary" UI lists words
/// in the order they were added, not alphabetically/by rowid.
pub fn list_dictionary_words(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT word FROM dictionary_words ORDER BY added_at").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Full-text search over segment content (DESIGN.md §2.2, Phase 5 "Full-text
/// search") — `blocks_fts MATCH` against the flattened text `save_segment`
/// keeps in `blocks`, scoped to one notebook, with a `snippet()`-generated
/// excerpt per hit. Filename search stays the existing client-side
/// `notebookStore` search (DESIGN.md §2.2) — the two are complementary, not
/// this one call doing both.
pub fn search(conn: &Connection, params: &Value) -> Result<Vec<Value>, String> {
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
pub fn looks_like_semver(v: &str) -> bool {
    let core = v.trim_start_matches(['^', '~', '>', '=', '<']).trim();
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// The full set of permissions the manifest schema recognises (DESIGN.md
/// §9.3) — `install_plugin` rejects a manifest declaring anything outside
/// this whitelist, so a typo'd or made-up permission string can never
/// silently grant nothing while looking like it granted something.
pub const KNOWN_PERMISSIONS: &[&str] =
    &["storage:read", "storage:write", "clipboard:read", "clipboard:write", "network:fetch", "theme:read"];

/// Validates a `flownote-plugin.json` manifest (DESIGN.md §9.3) and, if
/// valid, upserts it into `plugins`. `source` is the manifest JSON itself
/// (not a `.fnp` file path or URL — fetching/unzipping a real plugin
/// package is Phase 7's `@flownote/cli`/registry follow-up, not this local-
/// install path) so the frontend's `PluginManager` can read a local
/// `flownote-plugin.json` off disk and pass its contents straight through.
pub fn install_plugin(conn: &Connection, source: &str) -> Result<Value, String> {
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
pub fn manifest_response(manifest: &Value, enabled: bool, installed_at: i64) -> Value {
    let mut out = manifest.clone();
    let obj = out.as_object_mut().expect("manifest is always a JSON object by this point");
    obj.entry("description".to_string()).or_insert(Value::String(String::new()));
    obj.entry("author".to_string()).or_insert(Value::String(String::new()));
    obj.entry("minAppVersion".to_string()).or_insert(Value::String("*".to_string()));
    obj.insert("enabled".to_string(), Value::Bool(enabled));
    obj.insert("installedAt".to_string(), Value::Number(installed_at.into()));
    out
}

pub fn set_plugin_enabled(conn: &Connection, params: &Value) -> Result<(), String> {
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

pub fn list_installed_plugins(conn: &Connection) -> Result<Vec<Value>, String> {
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
pub fn plugin_storage_get(conn: &Connection, params: &Value) -> Result<Value, String> {
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

pub fn plugin_storage_set(conn: &Connection, params: &Value) -> Result<(), String> {
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

pub fn plugin_storage_delete(conn: &Connection, params: &Value) -> Result<(), String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_delete requires `pluginId`")?;
    let key = params.get("key").and_then(Value::as_str).ok_or("plugin_storage_delete requires `key`")?;
    conn.execute("DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2", rusqlite::params![plugin_id, key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn plugin_storage_list(conn: &Connection, params: &Value) -> Result<Vec<Value>, String> {
    let plugin_id = params.get("pluginId").and_then(Value::as_str).ok_or("plugin_storage_list requires `pluginId`")?;
    let mut stmt = conn.prepare("SELECT key FROM plugin_storage WHERE plugin_id = ?1").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([plugin_id], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    rows.map(|r| r.map(Value::String)).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}


/// Removes a plugin's registry row. `plugin_storage.plugin_id` is
/// `ON DELETE CASCADE` (V1 schema), so the plugin's stored key/values go
/// with it. Blocks it inserted into segments are untouched — they render as
/// the "plugin inactive" placeholder.
pub fn uninstall_plugin(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM plugins WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// The Content-Security-Policy for a plugin's documents — its registration
/// iframe and its block iframes (DESIGN.md §9.3 permission model:
/// "`network:fetch` … `fetch()` to external URLs blocked by CSP"). One
/// implementation for every shell: the Electron sidecar and the Tauri
/// handlers send it as a response header on the plugin's HTML, and the
/// frontend puts it in the registration iframe's `<meta>`.
///
/// `origin` is where plugin files are served from — `flownote-plugin://localhost`,
/// or `http://flownote-plugin.localhost` on Windows/WebView2. A plugin may
/// load scripts, styles, images, fonts and media from there (plus inline
/// scripts/styles, which its import map and registration page need, and
/// `data:`/`blob:` images) and `fetch()` its own files. Everything else is
/// blocked unless it declared `network:fetch`, which adds http(s)/ws(s) for
/// requests and http(s) for images, media and fonts. Frames, workers,
/// plugins (`<object>`), form submission and `<base>` are always blocked.
///
/// Not covered by CSP (documented limits): a plugin navigating its own
/// iframe to an external URL, and WebRTC.
pub fn plugin_content_security_policy(permissions: &[String], origin: &str) -> String {
    let network = permissions.iter().any(|p| p == "network:fetch");
    let (connect, remote_media) = if network {
        (format!("{origin} https: http: wss: ws:"), " https: http:")
    } else {
        (origin.to_string(), "")
    };
    [
        "default-src 'none'".to_string(),
        format!("script-src {origin} 'unsafe-inline'"),
        format!("style-src {origin} 'unsafe-inline'"),
        format!("img-src {origin} data: blob:{remote_media}"),
        format!("font-src {origin} data:{remote_media}"),
        format!("media-src {origin} data: blob:{remote_media}"),
        format!("connect-src {connect}"),
        "frame-src 'none'".to_string(),
        "worker-src 'none'".to_string(),
        "object-src 'none'".to_string(),
        "form-action 'none'".to_string(),
        "base-uri 'none'".to_string(),
    ]
    .join("; ")
}

/// `plugin_content_security_policy` for an installed plugin, by id. An id
/// that isn't installed gets the policy for no permissions (the strictest).
pub fn plugin_csp_for(conn: &Connection, plugin_id: &str, origin: &str) -> Result<String, String> {
    let manifest_json: Option<String> = conn
        .query_row("SELECT manifest_json FROM plugins WHERE id = ?1", [plugin_id], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let permissions: Vec<String> = manifest_json
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(|m| m.get("permissions").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|p| p.as_str().map(str::to_string))
        .collect();
    Ok(plugin_content_security_policy(&permissions, origin))
}

#[cfg(test)]
mod csp_tests {
    use super::*;
    use crate::db;

    const ORIGIN: &str = "flownote-plugin://localhost";

    fn directive<'a>(csp: &'a str, name: &str) -> &'a str {
        csp.split("; ").find(|d| d.starts_with(&format!("{name} "))).unwrap_or_else(|| panic!("no {name} in {csp}"))
    }

    #[test]
    fn without_network_fetch_only_the_plugin_origin_is_reachable() {
        let csp = plugin_content_security_policy(&["storage:read".into()], ORIGIN);
        assert_eq!(directive(&csp, "default-src"), "default-src 'none'");
        assert_eq!(directive(&csp, "connect-src"), format!("connect-src {ORIGIN}"));
        assert_eq!(directive(&csp, "img-src"), format!("img-src {ORIGIN} data: blob:"));
        assert!(!csp.contains("https:"), "{csp}");
        for d in ["frame-src 'none'", "worker-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'"] {
            assert!(csp.contains(d), "missing {d}: {csp}");
        }
    }

    #[test]
    fn network_fetch_opens_external_requests_and_media() {
        let csp = plugin_content_security_policy(&["network:fetch".into()], ORIGIN);
        assert_eq!(directive(&csp, "connect-src"), format!("connect-src {ORIGIN} https: http: wss: ws:"));
        assert!(directive(&csp, "img-src").ends_with("https: http:"));
        // Still no frames, workers or form posts.
        assert!(csp.contains("frame-src 'none'") && csp.contains("worker-src 'none'"));
    }

    #[test]
    fn uses_the_given_origin_for_windows_style_urls() {
        let csp = plugin_content_security_policy(&[], "http://flownote-plugin.localhost");
        assert_eq!(directive(&csp, "script-src"), "script-src http://flownote-plugin.localhost 'unsafe-inline'");
    }

    fn install(conn: &Connection, id: &str, permissions: &str) {
        install_plugin(
            conn,
            &format!(
                r#"{{"id":"{id}","name":"P","version":"1.0.0","entry":"i.js","sdkVersion":"1.0.0","permissions":{permissions}}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn plugin_csp_for_reads_the_installed_permissions() {
        let conn = db::open_in_memory().unwrap();
        install(&conn, "net.plugin", r#"["network:fetch"]"#);
        install(&conn, "local.plugin", r#"["storage:read"]"#);
        assert!(plugin_csp_for(&conn, "net.plugin", ORIGIN).unwrap().contains("https:"));
        assert!(!plugin_csp_for(&conn, "local.plugin", ORIGIN).unwrap().contains("https:"));
    }

    #[test]
    fn an_unknown_plugin_gets_the_strictest_policy() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(plugin_csp_for(&conn, "nope", ORIGIN).unwrap(), plugin_content_security_policy(&[], ORIGIN));
    }
}

// ---- AI providers (V7 migration; flownote_core::ai makes the requests) ----

/// Every configured AI provider, oldest first. The API key itself is never
/// returned — only `hasApiKey` — so neither the renderer nor a plugin can
/// read a key back; it's used only inside `ai_provider_config`.
pub fn list_ai_providers(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, name, base_url, model, api_key IS NOT NULL AND api_key != '', is_default
             FROM ai_providers ORDER BY created_at, rowid",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "name": row.get::<_, String>(2)?,
                "baseUrl": row.get::<_, String>(3)?,
                "model": row.get::<_, String>(4)?,
                "hasApiKey": row.get::<_, bool>(5)?,
                "isDefault": row.get::<_, bool>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Adds or updates a provider. `baseUrl`/`model` fall back to the kind's
/// defaults when blank. `apiKey`: a string sets it, `null` clears it, and
/// leaving it out keeps whatever is stored (so editing a provider in the UI
/// never needs to send the key back). The first provider becomes the default.
pub fn save_ai_provider(conn: &Connection, params: &Value) -> Result<Value, String> {
    let id = params.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("save_ai_provider requires `id`")?;
    let kind = crate::ai::ProviderKind::parse(params.get("kind").and_then(Value::as_str).unwrap_or(""))?;
    let text = |key: &str| params.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
    let name = text("name").ok_or("save_ai_provider requires a `name`")?;
    let base_url = text("baseUrl").unwrap_or(kind.default_base_url());
    let model = text("model").unwrap_or(kind.default_model());
    let now = now_ms();

    conn.execute(
        "INSERT INTO ai_providers (id, kind, name, base_url, model, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
           base_url = excluded.base_url, model = excluded.model, updated_at = excluded.updated_at",
        rusqlite::params![id, kind.as_str(), name, base_url, model, now],
    )
    .map_err(|e| e.to_string())?;
    match params.get("apiKey") {
        Some(Value::String(key)) => {
            let key = key.trim();
            let key = if key.is_empty() { None } else { Some(key) };
            conn.execute("UPDATE ai_providers SET api_key = ?1 WHERE id = ?2", rusqlite::params![key, id]).map_err(|e| e.to_string())?;
        }
        Some(Value::Null) => {
            conn.execute("UPDATE ai_providers SET api_key = NULL WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
        }
        _ => {}
    }
    let has_default: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_providers WHERE is_default = 1)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !has_default {
        set_default_ai_provider(conn, id)?;
    }
    list_ai_providers(conn)?
        .into_iter()
        .find(|p| p["id"] == id)
        .ok_or_else(|| format!("no such AI provider: {id}"))
}

/// Removes a provider; if it was the default, the oldest remaining one takes over.
pub fn delete_ai_provider(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM ai_providers WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    let has_default: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM ai_providers WHERE is_default = 1)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !has_default {
        conn.execute(
            "UPDATE ai_providers SET is_default = 1
             WHERE id = (SELECT id FROM ai_providers ORDER BY created_at, rowid LIMIT 1)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Makes `id` the provider the AI box uses.
pub fn set_default_ai_provider(conn: &Connection, id: &str) -> Result<(), String> {
    let exists: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM ai_providers WHERE id = ?1)", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err(format!("no such AI provider: {id}"));
    }
    conn.execute("UPDATE ai_providers SET is_default = (id = ?1)", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// The full config — **including the API key** — for `id`, or for the
/// default provider when `id` is None. Backend-only: used to make the
/// request, never sent to the renderer.
pub fn ai_provider_config(conn: &Connection, id: Option<&str>) -> Result<crate::ai::ProviderConfig, String> {
    let row = conn
        .query_row(
            "SELECT kind, base_url, model, api_key FROM ai_providers
             WHERE CASE WHEN ?1 IS NULL THEN is_default = 1 ELSE id = ?1 END",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (kind, base_url, model, api_key) = row.ok_or_else(|| match id {
        Some(id) => format!("no such AI provider: {id}"),
        None => "No AI provider is set up yet — add one in AI settings.".to_string(),
    })?;
    Ok(crate::ai::ProviderConfig { kind: crate::ai::ProviderKind::parse(&kind)?, base_url, model, api_key })
}

#[cfg(test)]
mod ai_provider_tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn save(conn: &Connection, v: Value) -> Value {
        save_ai_provider(conn, &v).unwrap()
    }

    #[test]
    fn first_provider_becomes_default_and_blank_fields_get_kind_defaults() {
        let conn = db::open_in_memory().unwrap();
        let p = save(&conn, json!({ "id": "a", "kind": "anthropic", "name": "Claude", "apiKey": "sk-1" }));
        assert_eq!(p["isDefault"], true);
        assert_eq!(p["baseUrl"], "https://api.anthropic.com");
        assert_eq!(p["model"], crate::ai::ProviderKind::Anthropic.default_model());
        assert_eq!(p["hasApiKey"], true);
        let second = save(&conn, json!({ "id": "g", "kind": "gemini", "name": "Gemini" }));
        assert_eq!(second["isDefault"], false);
    }

    #[test]
    fn the_api_key_is_never_listed_but_is_used_for_requests() {
        let conn = db::open_in_memory().unwrap();
        save(&conn, json!({ "id": "a", "kind": "anthropic", "name": "Claude", "apiKey": "sk-secret" }));
        let listed = serde_json::to_string(&list_ai_providers(&conn).unwrap()).unwrap();
        assert!(!listed.contains("sk-secret"), "{listed}");
        assert_eq!(ai_provider_config(&conn, None).unwrap().api_key.as_deref(), Some("sk-secret"));
    }

    #[test]
    fn editing_without_apikey_keeps_it_null_clears_it() {
        let conn = db::open_in_memory().unwrap();
        save(&conn, json!({ "id": "o", "kind": "openai_compatible", "name": "OpenAI", "apiKey": "k1" }));
        save(&conn, json!({ "id": "o", "kind": "openai_compatible", "name": "Renamed", "model": "gpt-x" }));
        let cfg = ai_provider_config(&conn, Some("o")).unwrap();
        assert_eq!(cfg.api_key.as_deref(), Some("k1"));
        assert_eq!(cfg.model, "gpt-x");
        save(&conn, json!({ "id": "o", "kind": "openai_compatible", "name": "Renamed", "apiKey": null }));
        assert_eq!(ai_provider_config(&conn, Some("o")).unwrap().api_key, None);
    }

    #[test]
    fn switching_and_deleting_the_default() {
        let conn = db::open_in_memory().unwrap();
        save(&conn, json!({ "id": "a", "kind": "anthropic", "name": "Claude" }));
        save(&conn, json!({ "id": "o", "kind": "openai_compatible", "name": "Ollama", "baseUrl": "http://localhost:11434/v1" }));
        set_default_ai_provider(&conn, "o").unwrap();
        assert_eq!(ai_provider_config(&conn, None).unwrap().base_url, "http://localhost:11434/v1");
        delete_ai_provider(&conn, "o").unwrap();
        assert_eq!(ai_provider_config(&conn, None).unwrap().kind, crate::ai::ProviderKind::Anthropic);
        assert!(set_default_ai_provider(&conn, "nope").unwrap_err().contains("no such"));
    }

    #[test]
    fn rejects_unknown_kinds_and_explains_when_nothing_is_set_up() {
        let conn = db::open_in_memory().unwrap();
        assert!(save_ai_provider(&conn, &json!({ "id": "x", "kind": "skynet", "name": "X" })).unwrap_err().contains("unknown AI provider kind"));
        assert!(ai_provider_config(&conn, None).unwrap_err().contains("No AI provider is set up yet"));
    }
}
