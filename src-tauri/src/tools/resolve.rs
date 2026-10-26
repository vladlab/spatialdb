//! The Resolve timeline tool (RESOLVE-BRIEF.md R2): ask the RUNNING DaVinci
//! Resolve, through its scripting API, about one timeline of the open project.
//!
//! How, and why this way:
//! - The host's own `python3` (first on PATH — the owner's choice, Oct 26) runs
//!   `resolve_read.py`, which is COMPILED IN (`include_str!`) and fed on stdin.
//!   Nothing is written to disk and nothing comes from the server: the page names
//!   only a timeline, picked from the list this module read (lib.rs, rule 2).
//!   The name is one argv element; no shell is involved.
//! - Resolve's scripting module is found where Resolve installs it, with an
//!   environment override that wins (`SPATIALDB_RESOLVE_API`, `SPATIALDB_RESOLVE_LIB`),
//!   for a NixOS FHS install or anything else unusual.
//! - The script prints raw facts (frame numbers, Resolve's words); the OUTPUTS of
//!   contract/tools.ts are made here — timecode labels, the rate's rounding, the
//!   `timeline_audio` value — so they are tested in Rust (`outputs_from`) without
//!   a Resolve.
//! - Read-only: no call the script makes changes the project.

use serde_json::{json, Map, Value};
use std::{io::{Read as _, Write as _}, path::PathBuf, process::{Command, Stdio}, time::{Duration, Instant}};

use super::timecode::{can_drop, frames_to_tc, label_to_tc};

const SCRIPT: &str = include_str!("resolve_read.py");
/// Listing timelines is quick; reading one walks every audio item, which on a long
/// cut with many tracks is a few seconds. A modal dialog open in Resolve blocks its
/// scripting entirely — the timeout is what turns that into a message.
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(120);

/// Where Resolve and python3 are, for one run.
#[derive(Debug, Clone)]
pub struct Paths { pub api: PathBuf, pub lib: PathBuf, pub python: Option<PathBuf> }

impl Paths {
    /// The environment override, else where Resolve installs on this platform.
    pub fn from_env() -> Paths {
        let (api, lib) = if cfg!(target_os = "macos") {
            ("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
             "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so")
        } else {
            // Rocky / any Linux with Blackmagic's installer.
            ("/opt/resolve/Developer/Scripting", "/opt/resolve/libs/Fusion/fusionscript.so")
        };
        let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
        Paths {
            api: var("SPATIALDB_RESOLVE_API").unwrap_or_else(|| PathBuf::from(api)),
            lib: var("SPATIALDB_RESOLVE_LIB").unwrap_or_else(|| PathBuf::from(lib)),
            python: python3(),
        }
    }
}

/// The first `python3` on PATH; then the usual places, because an app launched
/// from the macOS Finder or a desktop launcher does not inherit the shell's PATH.
pub fn python3() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) { let p = dir.join("python3"); if p.is_file() { return Some(p); } }
    }
    ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3", "/run/current-system/sw/bin/python3"]
        .iter().map(PathBuf::from).find(|p| p.is_file())
}

/// The handshake's answer for the `resolve` analyzer: python3's version when both
/// python3 and Resolve's scripting library are on this machine, else None ("not
/// on this machine"). It does NOT talk to Resolve — that happens when asked.
pub fn available(p: &Paths) -> Option<String> {
    let py = p.python.as_ref()?;
    if !p.lib.is_file() { return None; }
    let out = Command::new(py).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(if out.stdout.is_empty() { &out.stderr } else { &out.stdout }).trim().to_string();
    Some(text.strip_prefix("Python ").unwrap_or(&text).to_string())
}

