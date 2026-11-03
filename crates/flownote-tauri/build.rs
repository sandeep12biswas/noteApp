//! Windows (MSVC) only: embed an application manifest declaring a
//! dependency on Common Controls v6 into every executable this crate links
//! — in practice, its unit-test binary.
//!
//! `tauri` links against `TaskDialogIndirect`, which only exists in
//! comctl32 v6. Without the manifest Windows loads comctl32 v5 and refuses
//! to start the process at all (`STATUS_ENTRYPOINT_NOT_FOUND`, 0xc0000139)
//! — exactly how `cargo test` failed on CI's first Windows Rust run. A real
//! Tauri app gets this manifest from `tauri_build`, but that only attaches
//! it to `[[bin]]` targets, never to test binaries.
//!
//! `apps/tauri/src-tauri/build.rs` embeds this same file, for the same
//! reason, in place of `tauri_build`'s own copy.
use std::env;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());

    // Target, not host: a build script's own `cfg!(windows)` describes the
    // machine running it, which differs when cross-compiling.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
