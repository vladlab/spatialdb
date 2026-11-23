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
    /// The newest member's modification time, unix seconds (0: the filesystem would
    /// not say). With `file_count` and `total_size` it is the manifest's `stat` —
    /// what a file dropped onto a record is compared by (contract/fingerprint.ts).
    /// `default`: the page hands units back, and an older page's lack the field.
    #[serde(default)]
    pub mtime: u64,
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
/// Channel suffixes a stem set uses, in CANONICAL ORDER — the order a channel
/// set's members are listed, so that six files L/R/C/LFE/Ls/Rs come out as a 5.1
/// spec lists them, whatever the file names sort to. (The compare engine checks
/// the flattened channel order first.) LFE spelling variants collapse to "LFE".
const CHANNELS: &[&str] = &["L", "R", "C", "LFE", "Ls", "Rs", "Lss", "Rss", "Lsr", "Rsr", "Lrs", "Rrs", "Lb", "Rb", "Lc", "Rc", "Cs", "Lw", "Rw", "Lt", "Rt", "Lh", "Rh", "Ltf", "Rtf", "Ltr", "Rtr", "Ltm", "Rtm", "Tc", "M", "S"];
fn canonical_channel(ch: &str) -> Option<&'static str> {
    if ch.eq_ignore_ascii_case("lfe") { return Some("LFE"); }
    CHANNELS.iter().copied().find(|c| *c == ch)
}
fn channel_rank(ch: &str) -> usize { CHANNELS.iter().position(|c| *c == ch).unwrap_or(usize::MAX) }

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

