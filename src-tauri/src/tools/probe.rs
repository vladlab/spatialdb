//! Stage 3 of a drop: ffprobe facts for one unit, keyed by the OUTPUT names in
//! contract/tools.ts. ffprobe runs with arguments built HERE, never sent by a page
//! (lib.rs, rule 2). Whatever cannot be determined is simply absent: the page never
//! writes null (values.ts refuses it).
//!
//! What is probed: a file itself; a sequence's FIRST frame (so width, height, pixel
//! format and codec come from the frames, while frame count comes from the manifest
//! and rate/duration are unknowable); each member of a channel set (they are mono
//! files; the layout is one track per file); nothing for a bundle.

use super::classify::Unit;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::process::Command;

#[derive(Serialize)]
pub struct Probed { pub outputs: Map<String, Value> }

pub fn version(bin: &str) -> Option<String> {
    let out = Command::new(bin).arg("-version").output().ok()?;
    if !out.status.success() { return None; }
    let first = String::from_utf8_lossy(&out.stdout).lines().next()?.to_string();
    Some(first.split_whitespace().nth(2).unwrap_or(&first).to_string())
}

fn run_ffprobe(path: &str) -> Result<Value, String> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i"])
        .arg(path)
        .output()
        .map_err(|e| format!("ffprobe could not be run ({e}) — is ffmpeg installed on this machine?"))?;
    if !out.status.success() {
        return Err(format!("ffprobe: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| format!("ffprobe output was not JSON: {e}"))
}

pub fn probe(unit: &Unit) -> Result<Probed, String> {
    let mut o = Map::new();
    // Provenance first: which ffprobe wrote everything below.
    if let Some(v) = version("ffprobe") { o.insert("ffprobe.version".into(), json!(v)); }
    if unit.kind == "channel_set" {
        let mut tracks = Vec::new();
        for (m, member) in unit.members.iter().enumerate() {
            let v = run_ffprobe(member)?;
            let s = first_stream(&v, "audio");
            if m == 0 { if let Some(s) = s { audio_basics(&mut o, s, &v); } }
            let ch = unit.manifest["members"][m]["channel"].as_str().unwrap_or("").to_string();
            tracks.push(json!({ "name": unit.name, "channels": [ch] }));
        }
        o.insert("audio_stream_count".into(), json!(unit.members.len()));
        o.insert("audio_channels".into(), json!(unit.members.len()));
        o.insert("audio_layout".into(), json!({ "tracks": tracks }));
        return Ok(Probed { outputs: o });
    }
    let Some(target) = &unit.probe_target else { return Ok(Probed { outputs: o }) };
    let v = run_ffprobe(target)?;
    let format = &v["format"];
    // As ffprobe says it, WHOLE: "mov,mp4,m4a,3gp,3g2,mj2" for the QuickTime family.
    // Trimming to "mov" claimed something the demuxer never said; the extension
    // output is the honest way to tell a .mov from a .mp4.
    if let Some(name) = format["format_name"].as_str() { o.insert("container".into(), json!(name)); }

    if let Some(s) = first_stream(&v, "video") {
        video(&mut o, s, format, unit.kind == "sequence");
    }
    let audio_streams: Vec<&Value> = streams(&v).into_iter().filter(|s| s["codec_type"] == "audio").collect();
    // Track names live in the moov, where ffprobe does not look (qt.rs).
    let qt_names = if matches!(unit.extension.as_str(), "mov" | "mp4" | "m4v" | "m4a") { super::qt::audio_track_names(std::path::Path::new(target)) } else { vec![] };
    if let Some(first) = audio_streams.first() {
        audio_basics(&mut o, first, &v);
        o.insert("audio_stream_count".into(), json!(audio_streams.len()));
        let mut total = 0u64; let mut tracks = Vec::new();
        for (i, s) in audio_streams.iter().enumerate() {
            let n = s["channels"].as_u64().unwrap_or(0); total += n;
            let title = s["tags"]["title"].as_str().unwrap_or("").trim().to_string();
            let name = qt_names.get(i).cloned().flatten()
                .or(if title.is_empty() { None } else { Some(title) })
                .unwrap_or_else(|| format!("A{}", i + 1));
            let mut t = json!({ "name": name, "channels": channel_labels(s["channel_layout"].as_str().unwrap_or(""), n) });
            if let Some(lang) = s["tags"]["language"].as_str() { if lang != "und" && lang.len() <= 35 { t["language"] = json!(lang); } }
            tracks.push(t);
        }
        o.insert("audio_channels".into(), json!(total));
        if !tracks.is_empty() { o.insert("audio_layout".into(), json!({ "tracks": tracks })); }
    }
    // Start timecode, hunted across format, video and data (tmcd) streams — as viznotes did.
    let tc = format["tags"]["timecode"].as_str()
        .or_else(|| streams(&v).iter().find_map(|s| s["tags"]["timecode"].as_str()))
        .map(str::to_string);
    if let Some(tc) = tc { o.insert("start_timecode".into(), json!(tc)); }
    Ok(Probed { outputs: o })
}

fn streams(v: &Value) -> Vec<&Value> { v["streams"].as_array().map(|a| a.iter().collect()).unwrap_or_default() }
fn first_stream<'a>(v: &'a Value, kind: &str) -> Option<&'a Value> { streams(v).into_iter().find(|s| s["codec_type"] == kind) }

fn num(v: &Value) -> Option<f64> { v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())) }
fn ratio(s: &str) -> Option<f64> {
    let (a, b) = s.split_once('/')?;
    let (a, b): (f64, f64) = (a.parse().ok()?, b.parse().ok()?);
    if b == 0.0 { None } else { Some(a / b) }
}

