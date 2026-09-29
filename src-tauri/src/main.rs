// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer fails on some GPU/driver combinations ("Failed to
    // create GBM buffer … Invalid argument", a blank window) — seen on Fedora with
    // the owner's GPU, Sept 29; the variable fixed it. Defaulting it off costs a
    // little compositing performance and works everywhere. Set it to 0 in the
    // environment to opt back in on a machine where DMA-BUF works. Must be set
    // before the webview is created, hence here and not in setup().
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    spatialdb_desktop_lib::run()
}
