//! Stage 1 of a drop: CLASSIFY what physically arrived, before anything is written.
//!
//! A dropped path becomes one or more UNITS, each of a manifest kind the database
//! knows (contract/shapes.ts):
//!
//!   file         one file
//!   bundle       a folder that is an IMF or DCP package (ASSETMAP / CPL present):
//!                one unit, its members listed relative to the folder
//!   sequence     image frames sharing a stem, padding and extension: ONE unit per
//!                sequence, as pattern + range + gaps — never the file list. Dropping
//!                a single frame means its whole sequence (nobody catalogues a frame)
//!   channel_set  same-stem mono audio files with channel suffixes (`mix_L.wav`,
//!                `mix_R.wav`, `mix_Lfe.wav`): one unit — only when at least two
//!                arrived together; a lone WAV is a file
//!
//! A plain folder that is none of these is looked INTO (depth ≤ 3): its frames
//! become sequences, its other files units of their own. The page caps how many it
//! will create and asks first (contract/tools.ts).
//!
//! This stats and lists; it reads nothing but a few hundred bytes of an ASSETMAP to
//! tell IMF from DCP, and a CPL for its title. Milliseconds for a 100 GB package.

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, time::UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Unit {
    pub kind: String,          // file | bundle | sequence | channel_set
    pub path: String,          // absolute; a bundle or sequence: its folder
    pub name: String,
    pub extension: String,     // "mov", "exr" (a sequence: its frames'), "imf"/"dcp" (a bundle)
    pub media: String,         // video | audio | image | document | other
    pub manifest: serde_json::Value,
    pub file_count: u64,
    pub total_size: u64,
    pub modified: String,      // YYYY-MM-DD (UTC) of the newest member
    /// The file to ffprobe: the file itself, a sequence's first frame, a channel
    /// set's first member; none for a bundle.
    pub probe_target: Option<String>,
    /// Absolute member paths in manifest order (for hashing); empty for a file.
    pub members: Vec<String>,
    pub bundle_type: Option<String>,   // imf | dcp
    pub cpl_title: Option<String>,
}

const VIDEO: &[&str] = &["mov", "mp4", "m4v", "mxf", "mkv", "avi", "mts", "m2ts", "webm", "r3d", "braw", "ari", "prores", "dnxhd", "ts", "vob", "mpg", "mpeg", "wmv"];
const AUDIO: &[&str] = &["wav", "bwf", "aif", "aiff", "flac", "mp3", "aac", "ac3", "eac3", "m4a", "ogg", "opus", "wma", "caf"];
const IMAGE: &[&str] = &["exr", "dpx", "tif", "tiff", "png", "jpg", "jpeg", "cin", "j2c", "jp2", "psd", "heic", "bmp", "gif", "webp", "dng", "cr2", "arw"];
const DOCUMENT: &[&str] = &["pdf", "txt", "md", "xml", "csv", "edl", "aaf", "fcpxml", "otio", "doc", "docx", "xls", "xlsx", "json", "cube", "ale", "srt", "scc", "stl", "itt", "ttml", "dfxp"];
const FRAME_EXT: &[&str] = &["exr", "dpx", "tif", "tiff", "png", "jpg", "jpeg", "cin", "j2c", "jp2", "ari", "dng", "cr2", "arw"];
const CHANNELS: &[&str] = &["L", "R", "C", "LFE", "Lfe", "lfe", "Ls", "Rs", "Lss", "Rss", "Lsr", "Rsr", "Lrs", "Rrs", "Lb", "Rb", "Lc", "Rc", "Lw", "Rw", "Lt", "Rt", "Lh", "Rh", "M", "S", "Cs", "Ltf", "Rtf", "Ltr", "Rtr", "Ltm", "Rtm", "Tc"];

const MAX_UNITS: usize = 500;
const MAX_DEPTH: usize = 3;
const MAX_MEMBERS: usize = 2000;   // shapes.ts MANIFEST_MAX_MEMBERS

