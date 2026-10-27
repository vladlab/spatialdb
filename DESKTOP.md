# The desktop client

The web app in a native window, plus the TOOLS that need a real machine. It lives
in `src-tauri/` (Tauri 2, Rust) and `src/client/desktop.ts` + `src/client/tools/`
(the web app's side). Design and reasons: `TAURI-HANDOFF.md`; the wire contract:
API.md "Tools".

> **Oct 15, 2026 — unverified:** `analyze_path` and its dialog (tauri-plugin-dialog
> is a new dependency, resolved into Cargo.lock), the per-file `hash.rs` and md5,
> and probe.rs's renamed raw outputs were written without a Tauri build environment:
> the tool modules compile and pass their unit tests on their own, `lib.rs` has not
> been compiled. Run `npm run desktop:check` first.
>
> **Verified / not verified.** `cargo check` and `cargo test` pass (Tauri 2.12,
> Rust 1.91) and `test/filedrop.ts` runs the whole drop pipeline through the real app
> and server with the native shell FAKED. Nobody has yet opened the Tauri window:
> the first-run page, the runtime capability for the server origin, the drag-drop
> stream and its coordinate scaling, `reveal`, and every `classify`/`probe` against
> real files are unverified until you run it. The Nix shell was run once
> (Sept 27) and failed on nixos-24.11's Cargo 1.82 being too old for the lockfile;
> the fix — rust-overlay's current stable, as viznotes uses — is not yet confirmed. See "Needs eyes" at the end.

## What it does

- **Loads the app from the server** — there is no bundled copy of the Vue app, so
  the desktop and the browser always run the same build (DEPLOY.md). The only page
  in the binary is `src-tauri/setup/index.html`, asking which server to use, once.
- **Grants native calls to that one origin.** The capability is added at runtime
  (`grant` in `src-tauri/src/lib.rs`) for exactly the configured server; the
  bundled setup page has its own, smaller one (`capabilities/setup.json`).
- **Six fixed-purpose commands**, arguments built in Rust, never taken from the
  page: `tools_available` (the handshake: version, and every analyzer with the
  version of the program it runs), `server_url`, `set_server` (setup page only),
  `classify`, `analyze(unit, analyzer, job?)` — the analyzer named by id from the
  closed set — `analyze_path(path, analyzer, job?)` (a recipe's MANUAL step run
  from a record, such as an md5, and the fingerprint run), `hash_cancel(job)`,
  `allow_paths(paths, why)` and `reveal` — and, for the Resolve tool,
  `resolve_timelines` and `resolve_read(timeline?)` (below). A hash given a `job` id reports
  `hash-progress` events (bytes done) under it and can be cancelled between
  chunks; the page's hash line (`client/tools/hashJobs.ts`) runs one at a time
  and the sidebar footer's strip shows it.
- **Reads only what you dropped.** `classify` and `analyze` accept a
  path only if it — or a folder containing it — was dropped onto the window this
  session (`Allowed`). So the served JavaScript, even from a compromised server,
  cannot probe or hash arbitrary files. `analyze_path` takes a record's path, which
  the page supplies, so for a file not under something dropped this session it
  first asks in a NATIVE dialog (tauri-plugin-dialog — the page cannot draw or
  answer it), and a yes allows that path for the rest of the session; `allow_paths`
  asks the same for a whole batch in ONE dialog (the fingerprint run from the
  footer, which would otherwise be a dialog per file). `reveal` takes any path (it selects a file in
  the file manager and executes nothing). There is deliberately no "open with the
  default app" command: `xdg-open` on the wrong file runs it.
- **File drop** (the first tool): drop files or folders onto an open table, or onto a
  canvas. A file whose path is already a record is skipped and offered to open, never
  updated behind your back; to update a record with a file, drop the file ONTO it —
  a card, or a grid row — where a ring and a label say which record. The file is
  compared with the record by its FINGERPRINT (an xxh3 kept in the manifest, taken at
  every drop): same bytes at another path → the path follows; different bytes →
  "Replace file info?" first. (TAURI-HANDOFF.md §5.2–3; `contract/fingerprint.ts`.)
  What it writes is the table's RECIPE — ⚙ Table settings → Desktop tools —
  an ordered list of steps, each an ANALYZER (`filesystem`, `sequence`, `imf`,
  `ffprobe`, a hash…), what it runs on, and which outputs go to which fields. The
  editor shows the same recipe three ways: Steps, JSON, and a Summary in sentences
  ("If video or audio: ffprobe 7.1 → Width → Width"), so whoever reads it in a year
  can tell where every value came from. `contract/tools.ts` is the reference;
  `src/client/tools/fileDrop.ts` runs it. The canonical outputs (Container, Codec,
  Audio codec, Primaries, Transfer, Matrix) are looked up in the built-in lists
  (`VOCABULARIES.md`, generated from `contract/vocab.ts`) and may land in a select
  bound to the list, a text field, or a LINK to a vocabulary table you keep
  (Containers, Codecs: a Name and an Aliases column) — the drop links the row named
  that way, or one whose aliases say so, and tells you the spelling to add when none
  does (API.md "Vocabulary tables"). `Raw dump` keeps everything ffprobe said, as
  JSON, for a long-text field — single files only.
- **Show in folder**: a `⤴ show` button beside every `file_path` value in the record
  panel.
- **Resolve timeline** (the second tool, Oct 26; RESOLVE-BRIEF.md): switch it on in
  ⚙ Table settings → Desktop tools and map its outputs to fields; then right-click a
  record — a grid row, a canvas card, a kanban card — → **Ingest info from
  Resolve…**, pick the timeline (the current one is preselected) → Read. What was
  read is written onto that record as mapped — one batch, one Ctrl+Z, "via Resolve
  timeline" in History. A record that already holds different values gets ONE
  dialog first, listing each field old → new: Overwrite / Cancel, all or nothing.
  The Audio layout is derived from the tracks (contract/shapes.ts
  `layoutFromTimeline`). **Audio files** links the clips' files — matched by EXACT
  absolute path against the target table's Path column (the one its own File drop
  maps) — into the link field you map it to; the owner maps it to his general
  **Inputs**. It only ever ADDS links: a link you made by hand is never removed.
  Instead, any linked file that is AUDIO (the target table's Media column, else the
  extension) and is NOT on the timeline as last read is MARKED with a ⚠ — on its
  pill, and on the field as a whole in the grid cell, the tray row and the card —
  with the reason as the tooltip (contract/resolveLinks.ts). Derived live, never
  stored: relink or re-ingest and it updates itself. A clip path with no File
  record is a notice ("not linked — no record of Files at /mnt/…"); none is created.

