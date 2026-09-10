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
use serde::Serialize;
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
}
