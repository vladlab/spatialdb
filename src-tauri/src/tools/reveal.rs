//! Select a file in the platform's file manager. Ported from viznotes: on Linux the
//! FileManager1 DBus interface (Nautilus, Dolphin, Thunar, Nemo all implement it,
//! and it SELECTS the file rather than opening it), with `xdg-open` on the parent
//! folder as the fallback. Nothing here opens the file itself.
use std::path::Path;
use std::process::Command;

pub fn reveal(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("{path} does not exist on this machine")); }
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
