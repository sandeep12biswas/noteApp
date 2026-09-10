// Tauri desktop shell entry point (Windows/macOS) — DESIGN.md §3.2/§8.1.
// All actual command logic lives in flownote-tauri; this crate just wires
// it into a running Tauri app: opens the SQLite pool, manages it as state,
// attaches the generated invoke handler, and (debug builds only) exports
// TypeScript bindings for packages/ipc-adapter's TauriIPCAdapter.
use flownote_tauri::AppState;
use tauri::Manager;

fn db_path(app: &tauri::App) -> String {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to resolve app data dir");
    std::fs::create_dir_all(&dir).expect("failed to create app data dir");
    dir.join("flownote.sqlite3").to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = flownote_tauri::specta_builder();

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            flownote_tauri::typescript_exporter(),
            "../../../packages/ipc-adapter/src/generated/tauri-bindings.ts",
        )
        .expect("failed to export tauri-specta TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            let pool = flownote_core::db::open(&db_path(app)).expect("failed to open flownote db");
            app.manage(AppState { pool });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