pub fn media_of(ext: &str) -> &'static str {
    let e = ext.to_ascii_lowercase();
    if VIDEO.contains(&e.as_str()) { "video" } else if AUDIO.contains(&e.as_str()) { "audio" }
    else if IMAGE.contains(&e.as_str()) { "image" } else if DOCUMENT.contains(&e.as_str()) { "document" } else { "other" }
}

fn ext_of(p: &Path) -> String { p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase() }
fn name_of(p: &Path) -> String { p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string() }

/// YYYY-MM-DD (UTC) from a file's mtime — a `date` value (values.ts). Civil-from-days,
/// so no date crate. The time of day is lost on purpose: there is no moment-in-time
/// field type, and the file itself keeps it.
fn day_of(meta: &fs::Metadata) -> String {
    let secs = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!("{:04}-{:02}-{:02}", if m <= 2 { y + 1 } else { y }, m, d)
}

/// The dropped roots, in order, expanded into units. Duplicates (two frames of one
/// sequence dropped together) collapse into one.
pub fn classify(roots: &[PathBuf]) -> Vec<Unit> {
    let mut out: Vec<Unit> = Vec::new();
    let mut seen_seq: Vec<(PathBuf, String)> = Vec::new();   // (dir, pattern) already emitted
    let mut loose_audio: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();   // dir → dropped audio files

    for root in roots {
        if out.len() >= MAX_UNITS { break; }
        let Ok(meta) = fs::metadata(root) else { continue };
        if meta.is_dir() {
            if let Some(b) = bundle(root) { out.push(b); continue; }
            walk(root, 0, &mut out, &mut seen_seq);
        } else if let Some(frame) = frame_parts(root) {
            let dir = root.parent().map(Path::to_path_buf).unwrap_or_default();
            if !seen_seq.iter().any(|(d, p)| *d == dir && *p == frame.pattern) {
                if let Some(s) = sequence(&dir, &frame) { seen_seq.push((dir, frame.pattern.clone())); out.push(s); }
            }
        } else if media_of(&ext_of(root)) == "audio" && channel_of(root).is_some() {
            loose_audio.entry(root.parent().map(Path::to_path_buf).unwrap_or_default()).or_default().push(root.clone());
        } else {
            out.push(file(root, &meta));
        }
    }
    // Dropped-together mono files with channel suffixes: a channel set per stem
    // when there are at least two; the rest are plain files.
    for (dir, files) in loose_audio {
        let mut by_stem: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
        for f in files { let (stem, _) = channel_of(&f).unwrap(); by_stem.entry(stem).or_default().push(f); }
        for (stem, mut members) in by_stem {
            members.sort();
            if members.len() >= 2 { if let Some(u) = channel_set(&dir, &stem, &members) { out.push(u); } }
            else if let Ok(meta) = fs::metadata(&members[0]) { out.push(file(&members[0], &meta)); }
        }
    }
    out.truncate(MAX_UNITS);
    out
}

fn file(p: &Path, meta: &fs::Metadata) -> Unit {
    let ext = ext_of(p);
    Unit {
        kind: "file".into(), path: p.to_string_lossy().into_owned(), name: name_of(p), media: media_of(&ext).into(),
        manifest: serde_json::json!({ "kind": "file", "size": meta.len() }),
        file_count: 1, total_size: meta.len(), modified: day_of(meta),
        probe_target: Some(p.to_string_lossy().into_owned()), members: vec![], bundle_type: None, cpl_title: None, extension: ext,
    }
}

