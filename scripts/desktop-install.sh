#!/usr/bin/env bash
# Build the desktop client (Linux) in release mode and install it for THIS user,
# with an entry in the applications menu and an icon. No root, no package.
#
#   scripts/desktop-install.sh                 build, then install
#   scripts/desktop-install.sh --no-build      install what target/release already has
#   scripts/desktop-install.sh --desktop-icon  also put a launcher in ~/Desktop
#   scripts/desktop-install.sh --uninstall     remove everything this script installed
#
# Where things go (override the first with SPATIALDB_PREFIX):
#   ~/.local/opt/spatialdb/spatialdb-desktop    the binary
#   ~/.local/share/applications/spatialdb-desktop.desktop
#   ~/.local/share/icons/hicolor/<size>/apps/spatialdb-desktop.png
#
# WEBKIT_DISABLE_DMABUF_RENDERER=1 (the blank-window fix on NVIDIA / X11) is set
# twice over: the binary defaults it on Linux (src-tauri/src/main.rs), and the menu
# entry sets it explicitly, so the launcher works whatever the binary does later.
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
  echo "removed. Your settings (~/.config/org.spatialdb.desktop) and the app's data were left alone."
  exit 0
fi

if [ "$build" = 1 ]; then
  echo "building (release)…"
  ( cd "$root/src-tauri" && cargo build --release )
fi

[ -x "$release/$name" ] || { echo "no $release/$name — build first (drop --no-build)" >&2; exit 1; }

# A folder left by the CEF branch's installer holds Chromium's files; clear it so
# this one contains exactly what this build needs.
rm -rf "$prefix"
mkdir -p "$prefix"
cp "$release/$name" "$prefix/"

src="$root/src-tauri/icons"
install -Dm644 "$src/32x32.png"      "$icons/32x32/apps/$name.png"
install -Dm644 "$src/128x128.png"    "$icons/128x128/apps/$name.png"
install -Dm644 "$src/128x128@2x.png" "$icons/256x256/apps/$name.png"
install -Dm644 "$src/icon.png"       "$icons/512x512/apps/$name.png"

# StartupWMClass ties the running window to this entry (dock icon, pinning). If the
# dock shows a generic icon instead, `xprop WM_CLASS` on the window says what it
# should be.
mkdir -p "$apps"
cat > "$apps/$name.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=spatialdb
Comment=spatialdb desktop client
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 "$prefix/$name"
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

echo "installed: $prefix/$name"
echo "menu entry: $apps/$name.desktop — look for \"spatialdb\" in the applications menu."
