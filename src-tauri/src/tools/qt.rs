//! Audio TRACK NAMES from a QuickTime / MP4 file — the `trak/udta/name` atom that
//! Resolve, QuickTime Player and the owner's `qt_chan_tag_inplace.py` write
//! ("Channel 01: Left", "Channel 07: LT +12db (PL2)"), and that ffprobe does NOT
//! expose (tested against 6.1: no `title` tag appears). The channel LABELS, by
//! contrast, do reach ffprobe through the `chan` atom, as `channel_layout`
//! ("1 channels (DL)"), and probe.rs maps them.
//!
//! This reads only box headers until it finds `moov`, then the moov itself (a few
//! hundred KB at most on a mastered file; capped), never the media. An 800 GB
//! master costs the same as a 1 MB one. Sound tracks are returned in file order,
//! which is the order ffmpeg numbers their streams, so index N here is stream N
//! among the audio streams.
//!
//! Two encodings of the `name` payload exist in the wild: raw UTF-8 (what the
//! owner's script writes, and what QuickTime Player accepts) and the classic
//! "international text" form — 16-bit length, 16-bit language code, then text.
//! Both are handled; a trailing NUL is dropped.

use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

const MOOV_CAP: u64 = 64 << 20;

pub fn audio_track_names(path: &Path) -> Vec<Option<String>> {
    (|| -> Option<Vec<Option<String>>> {
        let mut f = File::open(path).ok()?;
        let len = f.metadata().ok()?.len();
        let moov = find_moov(&mut f, len)?;
        Some(parse_moov(&moov))
    })().unwrap_or_default()
}

/// Walk the top-level boxes by header alone; return the moov's bytes.
fn find_moov(f: &mut File, len: u64) -> Option<Vec<u8>> {
    let mut pos = 0u64;
    while pos + 8 <= len {
        f.seek(SeekFrom::Start(pos)).ok()?;
        let mut h = [0u8; 16];
        f.read_exact(&mut h[..8]).ok()?;
        let mut size = u32::from_be_bytes([h[0], h[1], h[2], h[3]]) as u64;
        let kind: [u8; 4] = h[4..8].try_into().ok()?;
        let mut header = 8u64;
        if size == 1 { f.read_exact(&mut h[8..16]).ok()?; size = u64::from_be_bytes(h[8..16].try_into().ok()?); header = 16; }
        else if size == 0 { size = len - pos; }
        if size < header { return None; }
        if &kind == b"moov" {
            let body = size - header;
            if body > MOOV_CAP { return None; }
            let mut buf = vec![0u8; body as usize];
            f.read_exact(&mut buf).ok()?;
            return Some(buf);
        }
        pos += size;
    }
    None
}

/// Iterate the boxes in a byte range: (type, payload).
fn boxes(data: &[u8]) -> Vec<(&[u8], &[u8])> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    while pos + 8 <= data.len() {
        let mut size = u32::from_be_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
        let kind = &data[pos + 4..pos + 8];
        let mut header = 8;
        if size == 1 {
            if pos + 16 > data.len() { break; }
            size = u64::from_be_bytes(data[pos + 8..pos + 16].try_into().unwrap()) as usize; header = 16;
        } else if size == 0 { size = data.len() - pos; }
        if size < header || pos + size > data.len() { break; }
        out.push((kind, &data[pos + header..pos + size]));
        pos += size;
    }
    out
}

fn child<'a>(data: &'a [u8], kind: &[u8]) -> Option<&'a [u8]> { boxes(data).into_iter().find(|(k, _)| *k == kind).map(|(_, p)| p) }

fn parse_moov(moov: &[u8]) -> Vec<Option<String>> {
    boxes(moov).into_iter().filter(|(k, _)| *k == b"trak").filter_map(|(_, trak)| {
        let mdia = child(trak, b"mdia")?;
        let hdlr = child(mdia, b"hdlr")?;
        if hdlr.len() < 12 || &hdlr[8..12] != b"soun" { return None; }
        Some(child(trak, b"udta").and_then(|u| child(u, b"name")).and_then(decode_name))
    }).collect()
}