## The Resolve tool: how it talks to Resolve

The shell runs the host's **`python3`** (first on `PATH`; then /usr/bin, /usr/local/bin,
/opt/homebrew/bin) on a script compiled into the app
(`src-tauri/src/tools/resolve_read.py`, fed on stdin — nothing written to disk,
nothing from the server). The script imports Resolve's own `DaVinciResolveScript`
module and asks the running Resolve; it only reads.

| | scripting folder (holds `Modules/`) | library |
|---|---|---|
| Linux (Rocky) | `/opt/resolve/Developer/Scripting` | `/opt/resolve/libs/Fusion/fusionscript.so` |
| macOS | `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting` | `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so` |
| override (wins) | `SPATIALDB_RESOLVE_API` | `SPATIALDB_RESOLVE_LIB` |

Resolve must be running with **Preferences → System → General → External scripting
using: Local** (Studio). A modal dialog open in Resolve blocks its scripting: the
read gives up after 30 s (the list) / 120 s (a timeline) and says so. The handshake
reports the `resolve` analyzer as python3's version when python3 and the library are
both found — Table settings shows it ("runs python3 3.11.5") — without talking to
Resolve; Resolve's own version is shown in the picker.

To try the script without the app (what the shell runs, exactly):

```bash
cd src-tauri/src/tools
PYTHONPATH=/opt/resolve/Developer/Scripting/Modules RESOLVE_SCRIPT_LIB=/opt/resolve/libs/Fusion/fusionscript.so \
  python3 - list < resolve_read.py
PYTHONPATH=… RESOLVE_SCRIPT_LIB=… python3 - read "EP101_OEV3" < resolve_read.py
```

Verified: `cargo test` runs the real script through the real python3 against a FAKE
`DaVinciResolveScript` module (src-tauri/src/tools/resolve.rs) — the plumbing, the
timeout, the error texts, the timecode labels; `test/resolveui.ts` drives the app's
side with the shell faked. NOT verified: any of it against a real Resolve — see
"Needs eyes" 8.

## Running it

Every workstation needs `ffprobe`/`ffmpeg` on `PATH` (the host's own — nothing is
bundled). Without them files are still added, with no probe data, and the app says
so once at start.