/// A file's modification time as unix seconds; 0 when the filesystem would not say.
/// MODIFIED, not created: creation time is often unavailable over NFS/SMB, and a
/// copy gets a new one where `rsync -a` / `cp -p` keep this.
fn secs_of(meta: &fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// A manifest with its `stat` (contract/shapes.ts `Stat`): how many files, how many
/// bytes, the newest modification time — left out when unknown. A stat, never a read.
fn with_stat(mut manifest: serde_json::Value, files: u64, bytes: u64, mtime: u64) -> serde_json::Value {
    let mut stat = serde_json::json!({ "files": files, "bytes": bytes });
    if mtime > 0 { stat["modified"] = mtime.into(); }
    manifest["stat"] = stat;
    manifest
}

/// What the record a hash was asked from holds about its file (the page sends it
/// with `analyze_path`): the fingerprint of contract/fingerprint.ts.
#[derive(Deserialize, Clone, Debug)]
pub struct Expect { pub files: Option<u64>, pub bytes: u64, pub modified: Option<u64> }

/// Seconds two modification times may differ by and still be the same moment
/// (filesystems round differently). contract/fingerprint.ts `MODIFIED_TOLERANCE`.
const MODIFIED_TOLERANCE: u64 = 2;

/// Why what is at the path is NOT the file the record describes — its size, date or
/// file count is another — or None when nothing known differs. Asked BEFORE a hash
/// reads a byte: ten minutes of NAS for a checksum that would describe the wrong
/// file is the thing to avoid. Worded as the page words it (fileDrop.ts).
pub fn changed(unit: &Unit, e: &Expect) -> Option<String> {
    let mut what: Vec<&str> = Vec::new();
    if e.files.is_some_and(|n| n != unit.file_count) { what.push("file count"); }
    if e.bytes != unit.total_size { what.push("size"); }
    if e.modified.is_some_and(|m| unit.mtime > 0 && m.abs_diff(unit.mtime) > MODIFIED_TOLERANCE) { what.push("modified date"); }
    if what.is_empty() { return None; }
    let (list, verb) = match what.len() {
        1 => (what[0].to_string(), "has"),
        n => (format!("{} and {}", what[..n - 1].join(", "), what[n - 1]), "have"),
    };
    Some(format!("its {list} {verb} changed since it was recorded"))
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
        manifest: with_stat(serde_json::json!({ "kind": "file", "size": meta.len() }), 1, meta.len(), secs_of(meta)),
        file_count: 1, total_size: meta.len(), modified: day_of(meta), mtime: secs_of(meta),
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
    let mtime = frames.iter().map(|x| secs_of(&x.3)).max().unwrap_or(0);
    let stem = f.prefix.trim_end_matches(['.', '_', '-']);
    Some(Unit {
        kind: "sequence".into(), path: dir.to_string_lossy().into_owned(),
        name: if stem.is_empty() { name_of(dir) } else { stem.to_string() },
        extension: f.ext.clone(), media: "image".into(),
        manifest: with_stat(serde_json::json!({ "kind": "sequence", "pattern": f.pattern, "first": first, "last": last, "count": frames.len(), "gaps": gaps }), frames.len() as u64, total, mtime),
        file_count: frames.len() as u64, total_size: total, modified: newest, mtime,
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
    if base.is_empty() { return None; }
    Some((base.to_string(), canonical_channel(ch)?.to_string()))
}

fn channel_set(dir: &Path, stem: &str, members: &[PathBuf]) -> Option<Unit> {
    // Members in channel order, not file-name order.
    let mut members: Vec<PathBuf> = members.to_vec();
    members.sort_by_key(|m| channel_of(m).map(|(_, ch)| channel_rank(&ch)).unwrap_or(usize::MAX));
    let members = &members;
    let mut total = 0; let mut newest = String::new(); let mut mtime = 0; let mut list = Vec::new();
    for m in members {
        let meta = fs::metadata(m).ok()?;
        total += meta.len(); newest = newest.max(day_of(&meta)); mtime = mtime.max(secs_of(&meta));
        let rel = m.strip_prefix(dir).ok()?.to_string_lossy().into_owned();
        list.push(serde_json::json!({ "path": rel, "channel": channel_of(m)?.1 }));
    }
    Some(Unit {
        kind: "channel_set".into(), path: dir.to_string_lossy().into_owned(), name: stem.to_string(),
        extension: ext_of(&members[0]), media: "audio".into(),
        manifest: with_stat(serde_json::json!({ "kind": "channel_set", "members": list }), members.len() as u64, total, mtime),
        file_count: members.len() as u64, total_size: total, modified: newest, mtime,
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
    let mtime = files.iter().map(|f| secs_of(&f.2)).max().unwrap_or(0);
    let truncated = files.len() > MAX_MEMBERS;
    let members: Vec<serde_json::Value> = files.iter().take(MAX_MEMBERS).map(|f| serde_json::json!({ "path": f.0, "size": f.1 })).collect();
    Some(Unit {
        kind: "bundle".into(), path: dir.to_string_lossy().into_owned(), name: name_of(dir), extension: bundle_type.into(),
        media: "video".into(),
        manifest: with_stat(serde_json::json!({ "kind": "bundle", "members": members, "source": if truncated { format!("walk of {assetmap}'s folder, first {MAX_MEMBERS} of {} files", files.len()) } else { format!("walk of {assetmap}'s folder") } }), files.len() as u64, total, mtime),
        file_count: files.len() as u64, total_size: total, modified: newest, mtime,
        probe_target: None,
        members: files.iter().map(|f| dir.join(&f.0).to_string_lossy().into_owned()).collect(),
        bundle_type: Some(bundle_type.into()), cpl_title,
    })
}

#[cfg(test)]
mod stat_tests {
    use super::*;

    /// The stat is in every manifest: count, bytes, newest modification time.
    #[test]
    fn a_manifest_carries_its_stat() {
        let dir = std::env::temp_dir().join(format!("spatialdb-stat-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let one = dir.join("master.mov"); fs::write(&one, b"twelve bytes").unwrap();
        let u = classify(&[one.clone()]).remove(0);
        let mtime = fs::metadata(&one).unwrap().modified().unwrap().duration_since(UNIX_EPOCH).unwrap().as_secs();
        assert_eq!(u.mtime, mtime);
        assert_eq!(u.manifest["stat"], serde_json::json!({ "files": 1, "bytes": 12, "modified": mtime }));
        assert_eq!(u.manifest["size"], 12);

        // A set: the count, the total, the NEWEST member's time.
        let (l, r) = (dir.join("mix_L.wav"), dir.join("mix_R.wav"));
        fs::write(&l, b"abc").unwrap(); fs::write(&r, b"defgh").unwrap();
        let set = classify(&[l.clone(), r.clone()]).into_iter().find(|u| u.kind == "channel_set").unwrap();
        assert_eq!(set.manifest["stat"]["files"], 2);
        assert_eq!(set.manifest["stat"]["bytes"], 8);
        assert_eq!(set.manifest["stat"]["modified"], set.mtime);
        assert!(set.mtime >= mtime);

        // A sequence has no size anywhere else in its manifest: the stat is where it is.
        for n in 1..=3 { fs::write(dir.join(format!("plate.{n:04}.exr")), b"frame").unwrap(); }
        let seq = classify(&[dir.join("plate.0001.exr")]).remove(0);
        assert_eq!(seq.kind, "sequence");
        assert_eq!(seq.manifest["stat"]["files"], 3);
        assert_eq!(seq.manifest["stat"]["bytes"], 15);
        fs::remove_dir_all(&dir).ok();
    }

    fn unit(files: u64, bytes: u64, mtime: u64) -> Unit {
        Unit { kind: "file".into(), path: "/x".into(), name: String::new(), extension: String::new(), media: String::new(),
               manifest: serde_json::Value::Null, file_count: files, total_size: bytes, modified: String::new(), mtime,
               probe_target: None, members: vec![], bundle_type: None, cpl_title: None }
    }

    #[test]
    fn changed_names_what_differs_and_forgives_two_seconds() {
        let e = |files, bytes, modified| Expect { files, bytes, modified };
        assert_eq!(changed(&unit(1, 100, 5000), &e(Some(1), 100, Some(5000))), None);
        // Filesystems round modification times differently: 2 s either way is the same moment.
        assert_eq!(changed(&unit(1, 100, 5002), &e(Some(1), 100, Some(5000))), None);
        assert_eq!(changed(&unit(1, 100, 4998), &e(Some(1), 100, Some(5000))), None);
        assert_eq!(changed(&unit(1, 100, 5003), &e(Some(1), 100, Some(5000))).as_deref(), Some("its modified date has changed since it was recorded"));
        assert_eq!(changed(&unit(1, 101, 5000), &e(Some(1), 100, Some(5000))).as_deref(), Some("its size has changed since it was recorded"));
        assert_eq!(changed(&unit(7, 101, 9000), &e(Some(6), 100, Some(5000))).as_deref(), Some("its file count, size and modified date have changed since it was recorded"));
        // A record from before dates were kept, or a filesystem that will not say: size alone.
        assert_eq!(changed(&unit(1, 100, 9000), &e(None, 100, None)), None);
        assert_eq!(changed(&unit(1, 100, 0), &e(Some(1), 100, Some(5000))), None);
    }
}
