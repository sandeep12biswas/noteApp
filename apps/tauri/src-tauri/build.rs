use std::env;
use std::path::PathBuf;

fn main() {
    // `tauri_build`'s default Windows manifest is only attached to the app
    // binary, so this crate's test binary (built by `cargo test --workspace`
    // even with no tests in it) crashed at startup on Windows with
    // STATUS_ENTRYPOINT_NOT_FOUND. Skip tauri_build's copy and embed the
    // same Common Controls v6 manifest into *every* executable this crate
    // links instead — see crates/flownote-tauri/build.rs for the full story.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("tauri_build failed");

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../../crates/flownote-tauri/windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
