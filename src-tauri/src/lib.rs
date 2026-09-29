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
    /// A UNIT is readable when its own path is, or when every member is: six
    /// dropped mono WAVs become one channel set whose `path` is their FOLDER, which
    /// nobody dropped; the members were. (The first 5.1 mix dropped, Sept 29, had
    /// its record created and its ffprobe step refused for exactly this.)
    fn check_unit(&self, unit: &tools::classify::Unit) -> Result<(), String> {
        if self.check(&unit.path).is_ok() { return Ok(()); }
        if !unit.members.is_empty() && unit.members.iter().all(|m| self.check(m).is_ok()) { return Ok(()); }
        Err(format!("{} was not dropped onto this window, so the desktop app will not read it", unit.path))
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
            "allow-classify", "allow-analyze", "allow-reveal",
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
    /// Every analyzer this build knows (contract/tools.ts ANALYZERS), with the version
    /// of the program it runs — `None` when that program is not on this machine.
    /// Built-in analyzers report the app's own version.
    pub analyzers: std::collections::BTreeMap<&'static str, Option<String>>,
    pub platform: &'static str,
}

/// The handshake: what this build of the desktop app can do, and what the host has.
#[tauri::command]
fn tools_available() -> Available {
    let own = Some(env!("CARGO_PKG_VERSION").to_string());
    let mut analyzers = std::collections::BTreeMap::new();
    for a in ["filesystem", "sequence", "imf", "hash-xxh3", "hash-sha256"] { analyzers.insert(a, own.clone()); }
    analyzers.insert("ffprobe", tools::probe::version("ffprobe"));
    Available {
        version: env!("CARGO_PKG_VERSION").to_string(),
        tools: vec!["file_drop", "reveal"],
        analyzers,
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
    let units = tools::classify::classify(&roots);
    // What a drop IMPLIES is readable too: the other frames of a sequence when one
    // frame was dropped (nobody catalogues a frame). Members only — never a folder,
    // which would open its unrelated files.
    for u in &units { if u.kind == "sequence" { allowed.add(&u.members.iter().map(PathBuf::from).collect::<Vec<_>>()); } }
    Ok(units)
}

/// Stage 3: run ONE analyzer of the table's recipe on one unit. The analyzer is
/// named by id from the closed set in contract/tools.ts; the page picks which and
/// in what order, the arguments are built here. Runs on a blocking thread — a hash
/// of a large file takes minutes — and the page never waits on it.
#[tauri::command]
async fn analyze(allowed: State<'_, Allowed>, unit: tools::classify::Unit, analyzer: String) -> Result<tools::probe::Probed, String> {
    allowed.check_unit(&unit)?;
    tauri::async_runtime::spawn_blocking(move || match analyzer.as_str() {
        "ffprobe" => tools::probe::probe(&unit),
        "hash-xxh3" | "hash-sha256" => {
            let hash = tools::hash::fingerprint(&unit, &analyzer["hash-".len()..])?;
            let mut outputs = serde_json::Map::new();
            outputs.insert("hash".into(), serde_json::Value::String(hash));
            Ok(tools::probe::Probed { outputs })
        }
        other => Err(format!("this desktop build has no analyzer called \"{other}\"")),
    }).await.map_err(|e| e.to_string())?
}

/// Select the file in the platform's file manager. Executes nothing.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> { tools::reveal::reveal(&path) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Allowed::default())
        .invoke_handler(tauri::generate_handler![tools_available, server_url, set_server, classify, analyze, reveal])
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

#[cfg(test)]
mod allowlist {
    use super::*;
    /// Six dropped mono WAVs → ONE channel-set unit whose path is their folder.
    /// The folder was never dropped; the members were. Reproduces the 5.1 mix
    /// whose ffprobe step was refused (Sept 29).
    #[test] fn a_channel_set_is_readable_when_its_members_were_dropped() {
        let dir = std::env::temp_dir().join(format!("spdb-allow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut dropped = Vec::new();
        for ch in ["L", "R", "C", "lfe", "Ls", "Rs"] {
            let p = dir.join(format!("mix_{ch}.wav"));
            std::fs::write(&p, b"RIFF").unwrap();
            dropped.push(p);
        }
        std::fs::write(dir.join("unrelated.txt"), b"x").unwrap();   // in the same folder, NOT dropped
        let allowed = Allowed::default();
        allowed.add(&dropped);
        let units = tools::classify::classify(&dropped);
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].kind, "channel_set");
        assert_eq!(units[0].path, dir.to_string_lossy());
        assert!(allowed.check(&units[0].path).is_err(), "the folder itself was not dropped");
        assert!(allowed.check_unit(&units[0]).is_ok(), "…but every member was, so the unit is readable");
        assert!(allowed.check(&dir.join("unrelated.txt").to_string_lossy()).is_err(), "the folder's other files stay off limits");
        std::fs::remove_dir_all(&dir).unwrap();
    }
    #[test] fn a_dropped_frame_implies_its_sequence() {
        let dir = std::env::temp_dir().join(format!("spdb-seq-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for n in 1001..=1004 { std::fs::write(dir.join(format!("plate.{n}.exr")), b"v/1").unwrap(); }
        let one = dir.join("plate.1002.exr");
        let allowed = Allowed::default();
        allowed.add(&[one.clone()]);
        let units = tools::classify::classify(&[one]);
        assert_eq!(units[0].kind, "sequence");
        assert!(allowed.check_unit(&units[0]).is_err(), "before classify's grant: three of four frames were never dropped");
        // What the `classify` command does after classifying:
        allowed.add(&units[0].members.iter().map(PathBuf::from).collect::<Vec<_>>());
        assert!(allowed.check_unit(&units[0]).is_ok());
        assert!(allowed.check(&dir.to_string_lossy()).is_err(), "the folder is still not a root");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
