//! Stage 3, usually last: a fingerprint of what was dropped. `<algo>:<hex>` — the
//! algorithm is IN the value (contract/shapes.ts `Hash`), so xxh3, sha256 and md5
//! can coexist in one column. Hashes are PER FILE, always (the owner's call, Oct 15:
//! a hash of several files concatenated is nothing a client can verify): a single
//! file gets its `hash`; a bundle or channel set gets one per member, which the web
//! app writes into the manifest beside each member. A sequence is not hashed — its
//! manifest never lists its frames, and a thousand per-frame hashes have nowhere
//! to live until a sidecar is a thing.
//!
//! Progress: a hash of a 200 GB master on a NAS is minutes, and the page shows a
//! bar for it (the sidebar footer). `Progress` is how: bytes done so far, emitted
//! as `hash-progress` events under a job id the page chose, and a cancel flag the
//! page can raise (`hash_cancel`), checked between chunks.
use super::classify::Unit;
use sha2::Digest;
use std::{fs::File, io::Read, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc}, time::{Duration, Instant}};
use tauri::Emitter;

const CHUNK: usize = 4 << 20;
/// Emit no more often than this, and at least once per this many bytes.
const EVERY: Duration = Duration::from_millis(250);
const EVERY_BYTES: u64 = 64 << 20;

#[derive(serde::Serialize, Clone)]
pub struct ProgressEvent { pub job: u64, pub path: String, pub done: u64, pub total: u64 }

/// One job's progress: where to emit, the cancel flag, and the running totals.
pub struct Progress {
    pub job: u64,
    pub app: tauri::AppHandle,
    pub cancel: Arc<AtomicBool>,
    /// The whole unit's bytes (a set: all members), so a bar can span the unit.
    pub total: u64,
    done: u64,
    last: Instant,
    last_bytes: u64,
}

impl Progress {
    pub fn new(job: u64, app: tauri::AppHandle, cancel: Arc<AtomicBool>, total: u64) -> Self {
        Progress { job, app, cancel, total, done: 0, last: Instant::now() - EVERY, last_bytes: 0 }
    }
    fn advance(&mut self, path: &str, n: u64) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
        self.done += n;
        if self.last.elapsed() >= EVERY || self.done - self.last_bytes >= EVERY_BYTES || self.done >= self.total {
            self.last = Instant::now(); self.last_bytes = self.done;
            let _ = self.app.emit("hash-progress", ProgressEvent { job: self.job, path: path.to_string(), done: self.done, total: self.total });
        }
        Ok(())
    }
}

enum H { X(xxhash_rust::xxh3::Xxh3), S(sha2::Sha256), M(md5::Md5) }

pub const ALGORITHMS: &[&str] = &["xxh3", "sha256", "md5"];

/// What a hash step produced: the unit's own hash (a single file), or one per
/// member (`path` relative to the unit's folder, as the manifest lists them).
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Hashed {
    pub hash: Option<String>,
    pub members: Vec<MemberHash>,
}
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct MemberHash { pub path: String, pub hash: String }

fn hasher(algo: &str) -> Result<H, String> {
    Ok(match algo {
        "xxh3" => H::X(xxhash_rust::xxh3::Xxh3::new()),
        "sha256" => H::S(sha2::Sha256::new()),
        "md5" => H::M(md5::Md5::new()),
        other => return Err(format!("unknown hash algorithm: {other} ({})", ALGORITHMS.join(", "))),
    })
}

/// One file, start to end, in 4 MB chunks; with a `Progress` when the page gave the job an id.
#[cfg(test)]
pub fn hash_file(path: &str, algo: &str) -> Result<String, String> { hash_file_with(path, algo, &mut None) }

pub fn hash_file_with(path: &str, algo: &str, progress: &mut Option<Progress>) -> Result<String, String> {
    let mut h = hasher(algo)?;
    let mut buf = vec![0u8; CHUNK];
    let mut file = File::open(path).map_err(|e| format!("{path}: {e}"))?;
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("{path}: {e}"))?;
        if n == 0 { break; }
        match &mut h { H::X(x) => x.update(&buf[..n]), H::S(s) => s.update(&buf[..n]), H::M(m) => m.update(&buf[..n]) }
        if let Some(p) = progress { p.advance(path, n as u64)?; }
    }
    Ok(match h {
        H::X(x) => format!("xxh3:{:016x}", x.digest()),
        H::S(s) => format!("sha256:{:x}", s.finalize()),
        H::M(m) => format!("md5:{:x}", m.finalize()),
    })
}

#[cfg(test)]
pub fn fingerprint(unit: &Unit, algo: &str) -> Result<Hashed, String> { fingerprint_with(unit, algo, &mut None) }

pub fn fingerprint_with(unit: &Unit, algo: &str, progress: &mut Option<Progress>) -> Result<Hashed, String> {
    hasher(algo)?;   // an unknown algorithm fails before any file is opened
    match unit.kind.as_str() {
        "file" => Ok(Hashed { hash: Some(hash_file_with(&unit.path, algo, progress)?), members: vec![] }),
        "sequence" => Err("a sequence is not hashed: its manifest lists a frame range, never its files".into()),
        _ => {
            let dir = Path::new(&unit.path);
            let mut members = Vec::with_capacity(unit.members.len());
            for m in &unit.members {
                let rel = Path::new(m).strip_prefix(dir).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| m.clone());
                members.push(MemberHash { path: rel, hash: hash_file_with(m, algo, progress)? });
            }
            Ok(Hashed { hash: None, members })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(kind: &str, path: &str, members: Vec<String>) -> Unit {
        Unit { kind: kind.into(), path: path.into(), name: String::new(), extension: String::new(), media: String::new(),
               manifest: serde_json::Value::Null, file_count: 0, total_size: 0, modified: String::new(), probe_target: None, members, bundle_type: None, cpl_title: None }
    }

    #[test]
    fn known_digests_of_an_empty_file_and_of_abc() {
        let dir = std::env::temp_dir().join(format!("spatialdb-hash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let empty = dir.join("empty.bin"); std::fs::write(&empty, b"").unwrap();
        let abc = dir.join("abc.bin"); std::fs::write(&abc, b"abc").unwrap();
        // The textbook vectors.
        assert_eq!(hash_file(empty.to_str().unwrap(), "md5").unwrap(), "md5:d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hash_file(abc.to_str().unwrap(), "md5").unwrap(), "md5:900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hash_file(abc.to_str().unwrap(), "sha256").unwrap(), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(hash_file(abc.to_str().unwrap(), "xxh3").unwrap().starts_with("xxh3:"));
        assert!(hash_file(abc.to_str().unwrap(), "crc32").is_err());
        // A single file: its hash. A set: one per member, paths relative to the folder, no hash of the whole.
        let one = fingerprint(&unit("file", abc.to_str().unwrap(), vec![]), "md5").unwrap();
        assert_eq!(one.hash.as_deref(), Some("md5:900150983cd24fb0d6963f7d28e17f72"));
        let set = fingerprint(&unit("channel_set", dir.to_str().unwrap(), vec![abc.to_string_lossy().into_owned(), empty.to_string_lossy().into_owned()]), "md5").unwrap();
        assert_eq!(set.hash, None);
        assert_eq!(set.members.iter().map(|m| m.path.as_str()).collect::<Vec<_>>(), vec!["abc.bin", "empty.bin"]);
        assert_eq!(set.members[1].hash, "md5:d41d8cd98f00b204e9800998ecf8427e");
        assert!(fingerprint(&unit("sequence", dir.to_str().unwrap(), vec![]), "md5").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
