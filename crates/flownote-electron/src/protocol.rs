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
//!
//! The storage logic each method calls lives in `flownote_core::store`,
//! shared with the Tauri shell (DESIGN.md §6.3) — this module only maps
//! wire requests onto it.

use flownote_core::store::*;
use rusqlite::Connection;
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

        "delete_page" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "delete_page requires a string `id` param"),
            Some(id) => match delete_page(conn, id) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e.to_string()),
            },
        },

        "delete_folder" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "delete_folder requires a string `id` param"),
            Some(id) => match delete_folder(conn, id) {
                Ok(()) => Response::ok(req.id, Value::Null),
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

        "save_attachment" => match save_attachment(conn, &req.params) {
            Ok(result) => Response::ok(req.id, result),
            Err(e) => Response::err(req.id, e),
        },

        "get_attachment" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "get_attachment requires a string `id` param"),
            Some(id) => match get_attachment(conn, id) {
                Ok(Some(attachment)) => Response::ok(req.id, attachment),
                Ok(None) => Response::err(req.id, format!("no such attachment: {id}")),
                Err(e) => Response::err(req.id, e),
            },
        },

        "delete_attachment" => match req.params.get("id").and_then(Value::as_str) {
            None => Response::err(req.id, "delete_attachment requires a string `id` param"),
            Some(id) => match delete_attachment(conn, id) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e),
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

        "add_dictionary_word" => match req.params.get("word").and_then(Value::as_str) {
            None => Response::err(req.id, "add_dictionary_word requires a string `word` param"),
            Some(word) => match add_dictionary_word(conn, word) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e),
            },
        },

        "list_dictionary_words" => match list_dictionary_words(conn) {
            Ok(words) => Response::ok(req.id, Value::Array(words.into_iter().map(Value::String).collect())),
            Err(e) => Response::err(req.id, e),
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
            Some(id) => match uninstall_plugin(conn, id) {
                Ok(()) => Response::ok(req.id, Value::Null),
                Err(e) => Response::err(req.id, e),
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
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
    fn list_dictionary_words_returns_empty_for_a_fresh_database() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 70, method: "list_dictionary_words".into(), params: Value::Null });
        assert_eq!(res.result.unwrap(), json!([]));
    }

    #[test]
    fn add_dictionary_word_then_list_round_trips() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 71, method: "add_dictionary_word".into(), params: json!({ "word": "flownotex" }) });
        let res = dispatch(&conn, Request { id: 72, method: "list_dictionary_words".into(), params: Value::Null });
        assert_eq!(res.result.unwrap(), json!(["flownotex"]));
    }

    #[test]
    fn add_dictionary_word_lowercases_before_storing() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 73, method: "add_dictionary_word".into(), params: json!({ "word": "Sandeep" }) });
        let res = dispatch(&conn, Request { id: 74, method: "list_dictionary_words".into(), params: Value::Null });
        assert_eq!(res.result.unwrap(), json!(["sandeep"]));
    }

    #[test]
    fn add_dictionary_word_is_idempotent_for_duplicate_word() {
        let conn = db::open_in_memory().unwrap();
        dispatch(&conn, Request { id: 75, method: "add_dictionary_word".into(), params: json!({ "word": "flownotex" }) });
        dispatch(&conn, Request { id: 76, method: "add_dictionary_word".into(), params: json!({ "word": "flownotex" }) });
        let res = dispatch(&conn, Request { id: 77, method: "list_dictionary_words".into(), params: Value::Null });
        assert_eq!(res.result.unwrap(), json!(["flownotex"]));
    }

    #[test]
    fn add_dictionary_word_errors_on_missing_word_param() {
        let conn = db::open_in_memory().unwrap();
        let res = dispatch(&conn, Request { id: 78, method: "add_dictionary_word".into(), params: Value::Null });
        assert!(res.error.unwrap().contains("requires a string `word`"));
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

    #[test]
    fn delete_page_cascades_to_segments_and_blocks() {
        let conn = conn_with_page("page-1");
        dispatch(
            &conn,
            Request {
                id: 40,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );

        let res = dispatch(&conn, Request { id: 41, method: "delete_page".into(), params: json!({ "id": "page-1" }) });
        assert!(res.error.is_none());

        let pages: i64 = conn.query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0)).unwrap();
        assert_eq!(pages, 0);
        let segments: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0)).unwrap();
        assert_eq!(segments, 0);
    }

    #[test]
    fn delete_folder_cascades_to_subfolders_pages_and_segments() {
        let conn = db::open_in_memory().unwrap();
        dispatch(
            &conn,
            Request {
                id: 42,
                method: "save_folder".into(),
                params: json!({ "id": "folder-1", "name": "Parent", "parentId": null, "icon": null, "expanded": false }),
            },
        );
        dispatch(
            &conn,
            Request {
                id: 43,
                method: "save_folder".into(),
                params: json!({ "id": "folder-2", "name": "Child", "parentId": "folder-1", "icon": null, "expanded": false }),
            },
        );
        dispatch(
            &conn,
            Request {
                id: 44,
                method: "save_page".into(),
                params: json!({ "id": "page-1", "folderId": "folder-2", "title": "Notes" }),
            },
        );
        dispatch(
            &conn,
            Request {
                id: 45,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );

        let res = dispatch(&conn, Request { id: 46, method: "delete_folder".into(), params: json!({ "id": "folder-1" }) });
        assert!(res.error.is_none());

        let folders: i64 = conn.query_row("SELECT COUNT(*) FROM folders", [], |row| row.get(0)).unwrap();
        assert_eq!(folders, 0);
        let pages: i64 = conn.query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0)).unwrap();
        assert_eq!(pages, 0);
        let segments: i64 = conn.query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0)).unwrap();
        assert_eq!(segments, 0);
    }

    /// Attachments need a *file-backed* connection, unlike every other test
    /// here (`db::open_in_memory()`) — `attachments_dir()` derives the
    /// attachments directory from `Connection::path()`, which is `None` for
    /// an in-memory connection. Each call gets its own throwaway SQLite file
    /// (and matching `attachments/` dir) in its *own* directory under the OS
    /// temp dir. The directory has to be unique, not just the file name: the
    /// attachments dir is the database's sibling, and tests reuse attachment
    /// ids (`att-1` + `a.bin`), so a shared parent made parallel tests delete
    /// each other's files — a flaky failure here, and a reliable one once
    /// flownote-tauri's tests ran alongside. Nothing deletes it afterward
    /// since it's a throwaway temp path, same as any other test artifact
    /// left in `$TMPDIR`.
    fn conn_with_page_on_disk(page_id: &str) -> Connection {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "flownote-electron-attachment-test-{}-{}-{}",
            std::process::id(),
            n,
            now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("db.sqlite3")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        flownote_core::migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at)
             VALUES (?1, 'nb-1', 'Untitled', 'canvas', 0, 0)",
            [page_id],
        )
        .unwrap();
        conn
    }

    #[test]
    fn save_attachment_then_get_attachment_round_trips() {
        let conn = conn_with_page_on_disk("page-1");
        dispatch(
            &conn,
            Request {
                id: 50,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );

        let data_base64 = base64::engine::general_purpose::STANDARD.encode(b"hello attachment bytes");
        let res = dispatch(
            &conn,
            Request {
                id: 51,
                method: "save_attachment".into(),
                params: json!({ "id": "att-1", "segmentId": "seg-1", "fileName": "notes.txt", "mimeType": "text/plain", "dataBase64": data_base64 }),
            },
        );
        assert!(res.error.is_none(), "save_attachment errored: {:?}", res.error);
        assert_eq!(res.result.as_ref().unwrap()["fileName"], json!("notes.txt"));
        assert_eq!(res.result.as_ref().unwrap()["size"], json!(22));

        let got = dispatch(&conn, Request { id: 52, method: "get_attachment".into(), params: json!({ "id": "att-1" }) });
        assert!(got.error.is_none());
        let path = got.result.as_ref().unwrap()["path"].as_str().unwrap().to_string();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello attachment bytes");
    }

    #[test]
    fn delete_attachment_removes_the_row_and_the_file() {
        let conn = conn_with_page_on_disk("page-1");
        dispatch(
            &conn,
            Request {
                id: 53,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
        dispatch(
            &conn,
            Request {
                id: 54,
                method: "save_attachment".into(),
                params: json!({ "id": "att-1", "segmentId": "seg-1", "fileName": "a.bin", "mimeType": "application/octet-stream", "dataBase64": data_base64 }),
            },
        );
        let path = get_attachment(&conn, "att-1").unwrap().unwrap()["path"].as_str().unwrap().to_string();
        assert!(std::path::Path::new(&path).exists());

        let res = dispatch(&conn, Request { id: 55, method: "delete_attachment".into(), params: json!({ "id": "att-1" }) });
        assert!(res.error.is_none());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        assert!(!std::path::Path::new(&path).exists(), "attachment file should be removed from disk");
    }

    #[test]
    fn delete_segment_also_removes_its_attachment_file() {
        let conn = conn_with_page_on_disk("page-1");
        dispatch(
            &conn,
            Request {
                id: 56,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
        dispatch(
            &conn,
            Request {
                id: 57,
                method: "save_attachment".into(),
                params: json!({ "id": "att-1", "segmentId": "seg-1", "fileName": "a.bin", "mimeType": "application/octet-stream", "dataBase64": data_base64 }),
            },
        );
        let path = get_attachment(&conn, "att-1").unwrap().unwrap()["path"].as_str().unwrap().to_string();

        dispatch(&conn, Request { id: 58, method: "delete_segment".into(), params: json!({ "id": "seg-1" }) });

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        assert!(!std::path::Path::new(&path).exists());
    }

    #[test]
    fn delete_page_also_removes_its_segments_attachment_files() {
        let conn = conn_with_page_on_disk("page-1");
        dispatch(
            &conn,
            Request {
                id: 59,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
        dispatch(
            &conn,
            Request {
                id: 60,
                method: "save_attachment".into(),
                params: json!({ "id": "att-1", "segmentId": "seg-1", "fileName": "a.bin", "mimeType": "application/octet-stream", "dataBase64": data_base64 }),
            },
        );
        let path = get_attachment(&conn, "att-1").unwrap().unwrap()["path"].as_str().unwrap().to_string();

        dispatch(&conn, Request { id: 61, method: "delete_page".into(), params: json!({ "id": "page-1" }) });

        assert!(!std::path::Path::new(&path).exists());
    }

    #[test]
    fn delete_folder_also_removes_nested_attachment_files() {
        let conn = conn_with_page_on_disk("page-1");
        // `conn_with_page_on_disk` already creates "page-1" un-foldered;
        // give it a real folder so `delete_folder` has something to cascade
        // through down to its segment's attachment.
        dispatch(
            &conn,
            Request {
                id: 62,
                method: "save_folder".into(),
                params: json!({ "id": "folder-1", "name": "Parent", "parentId": null, "icon": null, "expanded": false }),
            },
        );
        conn.execute("UPDATE pages SET folder_id = 'folder-1' WHERE id = 'page-1'", []).unwrap();
        dispatch(
            &conn,
            Request {
                id: 63,
                method: "save_segment".into(),
                params: json!({ "id": "seg-1", "pageId": "page-1", "x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0 }),
            },
        );
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(b"bytes");
        dispatch(
            &conn,
            Request {
                id: 64,
                method: "save_attachment".into(),
                params: json!({ "id": "att-1", "segmentId": "seg-1", "fileName": "a.bin", "mimeType": "application/octet-stream", "dataBase64": data_base64 }),
            },
        );
        let path = get_attachment(&conn, "att-1").unwrap().unwrap()["path"].as_str().unwrap().to_string();

        dispatch(&conn, Request { id: 65, method: "delete_folder".into(), params: json!({ "id": "folder-1" }) });

        assert!(!std::path::Path::new(&path).exists());
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