/// Run the script; its one JSON document, or why there is none.
fn run(p: &Paths, args: &[&str], timeout: Duration) -> Result<Value, String> {
    let py = p.python.as_ref().ok_or("python3 is not on this computer (the Resolve tool runs Resolve's scripting module with it)")?;
    if !p.lib.is_file() {
        return Err(format!("Resolve's scripting library is not at {} — is Resolve installed here? Set SPATIALDB_RESOLVE_LIB to its fusionscript.so", p.lib.display()));
    }
    let modules = p.api.join("Modules");
    let pythonpath = match std::env::var_os("PYTHONPATH") {
        Some(old) if !old.is_empty() => std::env::join_paths(std::iter::once(modules.clone()).chain(std::env::split_paths(&old))).map_err(|e| e.to_string())?,
        _ => modules.clone().into_os_string(),
    };
    let mut child = Command::new(py)
        .arg("-").args(args)
        .env("PYTHONPATH", pythonpath)
        .env("RESOLVE_SCRIPT_API", &p.api)
        .env("RESOLVE_SCRIPT_LIB", &p.lib)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("could not start {}: {e}", py.display()))?;
    {
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        stdin.write_all(SCRIPT.as_bytes()).map_err(|e| e.to_string())?;
    } // closed: python starts running the script
    // Read both pipes on threads, so a large answer cannot fill a pipe and stall
    // the child while we wait for it to exit.
    let mut so = child.stdout.take().ok_or("no stdout")?;
    let mut se = child.stderr.take().ok_or("no stderr")?;
    let out_t = std::thread::spawn(move || { let mut s = String::new(); let _ = so.read_to_string(&mut s); s });
    let err_t = std::thread::spawn(move || { let mut s = String::new(); let _ = se.read_to_string(&mut s); s });
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Resolve did not answer within {} s — a dialog open in Resolve blocks its scripting; close it and try again", timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let stdout = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();
    let doc: Value = serde_json::from_str(stdout.trim()).map_err(|_| {
        let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" / ");
        format!("the Resolve reader gave no answer{}", if tail.is_empty() { String::new() } else { format!(": {tail}") })
    })?;
    if doc.get("ok") == Some(&Value::Bool(true)) { Ok(doc) }
    else { Err(doc.get("error").and_then(Value::as_str).unwrap_or("the Resolve reader failed without saying why").to_string()) }
}

/// What the open project has — for the page's timeline picker.
#[derive(Debug, serde::Serialize, PartialEq)]
pub struct Project { pub version: String, pub project: String, pub timelines: Vec<String>, pub current: Option<String> }

pub fn list(p: &Paths) -> Result<Project, String> {
    let doc = run(p, &["list"], LIST_TIMEOUT)?;
    Ok(Project {
        version: str_of(&doc["version"]).unwrap_or_default(),
        project: str_of(&doc["project"]).unwrap_or_default(),
        timelines: doc["timelines"].as_array().map(|a| a.iter().filter_map(str_of).collect()).unwrap_or_default(),
        current: str_of(&doc["current"]),
    })
}

/// One timeline, as contract/tools.ts outputs, plus what the page should be told
/// (`problems`) and the raw numbers behind the labels (`raw`), so a doubtful label
/// can be checked against Resolve while the reader is new.
#[derive(Debug, serde::Serialize)]
pub struct ReadResult { pub outputs: Map<String, Value>, pub problems: Vec<String>, pub raw: Value }

pub fn read(p: &Paths, timeline: Option<&str>) -> Result<ReadResult, String> {
    let mut args = vec!["read"];
    if let Some(t) = timeline { args.push(t); }
    outputs_from(&run(p, &args, READ_TIMEOUT)?)
}

/* ── the script's raw answer → outputs (pure) ─────────────────────────────── */

fn str_of(v: &Value) -> Option<String> {
    match v { Value::String(s) => Some(s.clone()), Value::Number(n) => Some(n.to_string()), _ => None }
}
/// Resolve answers settings as strings ("1920", "23.976") and positions as numbers
/// (sometimes floats, with subframe precision): both are read as numbers here.
fn num_of(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => { let t: String = s.trim().chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect(); t.parse().ok() }
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}
fn frames(v: &Value) -> Option<i64> { num_of(v).map(|x| x.round() as i64) }
/// Cut to the shape's limit at a character boundary (contract/shapes.ts TimelineAudio).
fn cap(s: &str, max: usize) -> String { s.chars().take(max).collect() }

