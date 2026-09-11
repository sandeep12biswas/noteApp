//! Regenerates `packages/ipc-adapter/src/generated/tauri-bindings.ts` without
//! launching a real Tauri app (`apps/tauri/src-tauri`'s own `export()` call
//! only runs from inside `run()` at app startup, which needs a display —
//! see EXECUTION_PLAN.md Phase 1's "no working display server in this
//! environment" note). Run with:
//!
//!   cargo run -p flownote-tauri --example export_bindings
//!
//! (from the repo root — the output path below is relative to `cargo run`'s
//! working directory, not this crate's) after adding/changing any
//! `#[tauri::command]` in commands.rs, same as a real debug-build app
//! launch would do automatically.
fn main() {
    flownote_tauri::specta_builder()
        .export(
            flownote_tauri::typescript_exporter(),
            "packages/ipc-adapter/src/generated/tauri-bindings.ts",
        )
        .expect("failed to export tauri-specta TypeScript bindings");
    println!("wrote packages/ipc-adapter/src/generated/tauri-bindings.ts");
}
