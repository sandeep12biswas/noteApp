// Tauri desktop shell entry point (Windows/macOS) — DESIGN.md §3.2/§8.1.
// All actual command logic lives in flownote-tauri; this crate just wires
// it into a running Tauri app: opens the SQLite pool, manages it as state,
// attaches the generated invoke handler, and (debug builds only) exports
// TypeScript bindings for packages/ipc-adapter's TauriIPCAdapter.
use flownote_tauri::protocols::{self, ATTACHMENT_SCHEME, PLUGIN_SCHEME};
use flownote_tauri::AppState;
use tauri::http::{header, HeaderValue, Method, Response, StatusCode};
use tauri::{Emitter, Manager};

fn db_path(app: &tauri::App) -> String {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    std::fs::create_dir_all(&dir).expect("failed to create app data dir");
    dir.join("flownote.sqlite3").to_string_lossy().into_owned()
}

/// TEMPORARY (issue #33): plugin-protocol requests seen while FLOWNOTE_PROTOCOL_PROBE is set.
static PROBE_LOG: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// wry's default WebView2 arguments — passing any `additional_browser_args`
/// replaces them, so they're repeated when adding our own.
const WEBVIEW2_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Creates the main window from tauri.conf.json (which marks it
/// `"create": false` so it's built here instead).
///
/// Test hook: when `FLOWNOTE_WEBVIEW_DEBUG_PORT` holds a port number, WebView2
/// (Windows) opens its DevTools protocol on that port so
/// e2e-tauri/windows-smoke.mjs can attach. WebView2's own
/// `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` variable can't be used for this:
/// wry always sets the browser arguments explicitly, which take precedence.
/// Unset (the normal case), the window is exactly what the config describes.
fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app.config().app.windows.first().cloned().expect("tauri.conf.json defines the main window");
    let mut builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    if let Some(port) = std::env::var("FLOWNOTE_WEBVIEW_DEBUG_PORT").ok().and_then(|p| p.parse::<u16>().ok()) {
        builder = builder.additional_browser_args(&format!("{WEBVIEW2_DEFAULT_ARGS} --remote-debugging-port={port}"));
    }
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = flownote_tauri::specta_builder();

    #[cfg(debug_assertions)]
    flownote_tauri::export_bindings("../../../packages/ipc-adapter/src/generated/tauri-bindings.ts")
        .expect("failed to export tauri-specta TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(specta_builder.invoke_handler())
        // Plugin files/SDK and attachment bytes — see flownote_tauri::protocols.
        .register_uri_scheme_protocol(PLUGIN_SCHEME, |ctx, request| {
            // TEMPORARY (issue #33): CORS diagnostics, only when the Windows
            // smoke test sets FLOWNOTE_PROTOCOL_PROBE. Remove with the fix.
            let probe = std::env::var_os("FLOWNOTE_PROTOCOL_PROBE").is_some();
            if probe {
                let h = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("-").to_string();
                let line = format!(
                    "{} {} origin={} pna={} mode={} dest={}",
                    request.method(),
                    request.uri(),
                    h("origin"),
                    h("access-control-request-private-network"),
                    h("sec-fetch-mode"),
                    h("sec-fetch-dest")
                );
                let mut log = PROBE_LOG.lock().unwrap();
                if request.uri().path() == "/__probe/log" {
                    let body = serde_json::to_vec(&*log).unwrap_or_default();
                    return Response::builder()
                        .header(header::CONTENT_TYPE, "application/json")
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(body)
                        .unwrap();
                }
                log.push(line);
            }
            let app = ctx.app_handle();
            let resolver = app.asset_resolver();
            // Where plugin files are served from, as the page sees it:
            // flownote-plugin://localhost, or http://flownote-plugin.localhost
            // on Windows — the plugin's CSP allows exactly that origin.
            let uri = request.uri();
            let origin = format!("{}://{}", uri.scheme_str().unwrap_or(PLUGIN_SCHEME), uri.authority().map(|a| a.as_str()).unwrap_or("localhost"));
            let mut response = protocols::plugin_asset_response(
                uri.path(),
                |path| resolver.get(path.to_string()).map(|asset| (asset.bytes, asset.mime_type)),
                |plugin_id| {
                    let strictest = flownote_core::store::plugin_content_security_policy(&[], &origin);
                    let Some(state) = app.try_state::<AppState>() else { return strictest };
                    state
                        .pool
                        .get()
                        .ok()
                        .and_then(|conn| flownote_core::store::plugin_csp_for(&conn, plugin_id, &origin).ok())
                        .unwrap_or(strictest)
                },
            );
            if probe {
                let query = uri.query().unwrap_or("");
                let headers = response.headers_mut();
                let origin = request.headers().get(header::ORIGIN).cloned();
                if query.contains("acao=null") {
                    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("null"));
                } else if query.contains("acao=echo") {
                    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin.unwrap_or(HeaderValue::from_static("*")));
                    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
                }
                if query.contains("pna=1") {
                    headers.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
                }
                if request.method() == Method::OPTIONS {
                    *response.status_mut() = StatusCode::NO_CONTENT;
                    let headers = response.headers_mut();
                    headers.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, OPTIONS"));
                    headers.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("*"));
                    headers.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
                }
            }
            response
        })
        .register_uri_scheme_protocol(ATTACHMENT_SCHEME, |ctx, request| {
            let Some(state) = ctx.app_handle().try_state::<AppState>() else {
                return Response::builder()
                    .status(StatusCode::SERVICE_UNAVAILABLE)
                    .body(b"database not open yet".to_vec())
                    .unwrap();
            };
            match state.pool.get() {
                Ok(conn) => protocols::attachment_response(&conn, request.uri().path()),
                Err(e) => Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(e.to_string().into_bytes())
                    .unwrap(),
            }
        })
        .setup(move |app| {
            let pool = flownote_core::db::open(&db_path(app)).expect("failed to open flownote db");
            // Background sync (step S5); its events reach the frontend as
            // the `sync-event` app event (TauriIPCAdapter.onSyncEvent).
            let handle = app.handle().clone();
            let sync = flownote_core::sync::service::SyncService::start(
                pool.clone(),
                std::sync::Arc::new(move |event| {
                    let _ = handle.emit("sync-event", event);
                }),
            )
            .expect("failed to start sync");
            app.manage(AppState { pool, sync: std::sync::Arc::new(sync) });
            create_main_window(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
