//! Stage 3, last: a fingerprint of a unit. `<algo>:<hex>` — the algorithm is IN
//! the value (contract/shapes.ts `Hash`), so xxh3 today and sha256 tomorrow can
//! coexist in one column. A multi-file unit (bundle, sequence, channel set) hashes
//! its members concatenated in manifest order, so two copies of a DCP agree.
use super::classify::Unit;
use sha2::Digest;
use std::{fs::File, io::Read};

const CHUNK: usize = 4 << 20;

enum H { X(xxhash_rust::xxh3::Xxh3), S(sha2::Sha256) }

pub fn fingerprint(unit: &Unit, algo: &str) -> Result<String, String> {
    let mut h = match algo {
        "xxh3" => H::X(xxhash_rust::xxh3::Xxh3::new()),
        "sha256" => H::S(sha2::Sha256::new()),
        other => return Err(format!("unknown hash algorithm: {other} (xxh3 or sha256)")),
    };
    let mut buf = vec![0u8; CHUNK];
    let files: Vec<&str> = if unit.members.is_empty() { vec![unit.path.as_str()] } else { unit.members.iter().map(String::as_str).collect() };
    for f in files {
        let mut file = File::open(f).map_err(|e| format!("{f}: {e}"))?;
        loop {
            let n = file.read(&mut buf).map_err(|e| format!("{f}: {e}"))?;
            if n == 0 { break; }
            match &mut h { H::X(x) => x.update(&buf[..n]), H::S(s) => s.update(&buf[..n]) }
        }
    }
    Ok(match h {
        H::X(x) => format!("xxh3:{:016x}", x.digest()),
        H::S(s) => format!("sha256:{:x}", s.finalize()),
    })
}
