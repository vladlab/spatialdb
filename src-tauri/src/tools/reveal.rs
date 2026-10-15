//! Select a file in the platform's file manager. Ported from viznotes: on Linux the
//! FileManager1 DBus interface (Nautilus, Dolphin, Thunar, Nemo all implement it,
//! and it SELECTS the file rather than opening it), with `xdg-open` on the parent
//! folder as the fallback. Nothing here opens the file itself.
//!
//! Three outcomes, which the canvas colours (green / orange / red): the FILE is there
//! and selected (`"file"`); the file is gone but its FOLDER is there and opened
//! (`"folder"`); neither exists (`Err`).
use std::path::Path;
use std::process::Command;

pub fn reveal(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if p.exists() { return show(p).map(|_| "file".to_string()); }
    let parent = p.parent().filter(|d| d.exists()).ok_or_else(|| format!("{path}: neither the file nor its folder exists on this machine"))?;
    open_folder(parent).map(|_| "folder".to_string())
}

/// The folder itself, opened — for a file that is not there any more.
fn open_folder(dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(dir).spawn().map_err(|e| format!("xdg-open: {e}"))?; Ok(()) }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(dir).spawn().map_err(|e| e.to_string())?; Ok(()) }
    #[cfg(target_os = "windows")]
    { Command::new("explorer").arg(dir).spawn().map_err(|e| e.to_string())?; Ok(()) }
}

fn show(p: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let uri = format!("file://{}", p.canonicalize().map_err(|e| e.to_string())?.display());
        let ok = Command::new("gdbus")
            .args(["call", "--session", "--dest", "org.freedesktop.FileManager1",
                   "--object-path", "/org/freedesktop/FileManager1",
                   "--method", "org.freedesktop.FileManager1.ShowItems"])
            .arg(format!("['{uri}']")).arg("")
            .output().map(|o| o.status.success()).unwrap_or(false);
        if ok { return Ok(()); }
        let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        Command::new("xdg-open").arg(dir).spawn().map_err(|e| format!("xdg-open: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(p).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(format!("/select,{}", p.display())).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}