/// Raw UTF-8 (possibly NUL-terminated), or `u16 length, u16 language, text`.
fn decode_name(p: &[u8]) -> Option<String> {
    let text = |b: &[u8]| { let b = b.strip_suffix(&[0]).unwrap_or(b); let s = String::from_utf8_lossy(b).trim().to_string(); if s.is_empty() { None } else { Some(s) } };
    if p.len() >= 4 {
        let n = u16::from_be_bytes([p[0], p[1]]) as usize;
        if n > 0 && n + 4 <= p.len() && p[4..4 + n].iter().all(|b| *b >= 0x20 || *b == 0) && !(p[0].is_ascii_graphic() && p[1].is_ascii_graphic()) {
            return text(&p[4..4 + n]);
        }
    }
    text(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bx(kind: &[u8], payload: &[u8]) -> Vec<u8> { let mut v = ((8 + payload.len()) as u32).to_be_bytes().to_vec(); v.extend_from_slice(kind); v.extend_from_slice(payload); v }
    fn trak(handler: &[u8], name: Option<&[u8]>) -> Vec<u8> {
        let mut hdlr = vec![0u8; 8]; hdlr.extend_from_slice(handler); hdlr.extend_from_slice(&[0; 12]);
        let mut t = bx(b"mdia", &bx(b"hdlr", &hdlr));
        if let Some(n) = name { t.extend(bx(b"udta", &bx(b"name", n))); }
        bx(b"trak", &t)
    }
    #[test] fn names_in_order_sound_tracks_only() {
        let mut moov = trak(b"vide", Some(b"Video Track\0"));
        moov.extend(trak(b"soun", Some(b"Channel 01: Left\0")));
        moov.extend(trak(b"soun", None));
        moov.extend(trak(b"soun", Some(&[0x00, 0x06, 0x00, 0x00, b'S', b't', b'e', b'r', b'e', b'o'])));   // international text form
        assert_eq!(parse_moov(&moov), vec![Some("Channel 01: Left".to_string()), None, Some("Stereo".to_string())]);
    }
    #[test] fn raw_text_starting_with_letters_is_not_misread_as_a_length() {
        assert_eq!(decode_name(b"Channel 07: LT +12db (PL2)\0").as_deref(), Some("Channel 07: LT +12db (PL2)"));
        assert_eq!(decode_name(b""), None);
    }
}

#[cfg(test)]
mod real_file {
    // Runs only when a tagged MOV exists (made by qt_chan_tag_inplace.py in a
    // sandbox); skipped otherwise, so CI without ffmpeg stays green.
    #[test] fn tagged_mov_end_to_end() {
        let path = std::path::Path::new("/tmp/tagtest/t.mov");
        if !path.exists() { return; }
        let names = super::audio_track_names(path);
        assert_eq!(names, vec![Some("Channel 01: LT +12db (PL2)".to_string()), Some("Channel 02: RT +12db (PL2)".to_string())]);
        let unit = crate::tools::classify::classify(&[path.to_path_buf()]).remove(0);
        let probed = crate::tools::probe::probe(&unit).unwrap();
        let layout = &probed.outputs["audio_layout"];
        assert_eq!(layout["tracks"][0]["name"], "Channel 01: LT +12db (PL2)");
        assert_eq!(layout["tracks"][0]["channels"][0], "Lt");
        assert_eq!(layout["tracks"][1]["channels"][0], "Rt");
        assert_eq!(layout["tracks"][0]["language"], "eng");
        assert_eq!(probed.outputs["audio_channels"], 2);
        assert_eq!(probed.outputs["audio_stream_count"], 2);
        eprintln!("{}", serde_json::to_string_pretty(layout).unwrap());
    }
}
