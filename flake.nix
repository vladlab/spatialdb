{
  description = "spatialdb — a relational database with a manual canvas view";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # UNVERIFIED on a real NixOS machine — written from viznotes' flake, which
        # builds a Tauri 2 app on NixOS. The desktop client: `nix develop .#desktop`,
        # then `npm run desktop:dev`. The Rust toolchain is nixpkgs' (Tauri 2 needs
        # ≥ 1.77.2; nixos-24.11 ships 1.82). ffmpeg is a RUNTIME need of the app on
        # every workstation, not a build input — it is here so `cargo run` finds it.
        desktop = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22 git cargo rustc rustfmt clippy cargo-tauri
            pkg-config gobject-introspection wrapGAppsHook3
            openssl libsoup_3 webkitgtk_4_1 gtk3 glib cairo pango gdk-pixbuf atk harfbuzz
            gsettings-desktop-schemas dconf xdg-utils librsvg
            ffmpeg
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
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
