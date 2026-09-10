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
        let res = dispatch(&conn, Request { id: 5, method: "save_segment".into(), params: Value::Null });
        assert_eq!(res.error.unwrap(), "method not implemented: save_segment");
    }
}
