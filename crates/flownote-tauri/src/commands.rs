//! `#[tauri::command]` handlers — DESIGN.md §3.2/§8.1/§8.2 (Windows/macOS
//! shell). Mirrors crates/flownote-electron/src/protocol.rs one-for-one:
//! both platforms run the same flownote-core storage layer, so `getPage`
//! here and `get_page` there must behave identically (DESIGN.md §10
//! "IPCAdapter type drift"). Extend both together.
//!
//! Each command is a thin wrapper around a pure `_impl` function that takes
//! a `&Connection` directly — that's what's unit-tested below, the same way
//! protocol.rs's `dispatch` is, without needing a running Tauri app.

use flownote_core::db::Pool;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

/// Shared app state — the SQLite connection pool, managed by Tauri and
/// injected into every command via `State<AppState>`.
pub struct AppState {
    pub pool: Pool,
}

#[derive(Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub id: String,
    pub notebook_id: String,
    pub title: String,
    pub mode: String,
    pub created_at: i64,
    pub updated_at: i64,
}

fn get_page_impl(conn: &Connection, page_id: &str) -> Result<PageDto, String> {
    conn.query_row(
        "SELECT id, notebook_id, title, mode, created_at, updated_at FROM pages WHERE id = ?1",
        [page_id],
        |row| {
            Ok(PageDto {
                id: row.get(0)?,
                notebook_id: row.get(1)?,
                title: row.get(2)?,
                mode: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("no such page: {page_id}"))
}

#[tauri::command]
#[specta::specta]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
#[specta::specta]
pub fn get_page(state: State<AppState>, page_id: String) -> Result<PageDto, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    get_page_impl(&conn, &page_id)
}

#[derive(Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub expanded: bool,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderInput {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub expanded: bool,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PageInput {
    pub id: String,
    pub folder_id: String,
    pub title: String,
}

#[derive(Debug, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SegmentInput {
    pub id: String,
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub z_index: i64,
    pub border_color: Option<String>,
    pub fill_color: Option<String>,
    /// TipTap JSON document, passed through as an opaque JSON value (DESIGN.md §7.1).
    #[serde(default)]
    pub content: serde_json::Value,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn save_folder_impl(conn: &Connection, folder: &FolderInput) -> Result<(), String> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, icon, expanded, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, parent_id = excluded.parent_id,
           icon = excluded.icon, expanded = excluded.expanded, updated_at = excluded.updated_at",
        rusqlite::params![folder.id, folder.name, folder.parent_id, folder.icon, folder.expanded, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_folders_impl(conn: &Connection) -> Result<Vec<FolderDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, icon, expanded FROM folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FolderDto {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                icon: row.get(3)?,
                expanded: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn save_page_impl(conn: &Connection, page: &PageInput) -> Result<(), String> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO pages (id, notebook_id, folder_id, title, mode, created_at, updated_at)
         VALUES (?1, 'nb-1', ?2, ?3, 'canvas', ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           folder_id = excluded.folder_id, title = excluded.title, updated_at = excluded.updated_at",
        rusqlite::params![page.id, page.folder_id, page.title, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_pages_impl(conn: &Connection, folder_id: &str) -> Result<Vec<PageDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, notebook_id, folder_id, title, mode, created_at, updated_at FROM pages WHERE folder_id = ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([folder_id], |row| {
            Ok(PageDto {
                id: row.get(0)?,
                notebook_id: row.get(1)?,
                title: row.get(3)?,
                mode: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn save_segment_impl(conn: &Connection, seg: &SegmentInput) -> Result<(), String> {
    let now = now_ms();
    let content = seg.content.to_string();
    conn.execute(
        "INSERT INTO segments (id, page_id, x, y, w, h, z_index, border_color, fill_color, content, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT(id) DO UPDATE SET
           x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
           z_index = excluded.z_index, border_color = excluded.border_color,
           fill_color = excluded.fill_color, content = excluded.content,
           updated_at = excluded.updated_at",
        rusqlite::params![
            seg.id, seg.page_id, seg.x, seg.y, seg.w, seg.h, seg.z_index,
            seg.border_color, seg.fill_color, content, now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SegmentDto {
    pub id: String,
    pub page_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z_index: i64,
    pub border_color: Option<String>,
    pub fill_color: Option<String>,
    pub content: serde_json::Value,
}

fn list_segments_impl(conn: &Connection, page_id: &str) -> Result<Vec<SegmentDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, page_id, x, y, w, h, z_index, border_color, fill_color, content
             FROM segments WHERE page_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([page_id], |row| {
            let content: String = row.get(9)?;
            Ok((
                SegmentDto {
                    id: row.get(0)?,
                    page_id: row.get(1)?,
                    x: row.get(2)?,
                    y: row.get(3)?,
                    w: row.get(4)?,
                    h: row.get(5)?,
                    z_index: row.get(6)?,
                    border_color: row.get(7)?,
                    fill_color: row.get(8)?,
                    content: serde_json::Value::Null,
                },
                content,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (mut dto, content) = row.map_err(|e| e.to_string())?;
        dto.content = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        out.push(dto);
    }
    Ok(out)
}

fn delete_segment_impl(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM segments WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Mirrors `flownote-electron/src/protocol.rs`'s `save_ink_layer` — see its
/// doc comment for why this is on `pages`, not `segments` (a stray, unused
/// `ink_layer` column already exists on the latter from V1).
fn save_ink_layer_impl(conn: &Connection, page_id: &str, data_url: &str) -> Result<(), String> {
    let changed = conn
        .execute("UPDATE pages SET ink_layer = ?1, updated_at = ?2 WHERE id = ?3", rusqlite::params![data_url, now_ms(), page_id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(format!("no such page: {page_id}"));
    }
    Ok(())
}

/// Mirrors `flownote-electron/src/protocol.rs`'s `get_ink_layer` — `None`
/// covers both "page has no ink layer saved yet" and is distinguished from
/// "no such page" by the `Result`, same split as that function.
fn get_ink_layer_impl(conn: &Connection, page_id: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT ink_layer FROM pages WHERE id = ?1", [page_id], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("no such page: {page_id}"))
}

#[tauri::command]
#[specta::specta]
pub fn save_folder(state: State<AppState>, folder: FolderInput) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    save_folder_impl(&conn, &folder)
}

#[tauri::command]
#[specta::specta]
pub fn list_folders(state: State<AppState>) -> Result<Vec<FolderDto>, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    list_folders_impl(&conn)
}

#[tauri::command]
#[specta::specta]
pub fn save_page(state: State<AppState>, page: PageInput) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    save_page_impl(&conn, &page)
}

#[tauri::command]
#[specta::specta]
pub fn list_pages(state: State<AppState>, folder_id: String) -> Result<Vec<PageDto>, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    list_pages_impl(&conn, &folder_id)
}

#[tauri::command]
#[specta::specta]
pub fn list_segments(state: State<AppState>, page_id: String) -> Result<Vec<SegmentDto>, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    list_segments_impl(&conn, &page_id)
}

#[tauri::command]
#[specta::specta]
pub fn save_segment(state: State<AppState>, segment: SegmentInput) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    save_segment_impl(&conn, &segment)
}

#[tauri::command]
#[specta::specta]
pub fn save_segments_batch(state: State<AppState>, segments: Vec<SegmentInput>) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    for seg in &segments {
        save_segment_impl(&conn, seg)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn delete_segment(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    delete_segment_impl(&conn, &id)
}

#[tauri::command]
#[specta::specta]
pub fn save_ink_layer(state: State<AppState>, page_id: String, data_url: String) -> Result<(), String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    save_ink_layer_impl(&conn, &page_id, &data_url)
}

#[tauri::command]
#[specta::specta]
pub fn get_ink_layer(state: State<AppState>, page_id: String) -> Result<Option<String>, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    get_ink_layer_impl(&conn, &page_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flownote_core::db;

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
        assert_eq!(ping(), "pong");
    }

    #[test]
    fn get_page_returns_the_row() {
        let conn = conn_with_page("page-1");
        let page = get_page_impl(&conn, "page-1").unwrap();
        assert_eq!(
            page,
            PageDto {
                id: "page-1".into(),
                notebook_id: "nb-1".into(),
                title: "Untitled".into(),
                mode: "canvas".into(),
                created_at: 0,
                updated_at: 0,
            }
        );
    }

    #[test]
    fn get_page_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let err = get_page_impl(&conn, "missing").unwrap_err();
        assert!(err.contains("no such page"));
    }

    #[test]
    fn save_folder_then_list_folders_round_trips() {
        let conn = db::open_in_memory().unwrap();
        save_folder_impl(
            &conn,
            &FolderInput { id: "folder-1".into(), name: "Work".into(), parent_id: None, icon: None, expanded: true },
        )
        .unwrap();

        let folders = list_folders_impl(&conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Work");
        assert!(folders[0].expanded);
    }

    #[test]
    fn save_folder_upserts_on_repeat_id() {
        let conn = db::open_in_memory().unwrap();
        for name in ["Work", "Work Renamed"] {
            save_folder_impl(
                &conn,
                &FolderInput { id: "folder-1".into(), name: name.into(), parent_id: None, icon: None, expanded: false },
            )
            .unwrap();
        }
        let folders = list_folders_impl(&conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Work Renamed");
    }

    #[test]
    fn save_page_then_list_pages_round_trips() {
        let conn = db::open_in_memory().unwrap();
        save_folder_impl(
            &conn,
            &FolderInput { id: "folder-1".into(), name: "Work".into(), parent_id: None, icon: None, expanded: false },
        )
        .unwrap();
        save_page_impl(
            &conn,
            &PageInput { id: "page-1".into(), folder_id: "folder-1".into(), title: "Notes".into() },
        )
        .unwrap();

        let pages = list_pages_impl(&conn, "folder-1").unwrap();
        assert_eq!(pages.len(), 1);
        assert_eq!(pages[0].title, "Notes");
    }

    #[test]
    fn save_segment_persists_content() {
        let conn = conn_with_page("page-1");
        save_segment_impl(
            &conn,
            &SegmentInput {
                id: "seg-1".into(),
                page_id: "page-1".into(),
                x: 10.0,
                y: 20.0,
                w: 320.0,
                h: 80.0,
                z_index: 0,
                border_color: None,
                fill_color: None,
                content: serde_json::json!({ "type": "doc", "content": [] }),
            },
        )
        .unwrap();

        let stored: String = conn
            .query_row("SELECT content FROM segments WHERE id = 'seg-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, serde_json::json!({ "type": "doc", "content": [] }).to_string());
    }

    #[test]
    fn save_segment_rejects_a_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let err = save_segment_impl(
            &conn,
            &SegmentInput {
                id: "seg-1".into(),
                page_id: "missing-page".into(),
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
                z_index: 0,
                border_color: None,
                fill_color: None,
                content: serde_json::Value::Null,
            },
        )
        .unwrap_err();
        assert!(err.contains("FOREIGN KEY"));
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
        save_segment_impl(
            &conn,
            &SegmentInput {
                id: "seg-1".into(),
                page_id: "page-1".into(),
                x: 5.0,
                y: 6.0,
                w: 1.0,
                h: 1.0,
                z_index: 0,
                border_color: None,
                fill_color: None,
                content: serde_json::json!({ "type": "doc", "content": [] }),
            },
        )
        .unwrap();
        save_segment_impl(
            &conn,
            &SegmentInput {
                id: "seg-2".into(),
                page_id: "page-2".into(),
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
                z_index: 0,
                border_color: None,
                fill_color: None,
                content: serde_json::Value::Null,
            },
        )
        .unwrap();

        let segs = list_segments_impl(&conn, "page-1").unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].id, "seg-1");
        assert_eq!(segs[0].content, serde_json::json!({ "type": "doc", "content": [] }));
    }

    #[test]
    fn delete_segment_removes_the_row() {
        let conn = conn_with_page("page-1");
        save_segment_impl(
            &conn,
            &SegmentInput {
                id: "seg-1".into(),
                page_id: "page-1".into(),
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: 1.0,
                z_index: 0,
                border_color: None,
                fill_color: None,
                content: serde_json::Value::Null,
            },
        )
        .unwrap();
        delete_segment_impl(&conn, "seg-1").unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn get_ink_layer_returns_none_for_a_page_never_drawn_on() {
        let conn = conn_with_page("page-1");
        assert_eq!(get_ink_layer_impl(&conn, "page-1").unwrap(), None);
    }

    #[test]
    fn save_ink_layer_then_get_ink_layer_round_trips() {
        let conn = conn_with_page("page-1");
        save_ink_layer_impl(&conn, "page-1", "data:image/png;base64,abc123").unwrap();
        assert_eq!(get_ink_layer_impl(&conn, "page-1").unwrap(), Some("data:image/png;base64,abc123".into()));
    }

    #[test]
    fn save_ink_layer_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let err = save_ink_layer_impl(&conn, "missing", "x").unwrap_err();
        assert!(err.contains("no such page"));
    }

    #[test]
    fn get_ink_layer_errors_on_missing_page() {
        let conn = db::open_in_memory().unwrap();
        let err = get_ink_layer_impl(&conn, "missing").unwrap_err();
        assert!(err.contains("no such page"));
    }
}