/// A plain folder: frames become sequences, other files units, subfolders recurse.
fn walk(dir: &Path, depth: usize, out: &mut Vec<Unit>, seen_seq: &mut Vec<(PathBuf, String)>) {
    if depth > MAX_DEPTH { return; }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| !name_of(p).starts_with('.')).collect();
    entries.sort();
    let mut audio: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for p in entries {
        if out.len() >= MAX_UNITS { return; }
        let Ok(meta) = fs::metadata(&p) else { continue };
        if meta.is_dir() {
            if let Some(b) = bundle(&p) { out.push(b); } else { walk(&p, depth + 1, out, seen_seq); }
        } else if let Some(frame) = frame_parts(&p) {
            if !seen_seq.iter().any(|(d, pat)| d == dir && *pat == frame.pattern) {
                if let Some(s) = sequence(dir, &frame) { seen_seq.push((dir.to_path_buf(), frame.pattern.clone())); out.push(s); }
            }
        } else if media_of(&ext_of(&p)) == "audio" && channel_of(&p).is_some() {
            audio.entry(channel_of(&p).unwrap().0).or_default().push(p);
        } else {
            out.push(file(&p, &meta));
        }
    }
    for (stem, mut members) in audio {
        members.sort();
        if members.len() >= 2 { if let Some(u) = channel_set(dir, &stem, &members) { out.push(u); } }
        else if let Ok(meta) = fs::metadata(&members[0]) { out.push(file(&members[0], &meta)); }
    }
}

/* ── sequences ────────────────────────────────────────────────────────────── */

struct Frame { prefix: String, digits: usize, ext: String, pattern: String }

/// `shot_010.0001.exr`, `plate_0001.dpx`, `frame0001.png` → prefix, padding, ext.
fn frame_parts(p: &Path) -> Option<Frame> {
    let ext = ext_of(p);
    if !FRAME_EXT.contains(&ext.as_str()) { return None; }
    let name = name_of(p);
    let re = Regex::new(r"^(.*?)(\d{3,})\.([A-Za-z0-9]+)$").unwrap();
    let c = re.captures(&name)?;
    let prefix = c[1].to_string();
    let digits = c[2].len();
    Some(Frame { pattern: format!("{prefix}%0{digits}d.{}", &c[3]), prefix, digits, ext })
}

fn sequence(dir: &Path, f: &Frame) -> Option<Unit> {
    let Ok(rd) = fs::read_dir(dir) else { return None };
    let mut frames: Vec<(i64, PathBuf, u64, fs::Metadata)> = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        let name = name_of(&p);
        if ext_of(&p) != f.ext || !name.starts_with(&f.prefix) { continue; }
        let rest = &name[f.prefix.len()..];
        let Some(dot) = rest.rfind('.') else { continue };
        let num = &rest[..dot];
        if num.len() != f.digits || !num.chars().all(|c| c.is_ascii_digit()) { continue; }
        let Ok(meta) = fs::metadata(&p) else { continue };
        frames.push((num.parse().ok()?, p, meta.len(), meta));
    }
    if frames.is_empty() { return None; }
    frames.sort_by_key(|x| x.0);
    let first = frames[0].0; let last = frames[frames.len() - 1].0;
    let mut gaps: Vec<[i64; 2]> = Vec::new();
    for w in frames.windows(2) { if w[1].0 > w[0].0 + 1 { gaps.push([w[0].0 + 1, w[1].0 - 1]); } }
    let total: u64 = frames.iter().map(|x| x.2).sum();
    let newest = frames.iter().map(|x| day_of(&x.3)).max().unwrap_or_default();
    let stem = f.prefix.trim_end_matches(['.', '_', '-']);
    Some(Unit {
        kind: "sequence".into(), path: dir.to_string_lossy().into_owned(),
        name: if stem.is_empty() { name_of(dir) } else { stem.to_string() },
        extension: f.ext.clone(), media: "image".into(),
        manifest: serde_json::json!({ "kind": "sequence", "pattern": f.pattern, "first": first, "last": last, "count": frames.len(), "gaps": gaps }),
        file_count: frames.len() as u64, total_size: total, modified: newest,
        probe_target: Some(frames[0].1.to_string_lossy().into_owned()),
        members: frames.iter().map(|x| x.1.to_string_lossy().into_owned()).collect(),
        bundle_type: None, cpl_title: None,
    })
}

/* ── channel sets ─────────────────────────────────────────────────────────── */

/// `mix_L.wav` → ("mix", "L"); `Reel1.Lfe.wav` → ("Reel1", "Lfe"). None if no known suffix.
fn channel_of(p: &Path) -> Option<(String, String)> {
    let stem = p.file_stem()?.to_str()?;
    let i = stem.rfind(['_', '.', '-', ' '])?;
    let (base, ch) = (&stem[..i], &stem[i + 1..]);
    if base.is_empty() || !CHANNELS.contains(&ch) { return None; }
    Some((base.to_string(), ch.to_string()))
}

