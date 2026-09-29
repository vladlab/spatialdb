# The desktop client

The web app in a native window, plus the TOOLS that need a real machine. It lives
in `src-tauri/` (Tauri 2, Rust) and `src/client/desktop.ts` + `src/client/tools/`
(the web app's side). Design and reasons: `TAURI-HANDOFF.md`; the wire contract:
API.md "Tools".

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
  `classify`, `analyze(unit, analyzer)` — the analyzer named by id from the closed
  set — and `reveal`.
- **Reads only what you dropped.** `classify` and `analyze` accept a
  path only if it — or a folder containing it — was dropped onto the window this
  session (`Allowed`). So the served JavaScript, even from a compromised server,
  cannot probe or hash arbitrary files. `reveal` takes any path (it selects a file in
  the file manager and executes nothing). There is deliberately no "open with the
  default app" command: `xdg-open` on the wrong file runs it.
- **File drop** (the first tool): drop files or folders onto an open table, or onto a
  canvas. What it writes is the table's RECIPE — ⚙ Table settings → Desktop tools —
  an ordered list of steps, each an ANALYZER (`filesystem`, `sequence`, `imf`,
  `ffprobe`, a hash…), what it runs on, and which outputs go to which fields. The
  editor shows the same recipe three ways: Steps, JSON, and a Summary in sentences
  ("If video or audio: ffprobe 7.1 → Width → Width"), so whoever reads it in a year
  can tell where every value came from. `contract/tools.ts` is the reference;
  `src/client/tools/fileDrop.ts` runs it.
- **Show in folder**: a `⤴ show` button beside every `file_path` value in the record
  panel.

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
- **macOS**: `cargo tauri build` on a Mac produces the `.app`/`.dmg`; unsigned, so
  Gatekeeper needs a right-click → Open the first time.
- **Icons**: `src-tauri/icons/` holds placeholders. `npx @tauri-apps/cli icon
  some-1024px.png` generates the full set (including `.icns`/`.ico` for macOS/Windows,
  which `tauri.conf.json` does not list yet).

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
8. Then the things nobody has looked at: the setup page's look, the drop overlay, the
   notices strip, the `probing…` marker in the record panel.
