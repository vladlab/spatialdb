//! spatialdb desktop — the web app in a native window, plus the TOOLS that need a
//! real machine (TAURI-HANDOFF.md).
//!
//! Three rules shape everything in here:
//!
//! 1. **The window loads the app FROM THE SERVER** (option A). There is no bundled
//!    copy of the Vue app; `setup/` is only a one-field page for the first run,
//!    asking which server to use. Native calls are granted to EXACTLY ONE origin —
//!    the configured server — through a capability added at runtime (`grant`).
//!    Never a wildcard: that origin is the security boundary.
//!
//! 2. **Nothing the server sends is executed.** Every command below is
//!    fixed-purpose and builds its own arguments: the page may ask for
//!    `probe(path)`, never for "ffprobe with these flags". A compromised server can
//!    show a different page; it cannot run a program here.
//!
//! 3. **Paths come from the user, not the page.** A command that READS a file
//!    (`classify`, `probe`, `fingerprint`) accepts only paths the user dropped onto
//!    the window this session, or files inside a dropped folder (`Allowed`).
//!    Otherwise the served JavaScript could hash or probe anything on disk.
//!    `reveal` takes any existing path: it selects a file in the file manager and
//!    runs nothing, and a record's path must be openable long after it was dropped.
//!    "Open with the default app" is deliberately NOT a command yet — `xdg-open`
//!    on the wrong file executes it.
//!
//! What the web app sees: `window.__TAURI__` (withGlobalTauri), so the app's bundle
//! carries no Tauri code and the browser version is byte-identical.

mod tools;

use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, DragDropEvent, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Paths the user has dropped this session: the roots a reading command may touch.
#[derive(Default)]
pub struct Allowed(Mutex<Vec<PathBuf>>);

impl Allowed {
    fn add(&self, paths: &[PathBuf]) {
        let mut v = self.0.lock().unwrap();
        for p in paths {
            // Canonical, so `/mnt/san/../etc/passwd` cannot slip past a prefix check.
            if let Ok(c) = p.canonicalize() { if !v.contains(&c) { v.push(c); } }
        }
    }
    fn check(&self, path: &str) -> Result<PathBuf, String> {
        let c = Path::new(path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
        let v = self.0.lock().unwrap();
        if v.iter().any(|root| c == *root || c.starts_with(root)) { Ok(c) }
        else { Err(format!("{path} was not dropped onto this window, so the desktop app will not read it")) }
    }
}

/* ── which server ─────────────────────────────────────────────────────────── */

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("server"))
}

/// `SPATIALDB_URL` wins (a NixOS module can set it for every workstation); else the
/// file the setup page wrote; else none — and the setup page is shown.
fn configured_server(app: &AppHandle) -> Option<url::Url> {
    let raw = std::env::var("SPATIALDB_URL").ok()
        .or_else(|| config_file(app).ok().and_then(|f| fs::read_to_string(f).ok()))?;
    parse_server(raw.trim()).ok()
}

fn parse_server(raw: &str) -> Result<url::Url, String> {
    let mut u = url::Url::parse(raw).map_err(|e| format!("not a URL: {e}"))?;
    if u.scheme() != "https" && u.scheme() != "http" { return Err("the server address must start with https:// (or http://)".into()); }
    if u.host_str().is_none() { return Err("the server address needs a host name".into()); }
    u.set_path("/"); u.set_query(None); u.set_fragment(None);
    Ok(u)
}

/// Grant the app's commands to ONE origin — the configured server — and nothing
/// else. Built as JSON so it reads like `capabilities/*.json`; see the Tauri ACL docs.
fn grant(app: &AppHandle, server: &url::Url) -> Result<(), String> {
    let origin = server.origin().ascii_serialization();
    let cap = serde_json::json!({
        "identifier": "server",
        "description": "the spatialdb server this window was configured to load",
        "remote": { "urls": [format!("{origin}/*")] },
        "windows": ["main"],
        "permissions": [
            "core:default",
            "core:event:default",
            "core:webview:allow-internal-toggle-devtools",
            "allow-tools-available", "allow-server-url",
            "allow-classify", "allow-probe", "allow-fingerprint", "allow-reveal",
        ]
    });
    app.add_capability(cap.to_string()).map_err(|e| e.to_string())
}