fn channel_set(dir: &Path, stem: &str, members: &[PathBuf]) -> Option<Unit> {
    let mut total = 0; let mut newest = String::new(); let mut list = Vec::new();
    for m in members {
        let meta = fs::metadata(m).ok()?;
        total += meta.len(); newest = newest.max(day_of(&meta));
        let rel = m.strip_prefix(dir).ok()?.to_string_lossy().into_owned();
        list.push(serde_json::json!({ "path": rel, "channel": channel_of(m)?.1 }));
    }
    Some(Unit {
        kind: "channel_set".into(), path: dir.to_string_lossy().into_owned(), name: stem.to_string(),
        extension: ext_of(&members[0]), media: "audio".into(),
        manifest: serde_json::json!({ "kind": "channel_set", "members": list }),
        file_count: members.len() as u64, total_size: total, modified: newest,
        probe_target: Some(members[0].to_string_lossy().into_owned()),
        members: members.iter().map(|m| m.to_string_lossy().into_owned()).collect(),
        bundle_type: None, cpl_title: None,
    })
}

/* ── bundles ──────────────────────────────────────────────────────────────── */

fn bundle(dir: &Path) -> Option<Unit> {
    let Ok(rd) = fs::read_dir(dir) else { return None };
    let names: Vec<String> = rd.flatten().map(|e| name_of(&e.path())).collect();
    let assetmap = names.iter().find(|n| n.eq_ignore_ascii_case("ASSETMAP.xml") || n.eq_ignore_ascii_case("ASSETMAP"))?;
    let head = fs::read_to_string(dir.join(assetmap)).ok().map(|s| s.chars().take(2000).collect::<String>()).unwrap_or_default();
    let bundle_type = if head.contains("2067-") || head.to_ascii_lowercase().contains("imf") { "imf" } else { "dcp" };
    // The first CPL's title, if there is one. CPLs are small XML files.
    let cpl_title = names.iter().filter(|n| n.to_ascii_lowercase().starts_with("cpl") && n.to_ascii_lowercase().ends_with(".xml"))
        .find_map(|n| {
            let s = fs::read_to_string(dir.join(n)).ok()?;
            let re = Regex::new(r"<(?:ContentTitleText|AnnotationText)>([^<]{1,200})</").unwrap();
            re.captures(&s).map(|c| c[1].trim().to_string())
        });
    // Every file under the folder, relative, sorted: what a manifest's `members` is.
    let mut files: Vec<(String, u64, fs::Metadata)> = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if name_of(&p).starts_with('.') { continue; }
            let Ok(meta) = fs::metadata(&p) else { continue };
            if meta.is_dir() { stack.push(p); continue; }
            let rel = p.strip_prefix(dir).ok()?.to_string_lossy().replace('\\', "/");
            files.push((rel, meta.len(), meta));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let total: u64 = files.iter().map(|f| f.1).sum();
    let newest = files.iter().map(|f| day_of(&f.2)).max().unwrap_or_default();
    let truncated = files.len() > MAX_MEMBERS;
    let members: Vec<serde_json::Value> = files.iter().take(MAX_MEMBERS).map(|f| serde_json::json!({ "path": f.0, "size": f.1 })).collect();
    Some(Unit {
        kind: "bundle".into(), path: dir.to_string_lossy().into_owned(), name: name_of(dir), extension: bundle_type.into(),
        media: "video".into(),
        manifest: serde_json::json!({ "kind": "bundle", "members": members, "source": if truncated { format!("walk of {assetmap}'s folder, first {MAX_MEMBERS} of {} files", files.len()) } else { format!("walk of {assetmap}'s folder") } }),
        file_count: files.len() as u64, total_size: total, modified: newest,
        probe_target: None,
        members: files.iter().map(|f| dir.join(&f.0).to_string_lossy().into_owned()).collect(),
        bundle_type: Some(bundle_type.into()), cpl_title,
    })
}