pub fn outputs_from(doc: &Value) -> Result<ReadResult, String> {
    let tl = &doc["timeline"];
    let mut o = Map::new();
    let mut problems = Vec::new();
    let mut put = |k: &str, v: Value| { o.insert(k.to_string(), v); };

    if let Some(v) = str_of(&doc["version"]) { put("resolve.version", json!(v)); }
    if let Some(v) = str_of(&doc["project"]) { put("project", json!(v)); }
    if let Some(v) = str_of(&tl["name"]) { put("timeline_name", json!(v)); }

    let (w, h) = (frames(&tl["width"]), frames(&tl["height"]));
    if let Some(w) = w { put("width", json!(w)); }
    if let Some(h) = h { put("height", json!(h)); }
    if let (Some(w), Some(h)) = (w, h) { put("dimensions", json!(format!("{w}×{h}"))); }

    // 23.976, 29.97 — three decimals, as ffprobe's Frame rate output stores them.
    let rate = num_of(&tl["rate"]).map(|r| (r * 1000.0).round() / 1000.0).filter(|r| *r > 0.0);
    let rate_says_df = str_of(&tl["rate"]).map(|s| s.to_uppercase().contains("DF")).unwrap_or(false);
    let drop = rate_says_df || num_of(&tl["drop"]).map(|d| d != 0.0).unwrap_or(false);
    let drop = drop && rate.map(can_drop).unwrap_or(false);
    if let Some(r) = rate { put("frame_rate", json!(r)); put("drop_frame", json!(drop)); }
    else { problems.push(format!("the timeline frame rate \"{}\" is not a number; no timecodes were made", str_of(&tl["rate"]).unwrap_or_default())); }

    let (start, end) = (frames(&tl["start_frame"]), frames(&tl["end_frame"]));
    let resolve_start = str_of(&tl["start_timecode"]);
    if let Some(s) = &resolve_start { put("start_timecode", json!(s)); }
    if let (Some(r), Some(s)) = (rate, start) {
        // A check on the frame-number reading while it is new: Resolve's own start
        // timecode against the label its start FRAME counts to. They should agree.
        let ours = frames_to_tc(s, r, drop);
        if let Some(theirs) = &resolve_start { if theirs.replace(';', ":") != ours.replace(';', ":") {
            problems.push(format!("Resolve says the timeline starts at {theirs}, but its start frame {s} counts to {ours} at {r}{} — the other timecodes may be off; please report this", if drop { " DF" } else { "" }));
        } }
        if resolve_start.is_none() { put("start_timecode", json!(ours)); }
        if let Some(e) = end {
            put("end_timecode", json!(frames_to_tc(e, r, drop)));
            let len = (e - s).max(0);
            put("duration", json!(label_to_tc(len, r, false)));
            put("duration_frames", json!(len));
        }
    }

    // ── the audio tracks → a timeline_audio value
    let mut tracks = Vec::new();
    let mut end_differs = 0usize;
    for t in doc["tracks"].as_array().cloned().unwrap_or_default() {
        let index = frames(&t["index"]).unwrap_or(0).max(1);
        let name = cap(&str_of(&t["name"]).unwrap_or_default(), 80);
        let format = str_of(&t["format"]).filter(|f| !f.is_empty()).unwrap_or_else(|| "unknown".into());
        let mut clips = Vec::new();
        let items = t["clips"].as_array().cloned().unwrap_or_default();
        if items.len() > 500 { problems.push(format!("{}: {} clips on one track — only the first 500 are kept", if name.is_empty() { format!("A{index}") } else { name.clone() }, items.len())); }
        for c in items.iter().take(500) {
            let (Some(cs), Some(cd)) = (frames(&c["start"]), frames(&c["duration"])) else { continue };
            // END is start + duration: exclusive, whatever GetEnd counts. (Where GetEnd
            // disagrees, it is counted — a sign the API means something else by it.)
            if let Some(ge) = frames(&c["end"]) { if ge != cs + cd { end_differs += 1; } }
            let (Some(r), true) = (rate, cd >= 0) else { continue };
            let mut clip = json!({
                "name": cap(&str_of(&c["name"]).unwrap_or_default(), 255),
                "start": frames_to_tc(cs, r, drop),
                "end": frames_to_tc(cs + cd, r, drop),
                "frames": cd,
            });
            if let Some(path) = str_of(&c["path"]).filter(|p| !p.is_empty()) { clip["path"] = json!(cap(&path, 1024)); }
            clips.push(clip);
        }
        tracks.push(json!({ "index": index, "name": name, "format": cap(&format, 16), "clips": clips }));
    }
    if end_differs > 0 { problems.push(format!("{end_differs} clip(s): Resolve's GetEnd is not start + duration; the ends written are start + duration")); }
    if rate.is_some() { o.insert("audio_tracks".into(), json!({ "tracks": tracks })); }

    let raw = json!({ "start_frame": tl["start_frame"], "end_frame": tl["end_frame"], "rate": tl["rate"], "drop": tl["drop"] });
    Ok(ReadResult { outputs: o, problems, raw })
}

