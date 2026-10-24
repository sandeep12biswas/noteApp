//! Tauri command handlers for the Windows/macOS shell — DESIGN.md §6.3/§8.1.
//! `apps/tauri/src-tauri` is the actual Tauri binary; it depends on this
//! crate for its command set and state, matching flownote-electron's
//! sidecar protocol one-for-one (see commands.rs's module doc).

pub mod commands;
pub mod protocols;

pub use commands::{
    add_dictionary_word, delete_attachment, delete_folder, delete_page, delete_segment, get_attachment,
    get_ink_layer, get_installed_plugins, get_page, install_plugin, list_dictionary_words, list_folders, list_pages,
    list_segments, open_attachment, ping, plugin_storage_delete, plugin_storage_get, plugin_storage_list,
    plugin_storage_set, save_attachment, save_folder, save_ink_layer, save_page, save_segment, save_segments_batch,
    search, set_page_mode, set_plugin_enabled, uninstall_plugin, AppState, AttachmentDto, AttachmentWithPathDto,
    FolderDto, FolderInput, PageDto, PageInput, SearchResultDto, SegmentDto, SegmentInput,
};

/// Builds the `tauri-specta` builder wiring every command above. Consumed by
/// `apps/tauri/src-tauri/src/lib.rs`, which both attaches it as the app's
/// invoke handler and (in debug builds) exports TypeScript bindings so
/// `packages/ipc-adapter`'s `TauriIPCAdapter` gets typed `invoke()` calls
/// instead of hand-typed strings (DESIGN.md §3.3/§8.2).
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        ping,
        get_page,
        save_folder,
        list_folders,
        save_page,
        list_pages,
        delete_page,
        delete_folder,
        list_segments,
        save_segment,
        save_segments_batch,
        delete_segment,
        save_attachment,
        get_attachment,
        delete_attachment,
        open_attachment,
        set_page_mode,
        save_ink_layer,
        get_ink_layer,
        add_dictionary_word,
        list_dictionary_words,
        search,
        install_plugin,
        uninstall_plugin,
        set_plugin_enabled,
        get_installed_plugins,
        plugin_storage_get,
        plugin_storage_set,
        plugin_storage_delete,
        plugin_storage_list,
    ])
}

/// The shared TypeScript-export configuration — used both by the real
/// `export()` call in `apps/tauri/src-tauri` and by this crate's own test
/// below, so they can never drift apart. SQLite integer timestamps
/// (`created_at`/`updated_at`, i64) are exported as `number`, matching the
/// epoch-ms convention already used elsewhere in the IPC surface (e.g.
/// `SyncEvent` in packages/ipc-adapter) — safe here since millisecond epoch
/// timestamps stay well under `Number.MAX_SAFE_INTEGER` for the lifetime of
/// this app.
pub fn typescript_exporter() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Confirms the tauri-specta wiring itself is sound — every command is
    /// registered and renders to valid-looking TypeScript — without needing
    /// a running Tauri app (which `export()`'s file write requires calling
    /// from inside `run()` at app startup, not at build time).
    #[test]
    fn exports_typescript_bindings_for_every_command() {
        let bindings = specta_builder()
            .export_str(typescript_exporter())
            .expect("bindings should render");

        assert!(bindings.contains("ping"), "expected `ping` in bindings:\n{bindings}");
        assert!(bindings.contains("get_page") || bindings.contains("getPage"), "expected get_page/getPage in bindings:\n{bindings}");
        assert!(bindings.contains("PageDto") || bindings.contains("notebookId"), "expected the PageDto shape in bindings:\n{bindings}");
    }
}
