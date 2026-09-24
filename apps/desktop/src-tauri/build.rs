fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "apply_chrome",
            "show_sticky_alert",
            "close_sticky_alert",
            "open_in_main",
        ]),
    ))
    .expect("failed to run tauri-build");
}
