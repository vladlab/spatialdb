# Bundled ffprobe (optional)

The desktop app finds ffprobe in this order: `SPATIALDB_FFPROBE`, **a copy bundled
next to the app's executable**, `PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`,
`/opt/local/bin`, `/run/current-system/sw/bin`, `/usr/bin`
(`src-tauri/src/tools/probe.rs`, `ffprobe_path`). A Mac app launched from the Finder
does not see the shell's PATH, so for Macs the bundled copy is the reliable one.

To bundle, put a **static** ffprobe here named for the build target, then build with
the extra config:

    binaries/ffprobe-aarch64-apple-darwin      # Apple Silicon build
    binaries/ffprobe-x86_64-apple-darwin       # Intel build
    binaries/ffprobe-universal-apple-darwin    # --target universal-apple-darwin
                                               #   (lipo -create the two above)
    binaries/ffprobe-x86_64-unknown-linux-gnu  # a Linux build, if ever wanted

    cargo tauri build --config tauri.bundle-ffprobe.conf.json [--target …]

Tauri copies it into the bundle (`spatialdb.app/Contents/MacOS/ffprobe`, suffix
dropped) and signs it with the app. It must be STATIC — Homebrew's ffprobe links
against Homebrew's libraries and will not run on a Mac without them
(`otool -L ffprobe` should list only /usr/lib and /System paths).

Only ffprobe is used; the app never runs ffmpeg itself.

The binaries are not committed (see .gitignore): they are large, per-platform, and
their licence depends on how they were built.
