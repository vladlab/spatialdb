// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Linux renders through Chromium (CEF), which relaunches THIS binary for its GPU,
// renderer and utility processes, each with a `--type=…` switch. The attribute runs
// `main`'s body in the browser process only and hands every other process to CEF —
// so nothing goes here before `run()`: it would run in every helper too.
//
// (The WebKitGTK-era `WEBKIT_DISABLE_DMABUF_RENDERER=1` default that lived here is
// gone with WebKitGTK on Linux; DESKTOP.md "The CEF branch" keeps its history.)
#[cfg(target_os = "linux")]
#[tauri_runtime_cef::cef_entry_point]
fn main() {
    spatialdb_desktop_lib::run()
}

#[cfg(not(target_os = "linux"))]
fn main() {
    spatialdb_desktop_lib::run()
}
