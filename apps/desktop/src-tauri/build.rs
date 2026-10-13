fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "apply_chrome",
            "show_sticky_alert",
            "close_sticky_alert",
            "open_in_main",
            "open_external",
            "hide_main",
            "set_badge",
            "read_today_calendar",
        ]),
    ))
    .expect("failed to run tauri-build");

    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("apple-darwin") {
        cc::Build::new()
            .file("src/calendar.m")
            .flag("-fobjc-arc")
            .compile("vital_calendar");
        println!("cargo:rustc-link-lib=framework=EventKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rerun-if-changed=src/calendar.m");
    }
}
