fn main() {
    // Every command needs an `allow-<name>` permission before a capability can grant
    // it; declaring them here makes tauri-build generate those permissions (into
    // ./permissions, gitignored). A command missing from this list is unreachable
    // from any page — which is the failure we want if one is ever added by accident.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["tools_available", "server_url", "set_server", "classify", "probe", "fingerprint", "reveal"]),
    ))
    .expect("tauri-build failed");
}