fn video(o: &mut Map<String, Value>, s: &Value, format: &Value, is_sequence: bool) {
    if let Some(c) = s["codec_name"].as_str() { o.insert("video_codec".into(), json!(c)); }
    if let Some(p) = s["profile"].as_str() { o.insert("codec_profile".into(), json!(p)); }
    if let Some(w) = s["width"].as_u64() { o.insert("width".into(), json!(w)); }
    if let Some(h) = s["height"].as_u64() { o.insert("height".into(), json!(h)); }
    let pix = s["pix_fmt"].as_str().unwrap_or("");
    if !pix.is_empty() {
        o.insert("pixel_format".into(), json!(pix));
        o.insert("bit_depth".into(), json!(bit_depth(pix, s)));
        o.insert("chroma".into(), json!(chroma(pix)));
    }
    for (key, tag) in [("color_primaries", "color_primaries"), ("color_transfer", "color_transfer"), ("color_matrix", "color_space")] {
        if let Some(x) = s[tag].as_str() { if x != "unknown" { o.insert(key.into(), json!(x)); } }
    }
    if let Some(r) = s["color_range"].as_str() { if r == "tv" || r == "pc" { o.insert("color_range".into(), json!(r)); } }
    // Field dominance by which field is DISPLAYED first: tt/bt → top, bb/tb → bottom
    // (ffprobe's two letters are coded-first then displayed-first).
    if let Some(f) = s["field_order"].as_str() {
        let scan = match f { "progressive" => Some("progressive"), "tt" | "bt" => Some("interlaced (TFF)"), "bb" | "tb" => Some("interlaced (BFF)"), "unknown" => None, _ => Some("interlaced") };
        if let Some(sc) = scan { o.insert("scan".into(), json!(sc)); }
    }
    // The STREAM's own rate only. Falling back to the file's rate (audio included)
    // was a number that looked right and was not; blank is honest.
    if let Some(b) = num(&s["bit_rate"]) { o.insert("video_bitrate".into(), json!(b as u64)); }
    if is_sequence { return; }   // rate and duration are not a property of one frame
    let rate = s["r_frame_rate"].as_str().and_then(ratio).filter(|r| *r > 0.0)
        .or_else(|| s["avg_frame_rate"].as_str().and_then(ratio).filter(|r| *r > 0.0));
    if let Some(r) = rate { o.insert("frame_rate".into(), json!((r * 1000.0).round() / 1000.0)); }
    let secs = num(&s["duration"]).or_else(|| num(&format["duration"]));
    if let Some(d) = secs {
        o.insert("duration_seconds".into(), json!((d * 1000.0).round() / 1000.0));
        if let Some(r) = rate { o.insert("duration".into(), json!(timecode(d, r))); }
    }
    let frames = num(&s["nb_frames"]).or_else(|| secs.zip(rate).map(|(d, r)| (d * r).round()));
    if let Some(n) = frames { if n > 0.0 { o.insert("frame_count".into(), json!(n as u64)); } }
}

fn audio_basics(o: &mut Map<String, Value>, s: &Value, _v: &Value) {
    if let Some(c) = s["codec_name"].as_str() { o.insert("audio_codec".into(), json!(c)); }
    if let Some(r) = num(&s["sample_rate"]) { o.insert("sample_rate".into(), json!(r as u64)); }
    let depth = s["bits_per_raw_sample"].as_u64().or_else(|| num(&s["bits_per_raw_sample"]).map(|x| x as u64))
        .or_else(|| s["bits_per_sample"].as_u64().filter(|b| *b > 0))
        .or_else(|| s["codec_name"].as_str().and_then(|c| c.strip_prefix("pcm_")).and_then(|c| c.trim_start_matches(['s', 'u', 'f']).chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>().parse().ok()));
    if let Some(d) = depth { o.insert("audio_bit_depth".into(), json!(d)); }
}

