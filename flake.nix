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
