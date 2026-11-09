{
  description = "spatialdb — a relational database with a manual canvas view";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    # A CURRENT Rust for the desktop client only. nixos-24.11's Cargo is 1.82, and
    # Cargo.lock (resolved with 1.91) carries crates on the 2024 edition, which
    # needs Cargo ≥ 1.85 — the exact error of the first `nix develop .#desktop`.
    # Same input viznotes uses; the server shell does not touch it.
    rust-overlay = { url = "github:oxalica/rust-overlay"; inputs.nixpkgs.follows = "nixpkgs"; };
    # CEF branch, desktop shell only: a nixpkgs recent enough for its `cef-binary` to
    # be re-versioned the way the `cef-dll-sys` build script asks (NIX_CEF_BINARY=1,
    # see the shellHook). The server shell never touches it; nixpkgs stays 24.11.
    nixpkgs-cef.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, rust-overlay, nixpkgs-cef }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Only the desktop shell imports nixpkgs with the overlay applied.
      rustFor = system: (import nixpkgs { inherit system; overlays = [ (import rust-overlay) ]; }).rust-bin.stable.latest.default.override {
        extensions = [ "rust-src" "rust-analyzer" ];
      };
    in
    {
      devShells = forAllSystems (pkgs: {
        # Written from viznotes' flake; on the CEF branch the window is Chromium (CEF)
        # instead of WebKitGTK — see DESKTOP.md "The CEF branch". The desktop client:
        # `nix develop .#desktop`, then `npm run desktop:dev`. The Rust toolchain is
        # rust-overlay's current stable (see inputs), not nixpkgs'. ffmpeg is a RUNTIME
        # need of the app on every workstation, not a build input — it is here so
        # `cargo run` finds it.
        desktop = let
          # What a prebuilt Chromium dlopens or links at run time. On NixOS nothing is
          # in /usr/lib, so these go on LD_LIBRARY_PATH for `cargo run`. (With
          # NIX_CEF_BINARY=1, below, libcef itself comes patched from nixpkgs; this
          # list still covers winit's dlopen'd X11 libraries and the fallback of a
          # plain downloaded CEF.) The NVIDIA userspace is /run/opengl-driver/lib.
          runtimeLibs = with pkgs; [
            gtk4 glib cairo pango gdk-pixbuf harfbuzz graphene
            nss nspr alsa-lib cups dbus expat at-spi2-atk at-spi2-core
            libdrm mesa libGL libxkbcommon udev systemd
            xorg.libX11 xorg.libXcomposite xorg.libXdamage xorg.libXext xorg.libXfixes
            xorg.libXrandr xorg.libXcursor xorg.libXi xorg.libxcb xorg.libxshmfence
            libva pipewire
          ];
        in pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22 git (rustFor pkgs.system) cargo-tauri
            pkg-config gobject-introspection wrapGAppsHook4
            # cef-dll-sys builds CEF's C++ wrapper library with CMake + Ninja.
            cmake ninja
            openssl gsettings-desktop-schemas dconf xdg-utils librsvg
            # The native "read this file?" dialog on Linux (Cargo.toml, tauri-plugin-dialog).
            zenity
            # certutil: trusting the Caddy internal CA in Chromium (DESKTOP.md, TLS).
            nssTools
            ffmpeg
          ] ++ runtimeLibs;
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk4}/share/gsettings-schemas/${pkgs.gtk4.name}:$XDG_DATA_DIRS"
            export LD_LIBRARY_PATH="/run/opengl-driver/lib:${pkgs.lib.makeLibraryPath runtimeLibs}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            # The CEF distribution: built from nixpkgs' cef-binary (patched for NixOS)
            # at the version the cef-dll-sys crate wants, instead of a plain download
            # whose libcef.so cannot find its libraries here. The build script runs
            # `nix-build` on its own expression, which imports <nixpkgs> — pinned to
            # this flake's nixpkgs-cef input. `unset NIX_CEF_BINARY` to fall back to
            # the plain download (LD_LIBRARY_PATH above is meant to cover it).
            export NIX_CEF_BINARY=1
            export NIX_PATH="nixpkgs=${nixpkgs-cef}"
            # Where the CEF distribution lands, once per CEF version (not per clean build).
            export CEF_PATH="''${CEF_PATH:-$HOME/.cache/tauri-cef}"
            echo ""
            echo "  spatialdb DESKTOP shell — CEF branch   (npm run desktop:dev | desktop:build | desktop:check)"
            echo "  SPATIALDB_URL=https://… overrides the configured server for this run."
            echo "  SPATIALDB_CEF_ARGS=\"--switch …\" passes Chromium switches; SPATIALDB_LOG=info shows more."
            echo "  First build: CEF (~1 GB) into $CEF_PATH."
            echo ""
          '';
        };

        default = pkgs.mkShell {
          packages = with pkgs; [
            postgresql_16   # server + psql/initdb/pg_ctl, pinned so everyone matches
            nodejs_22
            git
          ];

          # The flake stays deliberately thin: it puts tools on PATH and sets
          # environment. All actual behaviour lives in ./scripts/db.sh, which
          # means it can be tested and used without Nix.
          shellHook = ''
            export PROJECT_ROOT="$PWD"
            export PGDATA="$PWD/.pg/data"
            export PGDATABASE="spatialdb"
            export PGUSER="postgres"

            # The socket lives OUTSIDE the project. `nix develop` copies the
            # source tree into the Nix store, which cannot hold a Unix socket:
            #   error: file '.../.pg/socket/.s.PGSQL.5432' has an unsupported type
            # A running database would otherwise make the project impossible to
            # enter. Must match default_socket_dir() in scripts/db.sh.
            export PGHOST="''${XDG_RUNTIME_DIR:-/tmp}/spatialdb-$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)"
            mkdir -p "$PGHOST"

            # Socket-only, so there is never a port fight with a Postgres you
            # already run. PGHOST makes bare `psql` work with no arguments.
            export DB_URL="postgresql://postgres@/spatialdb?host=$PGHOST"

            export PATH="$PWD/scripts:$PWD/node_modules/.bin:$PATH"
            chmod +x "$PWD/scripts/"*.sh 2>/dev/null || true

            echo ""
            echo "  spatialdb dev shell"
            echo ""
            echo "    db.sh start      postgres up + migrations   (db.sh stop|reset|psql|seed)"
            echo "    npm run dev      api :8787 + client :5173"
            echo "    npm test         end-to-end suite"
            echo ""
            if [ ! -d node_modules ]; then
              echo "  first run: npm install"
              echo ""
            fi
            if [ ! -d .git ]; then
              echo "  note: not a git repo — Nix copies the ENTIRE directory"
              echo "        into the store on every enter. 'git init' makes it"
              echo "        respect .gitignore and enter much faster."
              echo ""
            fi
          '';
        };
      });
    };
}