/// yuv422p10le → 10, yuv420p → 8, rgb48le → 16 (packed: bits per PIXEL), gbrp10le → 10
/// (planar: per sample), gbrpf32le → 32, gray16le → 16.
fn bit_depth(pix: &str, s: &Value) -> u64 {
    if let Some(b) = s["bits_per_raw_sample"].as_str().and_then(|x| x.parse::<u64>().ok()).filter(|b| *b > 0) { return b; }
    let mut runs: Vec<u64> = Vec::new(); let mut cur = String::new();
    for c in pix.chars() { if c.is_ascii_digit() { cur.push(c); } else if !cur.is_empty() { runs.push(cur.parse().unwrap_or(0)); cur.clear(); } }
    if !cur.is_empty() { runs.push(cur.parse().unwrap_or(0)); }
    let last = runs.last().copied().unwrap_or(0);
    if pix.starts_with("yuv") { if runs.len() >= 2 { last } else { 8 } }
    else if pix.starts_with("gbr") || pix.starts_with("gray") { if last > 0 { last } else { 8 } }
    else if pix.starts_with("rgb") || pix.starts_with("bgr") || pix.starts_with("argb") || pix.starts_with("abgr") {
        let per = if pix.contains('a') { 4 } else { 3 };
        if last >= 24 { last / per } else { 8 }
    } else if last > 0 { last } else { 8 }
}

fn chroma(pix: &str) -> &'static str {
    if pix.starts_with("rgb") || pix.starts_with("bgr") || pix.starts_with("gbr") { "RGB" }
    else if pix.contains("444") { "4:4:4" } else if pix.contains("422") { "4:2:2" } else if pix.contains("420") { "4:2:0" }
    else if pix.contains("411") { "4:1:1" } else if pix.starts_with("gray") { "Y" } else { "" }
}

/// HH:MM:SS:FF, non-drop, at the file's rate. A duration, not a wall-clock timecode.
fn timecode(secs: f64, rate: f64) -> String {
    let nominal = rate.round();
    let total = (secs * rate).round() as u64;
    let fps = nominal.max(1.0) as u64;
    let f = total % fps; let s = total / fps;
    format!("{:02}:{:02}:{:02}:{:02}", s / 3600, (s / 60) % 60, s % 60, f)
}

