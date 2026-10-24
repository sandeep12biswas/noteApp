//! The two custom URL schemes the frontend loads from — the Tauri
//! counterparts of the handlers in `apps/electron/src/main.ts`:
//!
//! - `flownote-plugin` — plugin files and the plugin SDK (`plugins/<id>/…`,
//!   `sdk/…`), which live in the bundled frontend. Sandboxed plugin iframes
//!   (`allow-scripts`, no `allow-same-origin`) have an opaque origin, so they
//!   can't load the app's own origin; a separate scheme they're allowed to
//!   fetch from is what makes them work (see PluginManager.tsx).
//! - `flownote-attachment` — an attachment's bytes, by id, for `<img>`
//!   embeds (attachmentBlockNode.tsx).
//!
//! URLs look like `flownote-plugin://localhost/<path>` on macOS/Linux and
//! `http://flownote-plugin.localhost/<path>` on Windows (WebView2 can't use a
//! custom scheme directly); either way the handler only sees the path. The
//! frontend builds them with `lib/customProtocolUrl.ts`.
//!
//! These functions are pure (a path in, a response out) so they can be
//! unit-tested without a running Tauri app; `apps/tauri/src-tauri` registers
//! them with `register_uri_scheme_protocol`.

use flownote_core::store;
use rusqlite::Connection;
use serde_json::Value;
use tauri::http::{header, Response, StatusCode};

pub const PLUGIN_SCHEME: &str = "flownote-plugin";
pub const ATTACHMENT_SCHEME: &str = "flownote-attachment";

fn respond(status: StatusCode, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        // Requests come from opaque-origin (sandboxed) plugin iframes, and
        // `<script type="module">` loads are CORS requests.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .expect("static headers are always valid")
}

fn not_found(message: impl Into<String>) -> Response<Vec<u8>> {
    respond(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", message.into().into_bytes())
}

/// Serves a file from the bundled frontend for the `flownote-plugin` scheme.
///
/// `get_asset(path)` looks a path up in the bundled frontend, returning
/// `(bytes, mime)`. Tauri's own lookup falls back to `index.html` for a path
/// it doesn't have (single-page-app routing), which here would load the whole
/// FlowNote app inside a plugin's iframe — so a result identical to
/// `index.html` is treated as "not found".
pub fn plugin_asset_response(
    path: &str,
    get_asset: impl Fn(&str) -> Option<(Vec<u8>, String)>,
) -> Response<Vec<u8>> {
    let path = path.trim_start_matches('/');
    if !(path.starts_with("plugins/") || path.starts_with("sdk/")) || path.split('/').any(|seg| seg == "..") {
        return not_found(format!("not a plugin asset: /{path}"));
    }
    let Some((bytes, mime)) = get_asset(path) else {
        return not_found(format!("no such plugin asset: /{path}"));
    };
    if get_asset("index.html").is_some_and(|(index, _)| index == bytes) {
        return not_found(format!("no such plugin asset: /{path}"));
    }
    respond(StatusCode::OK, &mime, bytes)
}

/// Serves an attachment's bytes for the `flownote-attachment` scheme;
/// `path` is `/<attachment id>`.
pub fn attachment_response(conn: &Connection, path: &str) -> Response<Vec<u8>> {
    let id = path.trim_start_matches('/');
    let attachment = match store::get_attachment(conn, id) {
        Ok(Some(attachment)) => attachment,
        Ok(None) => return not_found(format!("no such attachment: {id}")),
        Err(e) => return respond(StatusCode::INTERNAL_SERVER_ERROR, "text/plain; charset=utf-8", e.into_bytes()),
    };
    let file_path = attachment.get("path").and_then(Value::as_str).unwrap_or_default();
    let mime = attachment.get("mimeType").and_then(Value::as_str).unwrap_or("application/octet-stream");
    match std::fs::read(file_path) {
        Ok(bytes) => respond(StatusCode::OK, mime, bytes),
        Err(e) => not_found(format!("attachment {id}'s file is missing: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn assets() -> HashMap<&'static str, (Vec<u8>, String)> {
        HashMap::from([
            ("index.html", (b"<app shell>".to_vec(), "text/html".to_string())),
            ("plugins/p/grid.html", (b"<grid>".to_vec(), "text/html".to_string())),
            ("sdk/index.js", (b"export {}".to_vec(), "text/javascript".to_string())),
        ])
    }

    /// Mimics Tauri's asset lookup, including its fallback to index.html.
    fn tauri_like_lookup(path: &str) -> Option<(Vec<u8>, String)> {
        let a = assets();
        a.get(path).or_else(|| a.get("index.html")).cloned()
    }

    #[test]
    fn serves_plugin_and_sdk_files_with_their_mime_type_and_cors() {
        let res = plugin_asset_response("/plugins/p/grid.html", tauri_like_lookup);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.body(), b"<grid>");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/html");
        assert_eq!(res.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");

        let res = plugin_asset_response("/sdk/index.js", tauri_like_lookup);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::CONTENT_TYPE], "text/javascript");
    }

    #[test]
    fn a_missing_plugin_file_is_404_not_the_app_shell() {
        let res = plugin_asset_response("/plugins/p/missing.js", tauri_like_lookup);
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn only_plugin_and_sdk_paths_are_served() {
        for path in ["/index.html", "/assets/app.js", "/plugins/../index.html", "/sdk/../../etc"] {
            assert_eq!(plugin_asset_response(path, tauri_like_lookup).status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    fn conn_on_disk() -> Connection {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "flownote-tauri-protocol-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = Connection::open(dir.join("db.sqlite3")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        flownote_core::migrations::run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO pages (id, notebook_id, title, mode, created_at, updated_at) VALUES ('p', 'nb-1', 'P', 'canvas', 0, 0);
             INSERT INTO segments (id, page_id, x, y, w, h, z_index, content, created_at, updated_at)
               VALUES ('s', 'p', 0, 0, 1, 1, 0, 'null', 0, 0);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn serves_an_attachments_bytes_with_its_mime_type() {
        let conn = conn_on_disk();
        // "PNG!" in base64
        store::save_attachment(
            &conn,
            &serde_json::json!({ "id": "a1", "segmentId": "s", "fileName": "x.png", "mimeType": "image/png", "dataBase64": "UE5HIQ==" }),
        )
        .unwrap();

        let res = attachment_response(&conn, "/a1");
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.body(), b"PNG!");
        assert_eq!(res.headers()[header::CONTENT_TYPE], "image/png");
    }

    #[test]
    fn an_unknown_attachment_is_404() {
        let conn = conn_on_disk();
        assert_eq!(attachment_response(&conn, "/nope").status(), StatusCode::NOT_FOUND);
    }
}