/* ── tests: the pure half, then the script itself against a FAKE Resolve ──── */

#[cfg(test)]
mod tests {
    use super::*;

    fn answer() -> Value {
        json!({
            "ok": true, "version": "20.1.0", "project": "Duke",
            "timeline": { "name": "EP101_OEV3", "width": "1920", "height": "1080", "rate": "23.976", "drop": "0",
                          "start_timecode": "00:59:30:00", "start_frame": 85680, "end_frame": 161656 },
            "tracks": [
                { "index": 1, "name": "A1", "format": "stereo", "clips": [
                    { "name": "EP101_Mix_ST.wav", "start": 85680, "duration": 75976, "end": 161656, "path": "/mnt/post/EP101_Mix_ST.wav" } ] },
                { "index": 2, "name": "A2", "format": "5.1", "clips": [
                    { "name": "tone", "start": 84240, "duration": 1440, "end": 85680, "path": null },
                    { "name": "EP101_Mix_51.wav", "start": 85680, "duration": 75976, "end": 161656, "path": "/mnt/post/EP101_Mix_51.wav" } ] },
            ]
        })
    }

    #[test] fn the_outputs_of_a_timeline() {
        let r = outputs_from(&answer()).unwrap();
        let o = &r.outputs;
        assert_eq!(o["resolve.version"], "20.1.0");
        assert_eq!(o["project"], "Duke");
        assert_eq!(o["timeline_name"], "EP101_OEV3");
        assert_eq!(o["dimensions"], "1920×1080");
        assert_eq!(o["width"], 1920);
        assert_eq!(o["frame_rate"], 23.976);
        assert_eq!(o["drop_frame"], false);
        assert_eq!(o["start_timecode"], "00:59:30:00");
        assert_eq!(o["end_timecode"], "01:52:15:16", "frame 161656 at 24 labels");
        assert_eq!(o["duration_frames"], 75976);
        assert_eq!(o["duration"], "00:52:45:16");
        let t = &o["audio_tracks"]["tracks"];
        assert_eq!(t[0]["clips"][0], json!({ "name": "EP101_Mix_ST.wav", "start": "00:59:30:00", "end": "01:52:15:16", "frames": 75976, "path": "/mnt/post/EP101_Mix_ST.wav" }));
        assert_eq!(t[1]["clips"][0]["start"], "00:58:30:00");
        assert!(t[1]["clips"][0].get("path").is_none(), "a clip with no file has NO path, not null");
        assert_eq!(t[1]["format"], "5.1");
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test] fn drop_frame_timelines_label_with_semicolons() {
        let mut a = answer();
        a["timeline"]["rate"] = json!("29.97"); a["timeline"]["drop"] = json!("1");
        a["timeline"]["start_frame"] = json!(107892); a["timeline"]["end_frame"] = json!(107892 + 1800);
        a["timeline"]["start_timecode"] = json!("01:00:00;00");
        let r = outputs_from(&a).unwrap();
        assert_eq!(r.outputs["drop_frame"], true);
        assert_eq!(r.outputs["end_timecode"], "01:01:00;02", "minute 1 skips 00 and 01");
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test] fn drop_is_never_claimed_where_it_cannot_exist() {
        let mut a = answer(); a["timeline"]["drop"] = json!("1");
        assert_eq!(outputs_from(&a).unwrap().outputs["drop_frame"], false);
    }

    #[test] fn a_start_frame_that_disagrees_with_resolves_start_timecode_is_reported() {
        let mut a = answer(); a["timeline"]["start_timecode"] = json!("01:00:00:00");
        let r = outputs_from(&a).unwrap();
        assert_eq!(r.outputs["start_timecode"], "01:00:00:00", "Resolve's own word is what is written");
        assert!(r.problems.iter().any(|p| p.contains("counts to 00:59:30:00")), "{:?}", r.problems);
    }

    #[test] fn a_rate_that_is_not_a_number_makes_no_timecodes() {
        let mut a = answer(); a["timeline"]["rate"] = json!("");
        let r = outputs_from(&a).unwrap();
        assert!(r.outputs.get("end_timecode").is_none() && r.outputs.get("audio_tracks").is_none());
        assert!(r.problems[0].contains("not a number"));
    }

    #[test] fn getend_disagreeing_is_counted_not_trusted() {
        let mut a = answer(); a["tracks"][0]["clips"][0]["end"] = json!(161655);
        let r = outputs_from(&a).unwrap();
        assert_eq!(r.outputs["audio_tracks"]["tracks"][0]["clips"][0]["end"], "01:52:15:16");
        assert!(r.problems.iter().any(|p| p.contains("GetEnd")));
    }

    /// A stand-in for Resolve's scripting module, with the calls resolve_read.py
    /// makes — the script itself runs, through the real python3, on real argv.
    const FAKE: &str = r#"