/// ffmpeg's channel layout → the labels a vendor writes, channel by channel.
/// Two forms arrive: a NAMED layout ("stereo", "5.1", "7.1") or a CUSTOM one
/// ("1 channels (DL)", "2 channels (FL+FR)") — the latter is what a MOV tagged
/// with per-track `chan` atoms (qt_chan_tag_inplace.py) reports for each mono
/// track. Both are expanded to ffmpeg's channel names and mapped through one
/// table; a layout with neither form, or a count that does not match, → ch1…chN.
fn channel_labels(layout: &str, n: u64) -> Vec<String> {
    let av: Option<Vec<&str>> = if let Some(inner) = layout.strip_suffix(')').and_then(|s| s.split_once(" channels (")).map(|(_, i)| i) {
        Some(inner.split('+').collect())
    } else {
        match layout {
            "mono" => Some(vec!["FC"]),
            "stereo" => Some(vec!["FL", "FR"]),
            "2.1" => Some(vec!["FL", "FR", "LFE"]),
            "3.0" => Some(vec!["FL", "FR", "FC"]),
            "3.0(back)" => Some(vec!["FL", "FR", "BC"]),
            "4.0" => Some(vec!["FL", "FR", "FC", "BC"]),
            "quad" => Some(vec!["FL", "FR", "BL", "BR"]),
            "quad(side)" => Some(vec!["FL", "FR", "SL", "SR"]),
            "5.0" => Some(vec!["FL", "FR", "FC", "BL", "BR"]),
            "5.0(side)" => Some(vec!["FL", "FR", "FC", "SL", "SR"]),
            "5.1" => Some(vec!["FL", "FR", "FC", "LFE", "BL", "BR"]),
            "5.1(side)" => Some(vec!["FL", "FR", "FC", "LFE", "SL", "SR"]),
            "6.0" => Some(vec!["FL", "FR", "FC", "BC", "SL", "SR"]),
            "6.1" => Some(vec!["FL", "FR", "FC", "LFE", "BC", "SL", "SR"]),
            "7.0" => Some(vec!["FL", "FR", "FC", "BL", "BR", "SL", "SR"]),
            "7.1" => Some(vec!["FL", "FR", "FC", "LFE", "BL", "BR", "SL", "SR"]),
            "7.1(wide)" => Some(vec!["FL", "FR", "FC", "LFE", "BL", "BR", "FLC", "FRC"]),
            "7.1(wide-side)" => Some(vec!["FL", "FR", "FC", "LFE", "FLC", "FRC", "SL", "SR"]),
            "downmix" => Some(vec!["DL", "DR"]),
            _ => None,
        }
    };
    match av {
        Some(ch) if ch.len() as u64 == n => {
            // In a 5.1 the back pair IS the surround pair (Ls/Rs); only when a layout
            // has BOTH back and side pairs (7.1) is the back pair the rear surround.
            let has_side = ch.iter().any(|c| *c == "SL" || *c == "SR");
            let one = n == 1;
            ch.iter().map(|c| match *c {
                "FL" => "L", "FR" => "R", "FC" => if one { "M" } else { "C" }, "LFE" | "LFE2" => "LFE",
                "SL" => "Ls", "SR" => "Rs",
                "BL" => if has_side { "Lrs" } else { "Ls" }, "BR" => if has_side { "Rrs" } else { "Rs" },
                "BC" => "Cs", "FLC" => "Lc", "FRC" => "Rc",
                "DL" => "Lt", "DR" => "Rt",                       // CoreAudio LeftTotal / RightTotal
                "WL" => "Lw", "WR" => "Rw", "TFL" => "Ltf", "TFR" => "Rtf", "TFC" => "Ctf",
                "TBL" => "Ltr", "TBR" => "Rtr", "TBC" => "Ctr", "TC" => "Tc", "TSL" => "Ltm", "TSR" => "Rtm",
                other => other,
            }.to_string()).collect()
        }
        _ => (1..=n.max(1)).map(|i| format!("ch{i}")).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn depths() {
        let s = json!({});
        assert_eq!(bit_depth("yuv422p10le", &s), 10);
        assert_eq!(bit_depth("yuv420p", &s), 8);
        assert_eq!(bit_depth("rgb48le", &s), 16);
        assert_eq!(bit_depth("gbrpf32le", &s), 32);
        assert_eq!(bit_depth("yuv444p12le", &s), 12);
        assert_eq!(bit_depth("gbrp10le", &s), 10);
        assert_eq!(bit_depth("rgba64le", &s), 16);
        assert_eq!(bit_depth("rgb24", &s), 8);
        assert_eq!(bit_depth("gray16le", &s), 16);
    }
    #[test] fn tc() {
        assert_eq!(timecode(1.0, 24.0), "00:00:01:00");
        assert_eq!(timecode(3661.5, 24.0), "01:01:01:12");
        assert_eq!(timecode(10.0, 23.976), "00:00:10:00");   // 239.76 → 240 frames, counted at nominal 24
    }
    #[test] fn scan() {
        let field = |f: &str| { let mut o = Map::new(); video(&mut o, &json!({ "field_order": f }), &json!({}), false); o.get("scan").and_then(|v| v.as_str()).map(str::to_string) };
        assert_eq!(field("progressive").as_deref(), Some("progressive"));
        assert_eq!(field("tt").as_deref(), Some("interlaced (TFF)"));
        assert_eq!(field("bt").as_deref(), Some("interlaced (TFF)"));
        assert_eq!(field("bb").as_deref(), Some("interlaced (BFF)"));
        assert_eq!(field("tb").as_deref(), Some("interlaced (BFF)"));
        assert_eq!(field("unknown"), None);
    }
    #[test] fn bitrate_is_the_streams_own_or_nothing() {
        let mut o = Map::new();
        video(&mut o, &json!({}), &json!({ "bit_rate": "123456" }), false);
        assert!(!o.contains_key("video_bitrate"));
        video(&mut o, &json!({ "bit_rate": "220000000" }), &json!({}), false);
        assert_eq!(o["video_bitrate"], 220000000u64);
    }
    #[test] fn labels() {
        assert_eq!(channel_labels("5.1", 6), vec!["L", "R", "C", "LFE", "Ls", "Rs"]);
        assert_eq!(channel_labels("5.1(side)", 6), vec!["L", "R", "C", "LFE", "Ls", "Rs"]);
        assert_eq!(channel_labels("7.1", 8), vec!["L", "R", "C", "LFE", "Lrs", "Rrs", "Ls", "Rs"]);
        assert_eq!(channel_labels("mono", 1), vec!["M"]);
        assert_eq!(channel_labels("stereo", 6), vec!["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"]);
        // per-track `chan` atoms, as ffprobe reports them
        assert_eq!(channel_labels("1 channels (DL)", 1), vec!["Lt"]);
        assert_eq!(channel_labels("1 channels (FC)", 1), vec!["M"]);
        assert_eq!(channel_labels("1 channels (LFE)", 1), vec!["LFE"]);
        assert_eq!(channel_labels("2 channels (FL+FR)", 2), vec!["L", "R"]);
        assert_eq!(channel_labels("", 2), vec!["ch1", "ch2"]);
    }
}
