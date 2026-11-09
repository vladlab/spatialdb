//! Which webview ENGINE draws the window, and how it is set up (CEF-BRIEF.md).
//!
//! Linux: Chromium, through Tauri's CEF runtime. WebKitGTK on the owner's NVIDIA /
//! Xorg workstations only worked with its GPU path turned off and was much slower
//! than the same app in a browser; Chromium on that hardware is a well-trodden path.
//! Everywhere else: the system webview (wry), as before.
//!
//! Nothing here comes from the page or the server (lib.rs rule 2). The one outside
//! input is `SPATIALDB_CEF_ARGS`, the USER's environment, for trying Chromium
//! switches (GPU flags, mostly) without a rebuild.

/// What the handshake reports (`tools_available().engine`), so "which build is this"
/// is answerable from the setup page and the devtools console.
#[cfg(target_os = "linux")]
pub const NAME: &str = "chromium (cef)";
#[cfg(not(target_os = "linux"))]
pub const NAME: &str = "system webview";

/// The runtime, configured. Everything Chromium does by default that a window
/// showing ONE server on the LAN has no use for is turned off here, line by line.
#[cfg(target_os = "linux")]
pub fn runtime() -> tauri_runtime_cef::Cef {
    use tauri_runtime_cef::{Cef, CertificateErrorPolicy, DevToolsPolicy, RemoteDebugging, SandboxPolicy};
    let mut cef = Cef::default()
        // Chromium's profile (cookies, localStorage, caches) under the app's own cache
        // dir — a different one for a debug build: Chromium locks its profile against
        // a second process, so `npm run desktop:dev` next to an installed copy would
        // otherwise refuse to start, and dev/release encrypt cookies differently.
        .root_cache_path(cache_dir())
        // Stay logged in across a restart, as in a browser with "remember me".
        .persist_session_cookies(true)
        // The sandbox wherever it can be kept; the runtime logs (stderr, see lib.rs
        // `log_to_stderr`) when it cannot. Never `Disabled` (CEF-BRIEF.md standing rules).
        .sandbox(SandboxPolicy::Auto)
        // A certificate that does not validate is a misconfiguration or an
        // interception: this window grants native commands to exactly one origin, so
        // no "proceed anyway" interstitial. The Caddy internal CA must be trusted by
        // Chromium instead — DESKTOP.md "The CEF branch", TLS.
        .certificate_errors(CertificateErrorPolicy::Cancel)
        // DevTools as in the WebKit build: available, gated per window by the server
        // capability's `core:webview:allow-internal-toggle-devtools`. No remote
        // debugging port — that would expose the page to every process on the machine.
        .devtools(DevToolsPolicy::Auto)
        .remote_debugging(RemoteDebugging::Disabled)
        // Nothing phones Google: no component updater, Safe Browsing list or spelling
        // dictionaries. The window only ever loads the house server.
        .component_updates(false)
        .safe_browsing(false)
        .spell_checking(false)
        // Identify the client in the server's logs without hiding that it is Chrome.
        .user_agent_product(format!("spatialdb-desktop/{}", env!("CARGO_PKG_VERSION")));
    for (key, value) in extra_args() {
        cef = cef.command_line_arg(key, value);
    }
    cef
}

#[cfg(not(target_os = "linux"))]
pub fn runtime() -> tauri_runtime_wry::Wry {
    tauri_runtime_wry::Wry::default()
}

/// `$XDG_CACHE_HOME/org.spatialdb.desktop/cef` (or `cef-dev` for a debug build) —
/// the runtime's own default is the first of those for both, which mixes the two.
#[cfg(target_os = "linux")]
fn cache_dir() -> std::path::PathBuf {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("org.spatialdb.desktop").join(if cfg!(debug_assertions) { "cef-dev" } else { "cef" })
}

/// Chromium switches from `SPATIALDB_CEF_ARGS`, e.g.
/// `SPATIALDB_CEF_ARGS="--ignore-gpu-blocklist --use-angle=vulkan"`. Applied to the
/// browser process only (Chromium passes what its children need along). Printed at
/// startup so a run says what it was given.
#[cfg(target_os = "linux")]
fn extra_args() -> Vec<(String, Option<String>)> {
    let Ok(raw) = std::env::var("SPATIALDB_CEF_ARGS") else { return Vec::new() };
    let args = parse_args(&raw);
    if !args.is_empty() {
        let shown: Vec<String> = args.iter().map(|(k, v)| match v { Some(v) => format!("--{k}={v}"), None => format!("--{k}") }).collect();
        eprintln!("spatialdb: Chromium switches from SPATIALDB_CEF_ARGS: {}", shown.join(" "));
    }
    args
}

/// `--a --b=c d` → `[("a", None), ("b", Some("c")), ("d", None)]`. Leading dashes are
/// optional; the value is everything after the FIRST `=` (an `=` inside it stays).
/// Whitespace separates switches; there is no quoting — no Chromium switch worth
/// setting here needs a space.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_args(raw: &str) -> Vec<(String, Option<String>)> {
    raw.split_whitespace()
        .map(|a| a.trim_start_matches('-'))
        .filter(|a| !a.is_empty())
        .map(|a| match a.split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (a.to_string(), None),
        })
        .filter(|(k, _)| !k.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_args;
    #[test]
    fn switches_parse_with_and_without_values() {
        assert_eq!(
            parse_args("  --ignore-gpu-blocklist --use-angle=vulkan enable-features=Vulkan,X=1 -- --=x "),
            vec![
                ("ignore-gpu-blocklist".into(), None),
                ("use-angle".into(), Some("vulkan".into())),
                ("enable-features".into(), Some("Vulkan,X=1".into())),
            ]
        );
        assert!(parse_args("").is_empty());
    }
}
