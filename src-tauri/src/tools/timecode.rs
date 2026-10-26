//! Timecode labels from frame numbers — a port of the two functions of
//! `src/contract/timecode.ts` the Resolve tool needs (`labelToTc`, `framesToTc`),
//! tested against the same cases. The TypeScript file is the reference: it explains
//! label frames vs real frames, and why drop-frame skips labels.
//!
//! Resolve numbers a timeline's frames from 00:00:00:00 at the timeline's rate —
//! REAL frames: at 29.97 DF, 01:00:00;00 is frame 107892, not 108000. So a label is
//! `frames_to_tc(n)`, and a length (non-drop, how ffprobe's Duration reads) is
//! `label_to_tc(n, …, false)`.

/// The nominal rate labels count at: 24 for 23.976, 30 for 29.97.
fn fps(rate: f64) -> i64 { rate.round() as i64 }
/// Labels skipped at the top of each minute (except every tenth): 2 at 29.97, 4 at 59.94.
fn drop_per_minute(fps: i64) -> i64 { (fps as f64 / 15.0).round() as i64 }
/// Drop-frame exists only at 29.97 and 59.94.
pub fn can_drop(rate: f64) -> bool { (rate - 29.97).abs() < 0.005 || (rate - 59.94).abs() < 0.005 }

/// The timecode of a label-frame count. Wraps at 24 hours; ';' before the frames at a drop base.
pub fn label_to_tc(label: i64, rate: f64, drop: bool) -> String {
    let fps = fps(rate).max(1);
    let day = 24 * 3600 * fps;
    let n = label.rem_euclid(day);
    let (f, s, m, h) = (n % fps, (n / fps) % 60, (n / (fps * 60)) % 60, n / (fps * 3600));
    format!("{h:02}:{m:02}:{s:02}{}{f:02}", if drop { ';' } else { ':' })
}

/// The label of REAL frame `n` — the inverse of the TypeScript `tcToFrames`.
pub fn frames_to_tc(n: i64, rate: f64, drop: bool) -> String {
    if !drop || !can_drop(rate) { return label_to_tc(n, rate, false); }
    let fps = fps(rate);
    let d = drop_per_minute(fps);
    let per10 = fps * 600 - d * 9;
    let per_min = fps * 60 - d;
    let day = per10 * 6 * 24;
    let mut f = n.rem_euclid(day);
    let tens = f / per10;
    let rest = f % per10;
    f += d * 9 * tens + if rest >= d { d * ((rest - d) / per_min) } else { 0 };
    label_to_tc(f, rate, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    // The cases test/videolayout.ts holds contract/timecode.ts to.
    #[test] fn non_drop_labels() {
        assert_eq!(label_to_tc(86400, 23.976, false), "01:00:00:00");
        assert_eq!(frames_to_tc(86400, 24.0, false), "01:00:00:00");
        assert_eq!(frames_to_tc(90000, 25.0, false), "01:00:00:00");
        assert_eq!(label_to_tc(-1, 24.0, false), "23:59:59:23", "wraps at 24 hours, as timecode does");
    }
    #[test] fn drop_frame_labels() {
        assert_eq!(frames_to_tc(107892, 29.97, true), "01:00:00;00", "one hour of 29.97 DF is 107,892 real frames");
        assert_eq!(frames_to_tc(1799, 29.97, true), "00:00:59;29");
        assert_eq!(frames_to_tc(1800, 29.97, true), "00:01:00;02", "frames 00 and 01 of minute 1 are skipped");
        assert_eq!(frames_to_tc(17982, 29.97, true), "00:10:00;00", "…but not of minute 10");
        assert_eq!(frames_to_tc(215784, 59.94, true), "01:00:00;00", "59.94 DF skips four");
    }
    #[test] fn drop_is_ignored_where_it_cannot_exist() {
        assert_eq!(frames_to_tc(86400, 23.976, true), "01:00:00:00");
    }
    /// Round trip against an independent count: walk every real frame of 12 minutes
    /// of 29.97 DF, advancing a label by hand and skipping the dropped ones.
    #[test] fn drop_frame_walks_like_a_clock() {
        let (mut h, mut m, mut s, mut f) = (0i64, 0i64, 0i64, 0i64);
        for n in 0..(12 * 60 * 30) {
            assert_eq!(frames_to_tc(n, 29.97, true), format!("{h:02}:{m:02}:{s:02};{f:02}"), "real frame {n}");
            f += 1;
            if f == 30 { f = 0; s += 1; }
            if s == 60 { s = 0; m += 1; }
            if m == 60 { m = 0; h += 1; }
            if s == 0 && f == 0 && m % 10 != 0 { f = 2; }
        }
    }
}
