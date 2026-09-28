{
  description = "spatialdb — a relational database with a manual canvas view";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    # A CURRENT Rust for the desktop client only. nixos-24.11's Cargo is 1.82, and
    # Cargo.lock (resolved with 1.91) carries crates on the 2024 edition, which
    # needs Cargo ≥ 1.85 — the exact error of the first `nix develop .#desktop`.
    # Same input viznotes uses; the server shell does not touch it.
    rust-overlay = { url = "github:oxalica/rust-overlay"; inputs.nixpkgs.follows = "nixpkgs"; };
  };

  outputs = { self, nixpkgs, rust-overlay }:
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
        # Written from viznotes' flake, which builds a Tauri 2 app on NixOS. The
        # desktop client: `nix develop .#desktop`, then `npm run desktop:dev`. The
        # Rust toolchain is rust-overlay's current stable (see inputs), not
        # nixpkgs'. ffmpeg is a RUNTIME need of the app on every workstation, not a
        # build input — it is here so `cargo run` finds it.
        desktop = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22 git (rustFor pkgs.system) cargo-tauri
            pkg-config gobject-introspection wrapGAppsHook3
            openssl libsoup_3 webkitgtk_4_1 gtk3 glib cairo pango gdk-pixbuf atk harfbuzz
            gsettings-desktop-schemas dconf xdg-utils librsvg
            glib-networking cacert
            ffmpeg
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
            # HTTPS in the webview: libsoup takes TLS from GIO modules (glib-networking),
            # which a packaged app gets from wrapGAppsHook and a bare `cargo run` does
            # not — hence "TLS support not available" on the first try. Unlike viznotes,
            # this app loads its whole UI over HTTPS, so this is not optional.
            export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
            # The trust store the webview verifies the server against. On NixOS
            # /etc/ssl/certs/ca-certificates.crt includes security.pki.certificateFiles,
            # so a Caddy-internal-CA root added there is trusted here too.
            export SSL_CERT_FILE="''${SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}"
            # WebKitGTK on Wayland/Sway: the DMA-BUF renderer is unreliable in some setups —
            # the vcompare_imf/viznotes workaround. Remove if the window renders fine.
            export WEBKIT_DISABLE_DMABUF_RENDERER=1
            echo ""
            echo "  spatialdb DESKTOP shell   (npm run desktop:dev | desktop:build | desktop:check)"
            echo "  SPATIALDB_URL=https://… overrides the configured server for this run."
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