```bash
# NixOS — from the repo
nix develop .#desktop
npm run desktop:dev                     # cargo run: opens the window
SPATIALDB_URL=https://spatialdb.example.com npm run desktop:dev   # skip the setup page

# Anything else — with Rust ≥ 1.85 (Cargo.lock has 2024-edition crates) and Tauri 2's prerequisites
cd src-tauri && cargo run
```

The app sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` itself on Linux (a blank window
with "Failed to create GBM buffer" in the terminal is that renderer failing; seen on
Fedora); export it as `0` to opt back in on a GPU where it works. If the window is
still blank, `WEBKIT_DISABLE_COMPOSITING_MODE=1` falls back further.

First run: the setup page asks for the server address and saves it to the app's
config directory (`~/.config/spatialdb/server` on Linux). `SPATIALDB_URL` in the
environment wins over the file, which is how a NixOS module can point every
workstation at the server without anyone typing it.

The window then loads `https://spatialdb.example.com/` — the same login, the same
session cookie, the same app. Nothing is different until you drag a file in.

## Building for distribution

```bash
npm run desktop:build       # cargo tauri build → src-tauri/target/release/bundle/
```

- **NixOS**: a flake package is not written yet; the dev shell's `cargo run`, or
  `appimage-run` on the AppImage, works meanwhile.
- **Fedora / Rocky**: the AppImage (or the `.rpm`) from `cargo tauri build`. viznotes'
  `build-appimage.sh` is the reference for a portable AppImage that does NOT bundle
  the GL stack — copy it across when this gets that far.
- **macOS**: see "Building a Mac app" below.
- **Icons**: `src-tauri/icons/` holds placeholders. `npx @tauri-apps/cli icon
  some-1024px.png` generates the full set (including `.icns`/`.ico` for macOS/Windows,
  which `tauri.conf.json` does not list yet).

## Building a Mac app (for colleagues)

UNVERIFIED on a real Mac as of Sept 29 — nothing here has run on macOS yet. It must
be built ON a Mac; Tauri does not cross-compile macOS bundles from Linux.

**Once per Mac:**

```bash
xcode-select --install                                  # Apple's compilers and linker
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # the second only for Intel Macs
cargo install tauri-cli --version "^2" --locked         # provides `cargo tauri`
```

**Each build**, from the repo:

```bash
cd src-tauri
# Apple Silicon only (almost every Mac bought since 2021):
SPATIALDB_DEFAULT_URL=https://spatialdb.example.com \
  cargo tauri build --target aarch64-apple-darwin --config tauri.bundle-ffprobe.conf.json
# …or one app for Apple Silicon AND Intel:
#   cargo tauri build --target universal-apple-darwin --config tauri.bundle-ffprobe.conf.json
```

- `SPATIALDB_DEFAULT_URL` bakes the house server into the build, so a colleague's
  first launch goes straight to the login page. Leave it out and they get the
  one-field setup page instead. A Mac GUI app never sees `SPATIALDB_URL`.
- `--config tauri.bundle-ffprobe.conf.json` puts ffprobe inside the app; it needs
  the binary in `src-tauri/binaries/` first (`binaries/README.md`). Leave the flag
  out to rely on each Mac's own ffprobe (Homebrew's is found even from the Finder).
- Output: `target/<target>/release/bundle/macos/spatialdb.app` and
  `…/bundle/dmg/spatialdb_0.1.0_<arch>.dmg`. Share the `.dmg`.
- `tauri.conf.json` ad-hoc signs the app (`"signingIdentity": "-"`): enough for
  Apple Silicon to run it, NOT enough for Gatekeeper to trust it (see below).
- Icons are placeholders: `cargo tauri icon a-1024px.png` makes the full set.

**On a colleague's Mac** — an unsigned app from a download, chat or email is
quarantined, and macOS says it "cannot be opened" or "is damaged":

- Copied from the house NAS over SMB it usually carries no quarantine and opens.
- Otherwise, once: try to open it, then System Settings → Privacy & Security →
  "Open Anyway" (macOS 15 removed the old right-click → Open shortcut), or in
  Terminal: `xattr -dr com.apple.quarantine /Applications/spatialdb.app`.
- If the server uses Caddy's internal CA, its root certificate goes into Keychain
  Access → System, set to "Always Trust"; a Let's Encrypt certificate needs nothing.
- The setup page's footer shows which ffprobe the app found and whether it is the
  bundled one.