fn open_main(app: &AppHandle, url: WebviewUrl) -> Result<(), String> {
    let allowed = app.state::<Allowed>();
    let w = WebviewWindowBuilder::new(app, "main", url)
        .title("spatialdb")
        .inner_size(1400.0, 900.0)
        .min_inner_size(700.0, 450.0)
        .build().map_err(|e| e.to_string())?;
    let handle = app.clone();
    // The same native event the page receives as `onDragDropEvent`; here it feeds
    // the allowlist, so a path is readable exactly when a person dropped it.
    // A WINDOW event, not a webview event: for a webview that fills its window wry
    // synthesizes `WindowEvent::DragDrop` (tauri-runtime-wry, `WebviewKind::
    // WindowContent`) and `on_webview_event` never fires. The first real drop
    // (Sept 27) found that out: every path was "not dropped onto this window".
    w.on_window_event(move |e| {
        if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = e {
            handle.state::<Allowed>().add(paths);
        }
    });
    drop(allowed);
    Ok(())
}

/* ── commands ─────────────────────────────────────────────────────────────── */

#[derive(serde::Serialize)]
pub struct Available {
    pub version: String,
    pub tools: Vec<&'static str>,
    pub ffprobe: Option<String>,
    pub ffmpeg: Option<String>,
    pub platform: &'static str,
}

/// The handshake: what this build of the desktop app can do, and what the host has.
#[tauri::command]
fn tools_available() -> Available {
    Available {
        version: env!("CARGO_PKG_VERSION").to_string(),
        tools: vec!["file_drop", "reveal"],
        ffprobe: tools::probe::version("ffprobe"),
        ffmpeg: tools::probe::version("ffmpeg"),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
fn server_url(app: AppHandle) -> Option<String> { configured_server(&app).map(|u| u.to_string()) }

/// Called by the setup page only (its own capability): remember the server, grant
/// it, and go there.
#[tauri::command]
fn set_server(app: AppHandle, url: String) -> Result<(), String> {
    let server = parse_server(&url)?;
    fs::write(config_file(&app)?, server.as_str()).map_err(|e| e.to_string())?;
    grant(&app, &server)?;
    let w = app.get_webview_window("main").ok_or("no main window")?;
    w.navigate(server).map_err(|e| e.to_string())
}

/// Stage 1 of a drop: what physically arrived (contract/tools.ts). Milliseconds,
/// even for a 100 GB IMF — it stats and lists, it does not read.
#[tauri::command]
fn classify(allowed: State<Allowed>, paths: Vec<String>) -> Result<Vec<tools::classify::Unit>, String> {
    let roots = paths.iter().map(|p| allowed.check(p)).collect::<Result<Vec<_>, _>>()?;
    Ok(tools::classify::classify(&roots))
}

/// Stage 3: ffprobe facts for one unit. Runs on a blocking thread; the page shows
/// progress and never waits on it.
#[tauri::command]
async fn probe(allowed: State<'_, Allowed>, unit: tools::classify::Unit) -> Result<tools::probe::Probed, String> {
    allowed.check(&unit.path)?;
    tauri::async_runtime::spawn_blocking(move || tools::probe::probe(&unit)).await.map_err(|e| e.to_string())?
}

/// Stage 3, last: the hash. `xxh3` (the default; fast, not cryptographic) or
/// `sha256`. Minutes for a large file — always the final step, only if mapped.
#[tauri::command]
async fn fingerprint(allowed: State<'_, Allowed>, unit: tools::classify::Unit, algo: String) -> Result<String, String> {
    allowed.check(&unit.path)?;
    tauri::async_runtime::spawn_blocking(move || tools::hash::fingerprint(&unit, &algo)).await.map_err(|e| e.to_string())?
}

/// Select the file in the platform's file manager. Executes nothing.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> { tools::reveal::reveal(&path) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Allowed::default())
        .invoke_handler(tauri::generate_handler![tools_available, server_url, set_server, classify, probe, fingerprint, reveal])
        .setup(|app| {
            let handle = app.handle().clone();
            match configured_server(&handle) {
                Some(server) => {
                    grant(&handle, &server)?;
                    open_main(&handle, WebviewUrl::External(server))?;
                }
                None => open_main(&handle, WebviewUrl::App("index.html".into()))?,
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running spatialdb desktop");
}
