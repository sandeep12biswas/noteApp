//! `#[tauri::command]` handlers — DESIGN.md §3.2/§8.1/§8.2 (Windows/macOS
//! shell). Every command is a typed wrapper around `flownote_core::store`,
//! the same storage layer flownote-electron's sidecar `dispatch` calls
//! (DESIGN.md §6.3), so `getPage` here and `get_page` there can't behave
//! differently (DESIGN.md §10 "IPCAdapter type drift"). New storage
//! behaviour goes in `store`; this file only adds the typed, specta-exported
//! signature for it.
//!
//! Each command is a thin wrapper around a pure `_impl` function that takes
//! a `&Connection` directly — that's what's unit-tested below, without
//! needing a running Tauri app.

use flownote_core::db::Pool;
use flownote_core::store;
use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::State;

/// Shared app state — the SQLite connection pool, managed by Tauri and
/// injected into every command via `State<AppState>`.
pub struct AppState {
    pub pool: Pool,
}

/// `store` speaks camelCase JSON (the IPCAdapter wire shape); these two
/// bridge it to and from this file's typed, specta-exported structs.
fn to_json<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

fn from_json<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub id: String,
    pub notebook_id: String,
    pub title: String,
    pub mode: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub expanded: bool,
}

#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FolderInput {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub expanded: bool,
}

#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PageInput {
    pub id: String,
    pub folder_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
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
    pub content: Value,
}

#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
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
    pub content: Value,
}

#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDto {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
}

/// `AttachmentDto` plus the file's absolute on-disk path (`getAttachment`).
#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentWithPathDto {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub size: i64,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultDto {
    pub page_id: String,
    pub segment_id: String,
    pub snippet: String,
}

// ---- pure `_impl` functions (unit-tested below) ----

fn get_page_impl(conn: &Connection, page_id: &str) -> Result<PageDto, String> {
    let page = store::get_page(conn, page_id).map_err(|e| e.to_string())?;
    from_json(page.ok_or_else(|| format!("no such page: {page_id}"))?)
}

fn save_folder_impl(conn: &Connection, folder: &FolderInput) -> Result<(), String> {
    store::save_folder(conn, &to_json(folder)?)
}

fn list_folders_impl(conn: &Connection) -> Result<Vec<FolderDto>, String> {
    from_json(Value::Array(store::list_folders(conn)?))
}

fn save_page_impl(conn: &Connection, page: &PageInput) -> Result<(), String> {
    store::save_page(conn, &to_json(page)?)
}

fn list_pages_impl(conn: &Connection, folder_id: &str) -> Result<Vec<PageDto>, String> {
    from_json(Value::Array(store::list_pages(conn, folder_id)?))
}

fn delete_page_impl(conn: &Connection, id: &str) -> Result<(), String> {
    store::delete_page(conn, id)
}

fn delete_folder_impl(conn: &Connection, id: &str) -> Result<(), String> {
    store::delete_folder(conn, id)
}

fn save_segment_impl(conn: &Connection, seg: &SegmentInput) -> Result<(), String> {
    store::save_segment(conn, &to_json(seg)?)
}

fn list_segments_impl(conn: &Connection, page_id: &str) -> Result<Vec<SegmentDto>, String> {
    from_json(Value::Array(store::list_segments(conn, page_id)?))
}

fn delete_segment_impl(conn: &Connection, id: &str) -> Result<(), String> {
    store::delete_segment(conn, id)
}

fn save_attachment_impl(
    conn: &Connection,
    id: &str,
    segment_id: &str,
    file_name: &str,
    mime_type: &str,
    data_base64: &str,
) -> Result<AttachmentDto, String> {
    let params = json!({
        "id": id, "segmentId": segment_id, "fileName": file_name,
        "mimeType": mime_type, "dataBase64": data_base64,
    });
    from_json(store::save_attachment(conn, &params)?)
}