To remove all of that friction: an Apple Developer account (paid, yearly) gives a
Developer ID certificate, and `cargo tauri build` can sign and notarize with it
(Tauri's "macOS code signing" guide). Worth it once more than a handful of people
use the app.

## Updating

Because the app is loaded from the server, a deploy updates every workstation on its
next reload. The binary only needs rebuilding when `src-tauri/` changes — a new
tool, a new output — and `tools_available` reports its version so the page can tell.

## Needs eyes

In the order most likely to be wrong:

1. **The window opens and shows the login page** from your HTTPS server. Seen so far
   (Sept 27): "TLS support not available" — glib-networking missing from the dev
   shell's environment; fixed by exporting `GIO_EXTRA_MODULES` in the shellHook. If
   the page is blank or shows a certificate error next: WebKitGTK does not trust the
   certificate (Caddy's internal CA needs `security.pki.certificateFiles` on NixOS /
   `update-ca-trust` on Rocky; the shell points `SSL_CERT_FILE` at the system bundle),
   or the compositing env var in the shellHook is wrong for your GPU.
2. **Native calls work from the served page**: a `⤴ show` button appears in the
   record panel on a file record, and clicking it opens the file manager. If the
   button is there but nothing happens, the runtime capability (`grant`) did not
   match the origin — `SPATIALDB_URL` and the address the page was served from must
   agree exactly (scheme, host, port).
3. **Dropping a file on the Files grid** creates a record, then fills in probe data.
   Watch the notices at bottom right. Seen (Sept 27): every drop refused as "was not
   dropped onto this window" — the allowlist listened on the WEBVIEW event, which
   never fires for a window-filling webview; it is a WINDOW event. Fixed in `lib.rs`.
4. **Drop position on a canvas**: the card should land under the pointer. If it
   lands scaled away from it, the devicePixelRatio correction in `desktop.ts` is
   wrong for your display (the viznotes lesson, unverifiable headlessly).
5. **Audio layout on a tagged master** (Sept 29): track names come from the moov's
   `trak/udta/name` atoms (`src-tauri/src/tools/qt.rs`) because ffprobe does not
   expose them; channel labels come from ffprobe's `channel_layout`, including the
   per-track custom form (`1 channels (DL)` → `Lt`) that `chan` atoms produce.
   Verified against a MOV tagged with `qt_chan_tag_inplace.py`. The house 7.1
   spelling is `L R C LFE Ls Rs Lrs Rrs` (side, then rear) — the script's,
   CoreAudio's, and since Sept 29 the `audio_layout` preset's too.
6. **Six mono WAVs dropped together** (Sept 29): the record was created, the
   ffprobe step refused — the channel set's path is the FOLDER, which nobody dropped.
   `analyze` now accepts a unit whose members were all dropped (`check_unit`), and a
   dropped frame grants its sequence's other frames. Members are listed in channel
   order (L R C LFE Ls Rs), one track per file, so a 5.1 spec compares sensibly.
7. **A folder of EXRs, an IMF folder**: one record each, with the right
   kind and manifest. `classify.rs` was written against the file naming I expect;
   your real plates will find the gaps.
8. **The Resolve tool against a real Resolve** (Oct 26 — nobody has run it yet).
   Right-click an edit → Ingest info from Resolve… → Read, and check the readout
   against the timeline: (a) the API names in `resolve_read.py` exist on your
   Resolve — a wrong one fails as "Resolve's GetTrackSubType(audio, 1) failed: …";
   (b) **Start timecode** agrees with Resolve's own (a ⚠ says so if the start
   FRAME counts to a different label — the frame-number reading would then be off);
   (c) **End timecode / Duration**: whether `GetEndFrame` is the frame after the
   last (assumed) or the last; (d) clip ends: a ⚠ counts clips whose `GetEnd` is not
   start + duration; (e) what `GetTrackSubType` says for your 5.1 / 7.1 / film /
   adaptive tracks, and the film channel orders in contract/shapes.ts
   `RESOLVE_TRACK_CHANNELS`; (f) clip paths are the absolute paths your Files
   records hold; (g) a 29.97 DF timeline. The readout's last lines show the raw
   numbers as Resolve said them, for exactly this. (Done Oct 26: the owner ran it,
   "all works so far". The readout dialog went with R4; the reader's warnings now
   arrive as notices.) Still to see with real data: the Inputs ⚠ on a mix that was
   swapped for a newer one in Resolve; a timeline whose clips live under a
   different mount than the Files records' paths (exact match: no link, a notice
   per path).
9. Then the things nobody has looked at: the setup page's look, the drop overlay, the
   notices strip, the `probing…` marker in the record panel.
