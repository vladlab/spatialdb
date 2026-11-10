#!/usr/bin/env bash
# Build the desktop client (CEF branch, Linux) in release mode and install it for
# THIS user, with an entry in the applications menu and an icon. No root, no
# packaging: this is "make it launchable" until CEF-BRIEF.md C4 (real packages).
#
#   scripts/desktop-install.sh                 build, then install
#   scripts/desktop-install.sh --no-build      install what target/release already has
#   scripts/desktop-install.sh --desktop-icon  also put a launcher in ~/Desktop
#   scripts/desktop-install.sh --uninstall     remove everything this script installed
#
# Where things go (override the first with SPATIALDB_PREFIX):
#   ~/.local/opt/spatialdb/                     the binary and Chromium's files, together
#   ~/.local/share/applications/spatialdb-desktop.desktop
#   ~/.local/share/icons/hicolor/<size>/apps/spatialdb-desktop.png
#
# The binary looks for libcef.so and Chromium's resources NEXT TO ITSELF (rpath
# $ORIGIN), so the folder must stay together; the menu entry points at it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefix="${SPATIALDB_PREFIX:-$HOME/.local/opt/spatialdb}"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
name="spatialdb-desktop"
release="$root/src-tauri/target/release"

build=1; desktop_icon=0; uninstall=0
for a in "$@"; do
  case "$a" in
    --no-build) build=0 ;;
    --desktop-icon) desktop_icon=1 ;;
    --uninstall) uninstall=1 ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

desktop_dir="$(command -v xdg-user-dir >/dev/null 2>&1 && xdg-user-dir DESKTOP || echo "$HOME/Desktop")"

if [ "$uninstall" = 1 ]; then
  rm -rf "$prefix"
  rm -f "$apps/$name.desktop" "$desktop_dir/$name.desktop"
  for s in 32x32 128x128 256x256 512x512; do rm -f "$icons/$s/apps/$name.png"; done
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$apps" || true
  echo "removed. Your settings (~/.config/org.spatialdb.desktop) and Chromium profile (~/.cache/org.spatialdb.desktop) were left alone."
  exit 0
fi

if [ "$build" = 1 ]; then
  echo "building (release)…"
  ( cd "$root/src-tauri" && CEF_PATH="${CEF_PATH:-$HOME/.cache/tauri-cef}" cargo build --release )
fi

[ -x "$release/$name" ] || { echo "no $release/$name — build first (drop --no-build)" >&2; exit 1; }
[ -f "$release/libcef.so" ] || { echo "no libcef.so beside the binary in $release — is this the cef branch?" >&2; exit 1; }

# The binary, then everything Chromium needs beside it: its libraries, resource
# packs, ICU data, V8 snapshots, the Vulkan/GL pieces, the sandbox helper, locales.
# (Not the crate's own build products, which share the folder.)
mkdir -p "$prefix/locales"
cp --remove-destination "$release/$name" "$prefix/"
shopt -s nullglob
for f in "$release"/*.so "$release"/*.so.* "$release"/*.pak "$release"/*.dat "$release"/*.bin "$release"/*.json "$release"/chrome-sandbox; do
  case "$(basename "$f")" in libspatialdb_desktop_lib.*) continue ;; esac
  cp --remove-destination "$f" "$prefix/"
done
cp --remove-destination "$release"/locales/* "$prefix/locales/"
shopt -u nullglob

src="$root/src-tauri/icons"
install -Dm644 "$src/32x32.png"      "$icons/32x32/apps/$name.png"
install -Dm644 "$src/128x128.png"    "$icons/128x128/apps/$name.png"
install -Dm644 "$src/128x128@2x.png" "$icons/256x256/apps/$name.png"
install -Dm644 "$src/icon.png"       "$icons/512x512/apps/$name.png"

# StartupWMClass ties the running window to this entry (dock icon, pinning). The
# window's class is the program name; if the dock shows a generic icon instead,
# `xprop WM_CLASS` on the window says what it should be.
mkdir -p "$apps"
cat > "$apps/$name.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=spatialdb
Comment=spatialdb desktop client (Chromium)
Exec="$prefix/$name"
Icon=$name
Terminal=false
Categories=Office;Database;
StartupWMClass=$name
DESKTOP
chmod 644 "$apps/$name.desktop"

if [ "$desktop_icon" = 1 ]; then
  mkdir -p "$desktop_dir"
  install -m755 "$apps/$name.desktop" "$desktop_dir/$name.desktop"
  # GNOME/Nautilus only launch a desktop file marked trusted.
  command -v gio >/dev/null 2>&1 && gio set "$desktop_dir/$name.desktop" metadata::trusted true 2>/dev/null || true
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$apps" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$icons" 2>/dev/null || true

echo "installed: $prefix/$name ($(du -sh "$prefix" | cut -f1))"
echo "menu entry: $apps/$name.desktop — look for \"spatialdb\" in the applications menu."