fn get_attachment_impl(conn: &Connection, id: &str) -> Result<AttachmentWithPathDto, String> {
    let attachment = store::get_attachment(conn, id)?.ok_or_else(|| format!("no such attachment: {id}"))?;
    from_json(attachment)
}

fn delete_attachment_impl(conn: &Connection, id: &str) -> Result<(), String> {
    store::delete_attachment(conn, id)
}

fn set_page_mode_impl(conn: &Connection, page_id: &str, mode: &str) -> Result<(), String> {
    store::set_page_mode(conn, &json!({ "pageId": page_id, "mode": mode }))
}

fn save_ink_layer_impl(conn: &Connection, page_id: &str, data_url: &str) -> Result<(), String> {
    store::save_ink_layer(conn, &json!({ "pageId": page_id, "dataUrl": data_url }))
}

/// `None` = page has no ink layer saved yet; a missing page is an `Err`.
fn get_ink_layer_impl(conn: &Connection, page_id: &str) -> Result<Option<String>, String> {
    from_json(store::get_ink_layer(conn, page_id)?)
}

fn add_dictionary_word_impl(conn: &Connection, word: &str) -> Result<(), String> {
    store::add_dictionary_word(conn, word)
}

fn list_dictionary_words_impl(conn: &Connection) -> Result<Vec<String>, String> {
    store::list_dictionary_words(conn)
}

fn search_impl(conn: &Connection, query: &str, notebook_id: &str) -> Result<Vec<SearchResultDto>, String> {
    from_json(Value::Array(store::search(conn, &json!({ "query": query, "notebookId": notebook_id }))?))
}

fn install_plugin_impl(conn: &Connection, source: &str) -> Result<Value, String> {
    store::install_plugin(conn, source)
}

fn uninstall_plugin_impl(conn: &Connection, id: &str) -> Result<(), String> {
    store::uninstall_plugin(conn, id)
}

fn set_plugin_enabled_impl(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    store::set_plugin_enabled(conn, &json!({ "id": id, "enabled": enabled }))
}

fn get_installed_plugins_impl(conn: &Connection) -> Result<Vec<Value>, String> {
    store::list_installed_plugins(conn)
}

fn plugin_storage_get_impl(conn: &Connection, plugin_id: &str, key: &str) -> Result<Option<String>, String> {
    from_json(store::plugin_storage_get(conn, &json!({ "pluginId": plugin_id, "key": key }))?)
}

fn plugin_storage_set_impl(conn: &Connection, plugin_id: &str, key: &str, value: &str) -> Result<(), String> {
    store::plugin_storage_set(conn, &json!({ "pluginId": plugin_id, "key": key, "value": value }))
}

fn plugin_storage_delete_impl(conn: &Connection, plugin_id: &str, key: &str) -> Result<(), String> {
    store::plugin_storage_delete(conn, &json!({ "pluginId": plugin_id, "key": key }))
}

fn plugin_storage_list_impl(conn: &Connection, plugin_id: &str) -> Result<Vec<String>, String> {
    from_json(Value::Array(store::plugin_storage_list(conn, &json!({ "pluginId": plugin_id }))?))
}

// ---- #[tauri::command] wrappers ----

/// Every command below runs its `_impl` against one pooled connection.
fn with_conn<T>(state: &State<AppState>, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = state.pool.get().map_err(|e| e.to_string())?;
    f(&conn)
}

#[tauri::command]
#[specta::specta]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
#[specta::specta]
pub fn get_page(state: State<AppState>, page_id: String) -> Result<PageDto, String> {
    with_conn(&state, |c| get_page_impl(c, &page_id))
}

#[tauri::command]
#[specta::specta]
pub fn save_folder(state: State<AppState>, folder: FolderInput) -> Result<(), String> {
    with_conn(&state, |c| save_folder_impl(c, &folder))
}

#[tauri::command]
#[specta::specta]
pub fn list_folders(state: State<AppState>) -> Result<Vec<FolderDto>, String> {
    with_conn(&state, list_folders_impl)
}