class Item:
    def __init__(s, name, start, dur, path): s.n, s.s, s.d, s.p = name, start, dur, path
    def GetName(s): return s.n
    def GetStart(s): return s.s
    def GetDuration(s): return s.d
    def GetEnd(s): return s.s + s.d
    def GetMediaPoolItem(s): return MPI(s.p) if s.p else None
class MPI:
    def __init__(s, p): s.p = p
    def GetClipProperty(s, k): return s.p if k == "File Path" else ""
class Timeline:
    def __init__(s, name): s.n = name
    def GetName(s): return s.n
    def GetSetting(s, k): return {"timelineResolutionWidth": "3840", "timelineResolutionHeight": "2160", "timelineFrameRate": "25", "timelineDropFrameTimecode": "0"}.get(k, "")
    def GetStartTimecode(s): return "10:00:00:00"
    def GetStartFrame(s): return 900000
    def GetEndFrame(s): return 900250
    def GetTrackCount(s, kind): return 2 if kind == "audio" else 1
    def GetTrackName(s, kind, i): return ["Mix", "M&E"][i - 1]
    def GetTrackSubType(s, kind, i): return ["stereo", "5.1film"][i - 1]
    def GetItemListInTrack(s, kind, i): return [Item("mix.wav", 900000, 250, "/mnt/mix.wav")] if i == 1 else [Item("tone", 899000, 1000, None), Item("me.wav", 900000, 250, "/mnt/me.wav")]
class Project:
    def GetName(s): return "Duke"
    def GetTimelineCount(s): return 2
    def GetTimelineByIndex(s, i): return [Timeline("EP101_OEV3"), Timeline("EP101_OEV2")][i - 1]
    def GetCurrentTimeline(s): return Timeline("EP101_OEV3")
    def GetSetting(s, k): return ""
class PM:
    def GetCurrentProject(s): return Project()
class Resolve:
    def GetProjectManager(s): return PM()
    def GetVersionString(s): return "20.1.0"