#[tauri::command]
#[specta::specta]
pub fn save_page(state: State<AppState>, page: PageInput) -> Result<(), String> {
    with_conn(&state, |c| save_page_impl(c, &page))
}

#[tauri::command]
#[specta::specta]
pub fn list_pages(state: State<AppState>, folder_id: String) -> Result<Vec<PageDto>, String> {
    with_conn(&state, |c| list_pages_impl(c, &folder_id))
}

#[tauri::command]
#[specta::specta]
pub fn delete_page(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| delete_page_impl(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn delete_folder(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| delete_folder_impl(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn list_segments(state: State<AppState>, page_id: String) -> Result<Vec<SegmentDto>, String> {
    with_conn(&state, |c| list_segments_impl(c, &page_id))
}

#[tauri::command]
#[specta::specta]
pub fn save_segment(state: State<AppState>, segment: SegmentInput) -> Result<(), String> {
    with_conn(&state, |c| save_segment_impl(c, &segment))
}

#[tauri::command]
#[specta::specta]
pub fn save_segments_batch(state: State<AppState>, segments: Vec<SegmentInput>) -> Result<(), String> {
    with_conn(&state, |c| segments.iter().try_for_each(|seg| save_segment_impl(c, seg)))
}

#[tauri::command]
#[specta::specta]
pub fn delete_segment(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| delete_segment_impl(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn save_attachment(
    state: State<AppState>,
    id: String,
    segment_id: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
) -> Result<AttachmentDto, String> {
    with_conn(&state, |c| save_attachment_impl(c, &id, &segment_id, &file_name, &mime_type, &data_base64))
}

#[tauri::command]
#[specta::specta]
pub fn get_attachment(state: State<AppState>, id: String) -> Result<AttachmentWithPathDto, String> {
    with_conn(&state, |c| get_attachment_impl(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn delete_attachment(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| delete_attachment_impl(c, &id))
}

/// Opens the attachment's file with the OS default handler — the Tauri
/// counterpart of Electron's `shell.openPath` (apps/electron's trpc router).
/// Not unit-tested: the only logic beyond `get_attachment_impl` is the OS call.
#[tauri::command]
#[specta::specta]
pub fn open_attachment(state: State<AppState>, id: String) -> Result<(), String> {
    let attachment = with_conn(&state, |c| get_attachment_impl(c, &id))?;
    open::that_detached(&attachment.path).map_err(|e| format!("could not open {}: {e}", attachment.path))
}

#[tauri::command]
#[specta::specta]
pub fn set_page_mode(state: State<AppState>, page_id: String, mode: String) -> Result<(), String> {
    with_conn(&state, |c| set_page_mode_impl(c, &page_id, &mode))
}

#[tauri::command]
#[specta::specta]
pub fn save_ink_layer(state: State<AppState>, page_id: String, data_url: String) -> Result<(), String> {
    with_conn(&state, |c| save_ink_layer_impl(c, &page_id, &data_url))
}

#[tauri::command]
#[specta::specta]
pub fn get_ink_layer(state: State<AppState>, page_id: String) -> Result<Option<String>, String> {
    with_conn(&state, |c| get_ink_layer_impl(c, &page_id))
}

#[tauri::command]
#[specta::specta]
pub fn add_dictionary_word(state: State<AppState>, word: String) -> Result<(), String> {
    with_conn(&state, |c| add_dictionary_word_impl(c, &word))
}

#[tauri::command]
#[specta::specta]
pub fn list_dictionary_words(state: State<AppState>) -> Result<Vec<String>, String> {
    with_conn(&state, list_dictionary_words_impl)
}

#[tauri::command]
#[specta::specta]
pub fn search(state: State<AppState>, query: String, notebook_id: String) -> Result<Vec<SearchResultDto>, String> {
    with_conn(&state, |c| search_impl(c, &query, &notebook_id))
}

/// Returns the stored manifest as free-form JSON (`PluginManifest` in
/// packages/ipc-adapter/src/types.ts) — a plugin manifest can carry fields
/// this crate doesn't model, so it isn't forced through a fixed struct.
#[tauri::command]
#[specta::specta]
pub fn install_plugin(state: State<AppState>, source: String) -> Result<Value, String> {
    with_conn(&state, |c| install_plugin_impl(c, &source))
}

#[tauri::command]
#[specta::specta]
pub fn uninstall_plugin(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| uninstall_plugin_impl(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn set_plugin_enabled(state: State<AppState>, id: String, enabled: bool) -> Result<(), String> {
    with_conn(&state, |c| set_plugin_enabled_impl(c, &id, enabled))
}

#[tauri::command]
#[specta::specta]
pub fn get_installed_plugins(state: State<AppState>) -> Result<Vec<Value>, String> {
    with_conn(&state, get_installed_plugins_impl)
}

/// Content-Security-Policy for a plugin's documents (DESIGN.md §9.3
/// `network:fetch`); the frontend puts it on the registration iframe. See
/// `flownote_core::store::plugin_content_security_policy`.
#[tauri::command]
#[specta::specta]
pub fn plugin_content_security_policy(state: State<AppState>, plugin_id: String, origin: String) -> Result<String, String> {
    with_conn(&state, |c| store::plugin_csp_for(c, &plugin_id, &origin))
}

// ---- AI (flownote_core::ai / store) ----

/// A configured provider as listed — never includes the API key itself.
#[derive(Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderDto {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,
    pub is_default: bool,
}

fn list_ai_providers_impl(conn: &Connection) -> Result<Vec<AiProviderDto>, String> {
    from_json(Value::Array(store::list_ai_providers(conn)?))
}

#[tauri::command]
#[specta::specta]
pub fn list_ai_providers(state: State<AppState>) -> Result<Vec<AiProviderDto>, String> {
    with_conn(&state, list_ai_providers_impl)
}

/// `provider` is passed through as JSON so `apiKey` keeps its three meanings
/// (string sets, `null` clears, absent keeps) — see store::save_ai_provider.
#[tauri::command]
#[specta::specta]
pub fn save_ai_provider(state: State<AppState>, provider: Value) -> Result<AiProviderDto, String> {
    with_conn(&state, |c| from_json(store::save_ai_provider(c, &provider)?))
}

#[tauri::command]
#[specta::specta]
pub fn delete_ai_provider(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| store::delete_ai_provider(c, &id))
}

#[tauri::command]
#[specta::specta]
pub fn set_default_ai_provider(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| store::set_default_ai_provider(c, &id))
}

/// One event of an `ai_complete` stream.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiStreamEvent {
    Text { text: String },
    Done,
    Error { message: String },
}

/// Cancel flags of in-flight streams, by stream id.
fn ai_streams() -> &'static Mutex<HashMap<u64, Arc<AtomicBool>>> {
    static STREAMS: OnceLock<Mutex<HashMap<u64, Arc<AtomicBool>>>> = OnceLock::new();
    STREAMS.get_or_init(Mutex::default)
}

/// Starts streaming a completion from `provider_id` (or the default
/// provider) into `on_event`, and returns a stream id for `ai_cancel`. The
/// request runs on its own thread; the API key never leaves the backend.
#[tauri::command]
#[specta::specta]
pub fn ai_complete(
    state: State<AppState>,
    prompt: String,
    context: String,
    provider_id: Option<String>,
    on_event: Channel<AiStreamEvent>,
) -> Result<u32, String> {
    let cfg = with_conn(&state, |c| store::ai_provider_config(c, provider_id.as_deref()))?;
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let cancel = Arc::new(AtomicBool::new(false));
    ai_streams().lock().unwrap().insert(id, cancel.clone());
    std::thread::spawn(move || {
        let result = flownote_core::ai::stream_completion(&cfg, &prompt, &context, &cancel, |text| {
            let _ = on_event.send(AiStreamEvent::Text { text: text.to_string() });
        });
        ai_streams().lock().unwrap().remove(&id);
        let _ = on_event.send(match result {
            Ok(()) => AiStreamEvent::Done,
            Err(message) => AiStreamEvent::Error { message },
        });
    });
    Ok(id as u32)
}

/// Stops an in-flight `ai_complete`; its stream then ends with `Done`.
#[tauri::command]
#[specta::specta]
pub fn ai_cancel(stream_id: u32) {
    if let Some(flag) = ai_streams().lock().unwrap().get(&(stream_id as u64)) {
        flag.store(true, Ordering::Relaxed);
    }
}

// `plugin_id` arrives from the frontend, already resolved from the sending
// iframe's identity by PluginIPCBridge.ts — never from plugin-supplied
// message contents. See the matching comment in flownote-electron's
// protocol.rs `dispatch` for the full argument.

#[tauri::command]
#[specta::specta]
pub fn plugin_storage_get(state: State<AppState>, plugin_id: String, key: String) -> Result<Option<String>, String> {
    with_conn(&state, |c| plugin_storage_get_impl(c, &plugin_id, &key))
}

#[tauri::command]
#[specta::specta]
pub fn plugin_storage_set(state: State<AppState>, plugin_id: String, key: String, value: String) -> Result<(), String> {
    with_conn(&state, |c| plugin_storage_set_impl(c, &plugin_id, &key, &value))
}

#[tauri::command]
#[specta::specta]
pub fn plugin_storage_delete(state: State<AppState>, plugin_id: String, key: String) -> Result<(), String> {
    with_conn(&state, |c| plugin_storage_delete_impl(c, &plugin_id, &key))
}

#[tauri::command]
#[specta::specta]
pub fn plugin_storage_list(state: State<AppState>, plugin_id: String) -> Result<Vec<String>, String> {
    with_conn(&state, |c| plugin_storage_list_impl(c, &plugin_id))
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

    #[test]
    fn list_dictionary_words_returns_empty_for_a_fresh_database() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(list_dictionary_words_impl(&conn).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn add_dictionary_word_then_list_round_trips() {
        let conn = db::open_in_memory().unwrap();
        add_dictionary_word_impl(&conn, "flownotex").unwrap();
        assert_eq!(list_dictionary_words_impl(&conn).unwrap(), vec!["flownotex".to_string()]);
    }

    #[test]
    fn add_dictionary_word_lowercases_before_storing() {
        let conn = db::open_in_memory().unwrap();
        add_dictionary_word_impl(&conn, "Sandeep").unwrap();
        assert_eq!(list_dictionary_words_impl(&conn).unwrap(), vec!["sandeep".to_string()]);
    }

    #[test]
    fn add_dictionary_word_is_idempotent_for_duplicate_word() {
        let conn = db::open_in_memory().unwrap();
        add_dictionary_word_impl(&conn, "flownotex").unwrap();
        add_dictionary_word_impl(&conn, "flownotex").unwrap();
        assert_eq!(list_dictionary_words_impl(&conn).unwrap(), vec!["flownotex".to_string()]);
    }

    // ---- Commands added when this file moved onto `flownote_core::store`
    // (Windows/macOS parity with the Electron sidecar) ----

    fn seg(id: &str, page_id: &str, text: &str) -> SegmentInput {
        SegmentInput {
            id: id.into(),
            page_id: page_id.into(),
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
            z_index: 0,
            border_color: None,
            fill_color: None,
            content: serde_json::json!({
                "type": "doc",
                "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }],
            }),
        }
    }

    /// Same shape as flownote-electron's `conn_with_page_on_disk`: attachments
    /// live next to the database file, so an in-memory connection can't hold
    /// one, and each test gets its own directory so parallel tests (and the
    /// Electron suite) never share an `attachments/` folder.
    fn conn_with_page_on_disk(page_id: &str) -> Connection {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "flownote-tauri-attachment-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
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

    /// Regression for the pre-`store` drift: the old Tauri `save_segment`
    /// never wrote `blocks`/`blocks_fts`, so search found nothing saved here.
    #[test]
    fn saved_segments_are_searchable() {
        let conn = conn_with_page("page-1");
        save_segment_impl(&conn, &seg("seg-1", "page-1", "quarterly planning notes")).unwrap();
        let hits = search_impl(&conn, "quarterly", "nb-1").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].page_id, "page-1");
        assert_eq!(hits[0].segment_id, "seg-1");
        assert!(hits[0].snippet.contains("quarterly"));
    }

    #[test]
    fn search_is_scoped_to_the_notebook_and_ignores_a_blank_query() {
        let conn = conn_with_page("page-1");
        save_segment_impl(&conn, &seg("seg-1", "page-1", "findable")).unwrap();
        assert!(search_impl(&conn, "findable", "other-notebook").unwrap().is_empty());
        assert!(search_impl(&conn, "   ", "nb-1").unwrap().is_empty());
    }

    /// Regression for the pre-`store` drift: the old Tauri `delete_segment`
    /// left the segment's text in `blocks_fts`, so it kept showing up in search.
    #[test]
    fn deleting_a_segment_removes_it_from_search() {
        let conn = conn_with_page("page-1");
        save_segment_impl(&conn, &seg("seg-1", "page-1", "ephemeral")).unwrap();
        delete_segment_impl(&conn, "seg-1").unwrap();
        assert!(search_impl(&conn, "ephemeral", "nb-1").unwrap().is_empty());
    }

    #[test]
    fn delete_page_removes_the_page_its_segments_and_their_search_entries() {
        let conn = db::open_in_memory().unwrap();
        save_folder_impl(&conn, &FolderInput { id: "f1".into(), name: "Work".into(), parent_id: None, icon: None, expanded: false })
            .unwrap();
        save_page_impl(&conn, &PageInput { id: "page-1".into(), folder_id: "f1".into(), title: "Notes".into() }).unwrap();
        save_segment_impl(&conn, &seg("seg-1", "page-1", "doomed")).unwrap();

        delete_page_impl(&conn, "page-1").unwrap();

        assert!(list_pages_impl(&conn, "f1").unwrap().is_empty());
        assert!(list_segments_impl(&conn, "page-1").unwrap().is_empty());
        assert!(search_impl(&conn, "doomed", "nb-1").unwrap().is_empty());
    }

    #[test]
    fn delete_folder_removes_nested_subfolders_and_their_pages() {
        let conn = db::open_in_memory().unwrap();
        save_folder_impl(&conn, &FolderInput { id: "f1".into(), name: "Top".into(), parent_id: None, icon: None, expanded: false })
            .unwrap();
        save_folder_impl(
            &conn,
            &FolderInput { id: "f2".into(), name: "Child".into(), parent_id: Some("f1".into()), icon: None, expanded: false },
        )
        .unwrap();
        save_page_impl(&conn, &PageInput { id: "page-1".into(), folder_id: "f2".into(), title: "Deep".into() }).unwrap();
        save_segment_impl(&conn, &seg("seg-1", "page-1", "nested")).unwrap();

        delete_folder_impl(&conn, "f1").unwrap();

        assert!(list_folders_impl(&conn).unwrap().is_empty());
        assert!(search_impl(&conn, "nested", "nb-1").unwrap().is_empty());
    }

    #[test]
    fn set_page_mode_round_trips_and_rejects_bad_input() {
        let conn = conn_with_page("page-1");
        set_page_mode_impl(&conn, "page-1", "linear").unwrap();
        assert_eq!(get_page_impl(&conn, "page-1").unwrap().mode, "linear");
        assert!(set_page_mode_impl(&conn, "page-1", "sideways").unwrap_err().contains("invalid mode"));
        assert!(set_page_mode_impl(&conn, "missing", "canvas").unwrap_err().contains("no such page"));
    }

    #[test]
    fn save_get_and_delete_attachment_round_trip_including_the_file() {
        let conn = conn_with_page_on_disk("page-1");
        save_segment_impl(&conn, &seg("seg-1", "page-1", "")).unwrap();

        // "hello" in base64
        let saved = save_attachment_impl(&conn, "att-1", "seg-1", "note.txt", "text/plain", "aGVsbG8=").unwrap();
        assert_eq!(
            saved,
            AttachmentDto { id: "att-1".into(), file_name: "note.txt".into(), mime_type: "text/plain".into(), size: 5 }
        );

        let got = get_attachment_impl(&conn, "att-1").unwrap();
        assert_eq!(got.file_name, "note.txt");
        assert_eq!(std::fs::read_to_string(&got.path).unwrap(), "hello");

        delete_attachment_impl(&conn, "att-1").unwrap();
        assert!(get_attachment_impl(&conn, "att-1").unwrap_err().contains("no such attachment"));
        assert!(!std::path::Path::new(&got.path).exists());
    }

    /// Regression for the pre-`store` drift: the old Tauri `delete_segment`
    /// left an attachment's file on disk.
    #[test]
    fn deleting_a_segment_deletes_its_attachment_files() {
        let conn = conn_with_page_on_disk("page-1");
        save_segment_impl(&conn, &seg("seg-1", "page-1", "")).unwrap();
        save_attachment_impl(&conn, "att-1", "seg-1", "note.txt", "text/plain", "aGVsbG8=").unwrap();
        let path = get_attachment_impl(&conn, "att-1").unwrap().path;

        delete_segment_impl(&conn, "seg-1").unwrap();

        assert!(!std::path::Path::new(&path).exists());
    }

    fn spreadsheet_manifest() -> String {
        serde_json::json!({
            "id": "com.sandeep.spreadsheet",
            "name": "Spreadsheet",
            "version": "1.0.0",
            "entry": "dist/index.js",
            "sdkVersion": "1.0.0",
            "permissions": ["storage:read", "storage:write"],
        })
        .to_string()
    }

    #[test]
    fn plugin_install_enable_list_and_uninstall() {
        let conn = db::open_in_memory().unwrap();
        let manifest = install_plugin_impl(&conn, &spreadsheet_manifest()).unwrap();
        assert_eq!(manifest["id"], "com.sandeep.spreadsheet");
        assert_eq!(manifest["enabled"], true);

        set_plugin_enabled_impl(&conn, "com.sandeep.spreadsheet", false).unwrap();
        let installed = get_installed_plugins_impl(&conn).unwrap();
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0]["enabled"], false);

        uninstall_plugin_impl(&conn, "com.sandeep.spreadsheet").unwrap();
        assert!(get_installed_plugins_impl(&conn).unwrap().is_empty());
    }

    #[test]
    fn install_plugin_rejects_an_unknown_permission() {
        let conn = db::open_in_memory().unwrap();
        let bad = spreadsheet_manifest().replace("storage:write", "filesystem:everything");
        assert!(install_plugin_impl(&conn, &bad).unwrap_err().contains("unknown permission"));
    }

    #[test]
    fn plugin_storage_round_trips_and_is_isolated_by_plugin_id() {
        let conn = db::open_in_memory().unwrap();
        install_plugin_impl(&conn, &spreadsheet_manifest()).unwrap();
        install_plugin_impl(&conn, &spreadsheet_manifest().replace("com.sandeep.spreadsheet", "com.other.plugin")).unwrap();

        plugin_storage_set_impl(&conn, "com.sandeep.spreadsheet", "k", "v").unwrap();
        assert_eq!(plugin_storage_get_impl(&conn, "com.sandeep.spreadsheet", "k").unwrap(), Some("v".into()));
        assert_eq!(plugin_storage_get_impl(&conn, "com.other.plugin", "k").unwrap(), None);
        assert_eq!(plugin_storage_list_impl(&conn, "com.sandeep.spreadsheet").unwrap(), vec!["k".to_string()]);
        assert!(plugin_storage_list_impl(&conn, "com.other.plugin").unwrap().is_empty());

        plugin_storage_delete_impl(&conn, "com.sandeep.spreadsheet", "k").unwrap();
        assert_eq!(plugin_storage_get_impl(&conn, "com.sandeep.spreadsheet", "k").unwrap(), None);
    }
}