import os
def scriptapp(name): return None if os.environ.get("FAKE_NOT_RUNNING") else Resolve()
"#;

    fn fake(name: &str, module: &str) -> Paths {
        let dir = std::env::temp_dir().join(format!("spdb-resolve-{}-{name}", std::process::id()));
        std::fs::create_dir_all(dir.join("Modules")).unwrap();
        std::fs::write(dir.join("Modules/DaVinciResolveScript.py"), module).unwrap();
        std::fs::write(dir.join("fusionscript.so"), b"").unwrap();
        Paths { api: dir.clone(), lib: dir.join("fusionscript.so"), python: python3() }
    }

    #[test] fn the_script_lists_a_projects_timelines() {
        let p = fake("list", FAKE);
        if p.python.is_none() { eprintln!("no python3 here: skipped"); return; }
        assert!(available(&p).is_some());
        let l = list(&p).unwrap();
        assert_eq!(l, Project { version: "20.1.0".into(), project: "Duke".into(), timelines: vec!["EP101_OEV3".into(), "EP101_OEV2".into()], current: Some("EP101_OEV3".into()) });
    }

    #[test] fn the_script_reads_a_named_timeline_end_to_end() {
        let p = fake("read", FAKE);
        if p.python.is_none() { return; }
        let r = read(&p, Some("EP101_OEV2")).unwrap();
        assert_eq!(r.outputs["timeline_name"], "EP101_OEV2");
        assert_eq!(r.outputs["dimensions"], "3840×2160");
        assert_eq!(r.outputs["frame_rate"], 25.0);
        assert_eq!(r.outputs["end_timecode"], "10:00:10:00");
        let t = &r.outputs["audio_tracks"]["tracks"];
        assert_eq!(t[1]["format"], "5.1film");
        assert_eq!(t[1]["clips"][0]["name"], "tone");
        assert!(t[1]["clips"][0].get("path").is_none());
        assert_eq!(t[1]["clips"][1]["path"], "/mnt/me.wav");
        assert!(r.problems.is_empty(), "{:?}", r.problems);
    }

    #[test] fn a_timeline_name_that_starts_with_a_dash_is_a_name() {
        let p = fake("dash", FAKE);
        if p.python.is_none() { return; }
        let e = read(&p, Some("--version")).unwrap_err();
        assert!(e.contains("no timeline named \"--version\""), "{e}");
    }

    #[test] fn resolve_not_running_says_how_to_fix_it() {
        let p = fake("off", &FAKE.replace("os.environ.get(\"FAKE_NOT_RUNNING\")", "True"));
        if p.python.is_none() { return; }
        let e = list(&p).unwrap_err();
        assert!(e.contains("Resolve did not answer") && e.contains("External scripting"), "{e}");
    }

    #[test] fn an_api_call_that_raises_is_reported_by_name() {
        let p = fake("raise", &FAKE.replace("def GetTrackSubType(s, kind, i): return", "def GetTrackSubType(s, kind, i): raise AttributeError('no such method')\n    def _unused(s, kind, i): return"));
        if p.python.is_none() { return; }
        let e = read(&p, None).unwrap_err();
        assert!(e.contains("GetTrackSubType(audio, 1) failed"), "{e}");
    }

    #[test] fn no_module_and_no_library_are_explained() {
        let mut p = fake("nomod", FAKE);
        if p.python.is_none() { return; }
        std::fs::remove_file(p.api.join("Modules/DaVinciResolveScript.py")).unwrap();
        assert!(list(&p).unwrap_err().contains("could not import"));
        p.lib = p.api.join("missing.so");
        assert!(list(&p).unwrap_err().contains("SPATIALDB_RESOLVE_LIB"));
        assert!(available(&p).is_none(), "the handshake says not on this machine");
    }

    #[test] fn a_reader_that_hangs_times_out() {
        let p = fake("hang", &FAKE.replace("def scriptapp(name):", "import time\ndef scriptapp(name):\n    time.sleep(30)\ndef _old(name):"));
        if p.python.is_none() { return; }
        let t = Instant::now();
        let e = run(&p, &["list"], Duration::from_millis(800)).unwrap_err();
        assert!(e.contains("did not answer within") && t.elapsed() < Duration::from_secs(5), "{e}");
    }
}
