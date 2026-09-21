# Deploying spatialdb on a LAN (NixOS + Caddy)

From `npm run dev` on a workstation to a real service on `vsrv`: a system Postgres,
one Node process serving the app AND the API, Caddy in front for HTTPS, reachable
from the other machines on the LAN — and from nowhere else.

> **What is verified and what is not.** Everything the APP does here is tested
> (`npm run test:prod`: serving the built frontend, cache headers, the CSP, the
> loopback bind, refusing to start with sign-in off; `npm run migrate` against a
> fresh database; `backup.sh` against a `DB_URL`). Everything about **NixOS, Caddy,
> DNS and certificates below was written without being run** — I have no NixOS
> machine, no Caddy and no domain to test against. Treat the Nix and Caddy snippets
> as a starting point from someone who knows the app well and your system not at
> all. Where you know better, you are right.

```
other LAN machine (browser, later the Tauri window)
   │  https://spatialdb.example.com        a NAME → vsrv's LAN address
   ▼
Caddy :443            TLS only. The ONLY thing the network talks to.
   │  http://127.0.0.1:8787               never leaves the machine
   ▼
node (npm start)      the API + the built frontend, ONE process, ONE version
   ▼
PostgreSQL            system service, unix socket, fsync ON
```

Two rules the rest depends on:

- **The app listens on 127.0.0.1 only** (its default; `HOST` overrides). It trusts
  what a proxy tells it — `X-Forwarded-Proto` (is the cookie `Secure`?),
  `X-Forwarded-For` (login back-off), optionally an SSO header. That is only sound if
  the proxy is the only way in. Do not set `HOST=0.0.0.0` to "make it work".
- **Migrating is an explicit step**, never a side effect of starting. The server
  answers 503 and names the pending files until you run `npm run migrate`.

---

## 0. Before you start — one question decides step 3

**How does vsrv's Caddy get certificates for your other sites today?**

- If those sites are **reachable from the internet** (ports 80/443 forwarded to vsrv)
  and Caddy issues certificates by itself → **path A** in step 3 is the least work.
- If vsrv is **LAN-only** and already uses DNS-01 or Caddy's internal CA → do the
  same again (path B or C).

If you are not sure: `curl -sI https://<one-of-your-existing-sites>` from a phone on
mobile data. An answer means "reachable from the internet".

---

## 1. Give vsrv a fixed LAN address

A DHCP reservation on the router, or a static address in NixOS. The name in step 2
points at this address; if it moves, everything stops resolving.

## 2. Namecheap: a subdomain

1. namecheap.com → sign in → **Domain List** → **Manage** beside your domain.
2. The **Advanced DNS** tab. (If it says the domain uses *custom nameservers*, your
   DNS is hosted elsewhere — Cloudflare, say — and the record is added THERE instead.
   Check under the **Domain** tab → *Nameservers*: "Namecheap BasicDNS" means here.)
3. Under **Host Records** → **Add New Record**:
   - **Type:** `A Record`
   - **Host:** `spatialdb` ← only the subdomain part, not the whole name
   - **Value:** an IP address — WHICH one depends on step 3 (see each path)
   - **TTL:** `Automatic`
4. Click the green ✓ to save. Propagation is usually minutes.
5. Check, from any machine: `dig +short spatialdb.example.com` → the address.

A record pointing at a **private** address (path B/C) exposes nothing: `192.168.x.x`
is unreachable from outside your building. The world learns a name and a useless
number. Two things can bite:

- **Your router may refuse the answer.** "DNS rebinding protection" drops public DNS
  answers containing private addresses (pfSense/OPNsense/unbound by default, some ISP
  routers). Symptom: `dig` works against `1.1.1.1` but not against your router. Fix:
  add your domain to the resolver's private-domain exceptions — or use hosts entries.
- **No internet, no lookup.** Add a hosts entry on each workstation as insurance, so
  an internal tool does not depend on an outside resolver:

  ```nix
  # NixOS workstation
  networking.hosts."192.168.1.20" = [ "spatialdb.example.com" ];
  ```
  ```
  # Rocky / anything else: /etc/hosts
  192.168.1.20  spatialdb.example.com
  ```

## 3. The certificate — pick ONE path

### Path A — vsrv's Caddy is already public and issues its own certificates

Least new machinery: no DNS API, nothing installed on workstations.

- **Step 2's Value:** vsrv's **public** IP (the same one your other sites use; or make
  the record a `CNAME` to one of those names).
- Caddy gets the certificate exactly as it does for your other sites.
- **The site must then refuse everyone who is not on the LAN** — because vsrv IS
  reachable from outside, and anyone who knows the name could otherwise reach the
  login page. That is the `@outside … abort` block in step 6. It is the whole of the
  "internal only" guarantee on this path; do not leave it out.
- LAN machines must reach vsrv by its LAN address: the **hosts entries from step 2**
  (pointing at the LAN address) do that. Without them, the name resolves to your
  public IP and only works if your router does NAT loopback ("hairpinning").
- Honest trade-off: the name is publicly visible and the endpoint exists publicly,
  refusing non-LAN clients at the door. Paths B and C expose nothing at all.

### Path B — a real certificate via DNS-01, server fully internal

Nothing reachable from outside, nothing installed on workstations. The catch is
Namecheap.

- **Step 2's Value:** vsrv's **LAN** address.
- Let's Encrypt proves you own the name by reading a temporary TXT record, written
  through your DNS provider's API. **Namecheap only enables its API if the account has
  20+ domains, OR a $50+ balance, OR $50+ spent in the last two years** — and the
  calling machine's **public IPv4 must be whitelisted** (Profile → Tools → API Access).
  A dynamic office IP makes that fragile.
- If that is a problem: move the domain's DNS hosting (not its registration) to
  Cloudflare — free, a good API, imports your existing records — and use
  `dnsProvider = "cloudflare"` below. This changes where ALL your domain's records
  live, so plan it; it is not required today.

```nix
# UNVERIFIED. NixOS fetches the certificate; Caddy is handed the files.
security.acme = {
  acceptTerms = true;
  defaults.email = "you@example.com";
  certs."spatialdb.example.com" = {
    dnsProvider = "namecheap";               # or "cloudflare"
    # A root-only file, NOT in the Nix store:
    #   NAMECHEAP_API_USER=...
    #   NAMECHEAP_API_KEY=...
    environmentFile = "/var/lib/secrets/acme-namecheap.env";
    group = "caddy";                         # so Caddy can read the key
  };
};
# and in the Caddy virtual host (step 6):  useACMEHost = "spatialdb.example.com";
```

### Path C — Caddy's own authority (quickest to a first success)

No domain mechanics at all: `tls internal` in the site block (step 6). Caddy invents
a certificate authority and signs the site's certificate itself.

- **Step 2's Value:** vsrv's LAN address (or skip DNS entirely and use hosts entries).
- Every machine must TRUST Caddy's root, or browsers show a warning. The root is at
  `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` on vsrv.
  ```nix
  # NixOS workstation (this is also the store the Tauri/WebKitGTK window uses)
  security.pki.certificateFiles = [ ./caddy-root.crt ];
  ```
  Rocky: copy to `/etc/pki/ca-trust/source/anchors/` and run `update-ca-trust`.
  Firefox and Chrome on Linux keep their OWN stores and need it imported separately.

**If you just want to see it work today:** path C (or A if it applies), click through
the browser warning once, and move to B later. Nothing in the app depends on which.

## 4. PostgreSQL — a real one

The development cluster in `.pg/` runs with `fsync=off` and belongs to your user. A
deployment uses the system service.

```nix
# UNVERIFIED.
services.postgresql = {
  enable = true;
  ensureDatabases = [ "spatialdb" ];
  ensureUsers = [{ name = "spatialdb"; ensureDBOwnership = true; }];
  # Default NixOS auth already allows a local unix-socket login as the role that
  # matches the system user ("peer") — no password, no TCP. That is what we want.
};
```

The app connects over the socket as the system user `spatialdb`:

```
DB_URL=postgres:///spatialdb?host=/run/postgresql
```

The migrations create two extensions, `pgcrypto` and `pg_trgm`. Both are *trusted*
extensions (PostgreSQL 13+), so the database's owner may create them; no superuser
needed.

## 5. The service

```nix
# UNVERIFIED. The simple first deployment: a git checkout, built in place.
users.users.spatialdb = { isSystemUser = true; group = "spatialdb"; home = "/var/lib/spatialdb"; createHome = true; };
users.groups.spatialdb = {};

systemd.services.spatialdb = {
  description = "spatialdb";
  wantedBy = [ "multi-user.target" ];
  after = [ "postgresql.service" "network.target" ];
  requires = [ "postgresql.service" ];
  path = [ pkgs.nodejs_22 pkgs.bash pkgs.git ];
  environment = {
    NODE_ENV = "production";               # serves dist/, refuses AUTH_DISABLED
    PORT = "8787";                         # HOST is left alone: 127.0.0.1
    DB_URL = "postgres:///spatialdb?host=/run/postgresql";
    SPATIALDB_ASSETS_DIR = "/var/lib/spatialdb/assets";   # uploaded images and PDFs
  };
  serviceConfig = {
    User = "spatialdb";
    WorkingDirectory = "/var/lib/spatialdb/app";
    ExecStart = "${pkgs.nodejs_22}/bin/npm run start";
    Restart = "on-failure";
    # Reasonable hardening for a service that needs only its own directory:
    NoNewPrivileges = true; PrivateTmp = true; ProtectSystem = "strict"; ProtectHome = true;
    ReadWritePaths = [ "/var/lib/spatialdb" ];
  };
};
```

First install, as the `spatialdb` user (`sudo -u spatialdb -s`, with `nodejs_22` and
`git` on the path — `nix shell nixpkgs#nodejs_22 nixpkgs#git`):

```bash
cd /var/lib/spatialdb
git clone https://github.com/vladlab/spatialdb.git app && cd app
npm ci                      # ALL dependencies: the build tools are needed to build
npm run build               # → dist/
export DB_URL='postgres:///spatialdb?host=/run/postgresql'
npm run migrate             # creates the schema (11 migrations on a fresh database)
./scripts/user.sh add you@example.com "Your Name" admin
```

then `sudo systemctl start spatialdb` and, ON vsrv:
`curl -s localhost:8787/api/health` → `{"ok":true,"version":"1.0.0+<commit>"}`.

`tsx` runs the TypeScript server directly (no compile step); it is a runtime
dependency for that reason. The eventual NixOS-native version of all this is a Nix
package that builds in the sandbox and ships only the result — you already have a
`flake.nix` to grow it from. Not needed to get going.

### Bringing your existing data across (optional)

On the machine where you have been running `npm run dev`:

```bash
./scripts/backup.sh dump          # → ~/spatialdb-backups/spatialdb-<stamp>.dump + assets/
```

Copy the `.dump` and the `assets/` folder to vsrv, then — INSTEAD of `npm run
migrate` above, into the still-empty database:

```bash
sudo -u postgres pg_restore --no-owner --role=spatialdb -d spatialdb spatialdb-<stamp>.dump
sudo -u spatialdb cp -rn assets/. /var/lib/spatialdb/assets/
sudo -u spatialdb env DB_URL='postgres:///spatialdb?host=/run/postgresql' npm run migrate   # "up to date", or applies anything newer
```

Your users come across too — but passwords only exist since migration 011, so run
`./scripts/user.sh add` (it updates an existing email) to give yourself one.

## 6. Caddy

```nix
# UNVERIFIED.
services.caddy.virtualHosts."spatialdb.example.com" = {
  # useACMEHost = "spatialdb.example.com";   # path B only
  extraConfig = ''
    # tls internal                           # path C only

    # INTERNAL ONLY. Required on path A (vsrv is reachable from outside); harmless
    # and worth keeping on B and C. `private_ranges` = 10/8, 172.16/12, 192.168/16,
    # loopback and the IPv6 equivalents. Add your Tailscale range if you use it:
    #   @outside not remote_ip private_ranges 100.64.0.0/10
    @outside not remote_ip private_ranges
    abort @outside

    # Compress — but NOT the event stream: compression buffers, and a buffered stream
    # is a live-updates feature that updates in bursts.
    @compressible not path /api/stream
    encode @compressible zstd gzip

    reverse_proxy 127.0.0.1:8787
  '';
};
```

What Caddy does by default, and the app relies on: it passes the original `Host`
(the CSRF check compares it with the browser's `Origin`), sets `X-Forwarded-Proto`
(so the session cookie is marked `Secure`) and `X-Forwarded-For`, and flushes
`text/event-stream` responses immediately. It has no request-size limit by default;
uploads go up to 500 MB (`ASSET_MAX_MB`).

The firewall already allows 443 if Caddy is serving other sites.

## 7. Check it — from the OTHER machine

1. `https://spatialdb.example.com` → the login screen, no certificate warning (paths A, B).
2. Sign in. You should STAY signed in on reload.
3. DevTools → Application → Cookies: `spatialdb_session` is **HttpOnly** and **Secure**.
4. The status word at the top right says **saved** and stays that way. Edit a cell on
   one machine and watch it appear on another within a second — that is the stream.
5. Paste a screenshot into a note — that exercises uploads through the proxy.
6. DevTools → Console: **no Content-Security-Policy errors.** (The policy was tested
   against the built files, never in a real browser.)
7. From vsrv's LAN address directly — `curl http://192.168.1.20:8787/api/health` from
   the other machine — should be **refused**. That is the loopback bind doing its job.
8. Path A only: from a phone on mobile data, the site should fail to load at all.

### If something is wrong

| Symptom | Cause |
|---|---|
| You sign in, and are immediately signed out | The cookie was refused: the app thinks the request was plain HTTP (no `X-Forwarded-Proto: https`) while the browser is on HTTPS, or the reverse. |
| Every save fails: `403 cross-origin request refused` | The proxy rewrote `Host`, so it no longer matches the browser's `Origin`. Caddy does not do this by default; an added `header_up Host …` would. |
| The status word flickers between connected and reconnecting | Something is buffering `/api/stream` — compression applied to it, or another proxy in the path. |
| `503` naming `.sql` files | Code is newer than the database: `npm run migrate`. |
| The service exits at once: "Refusing to start" | It says why: no `dist/` (run `npm run build`), or `AUTH_DISABLED=1` in production. |

## 8. Updating

```bash
cd /var/lib/spatialdb/app        # the checkout the service runs from
./scripts/deploy.sh --dry-run    # what is incoming? any migrations?
./scripts/deploy.sh
```

Run it as a user who may `sudo` (it runs the checkout's steps as the checkout's owner,
and `systemctl` as root), with `git`, `node`, `npm` and `pg_dump` on the PATH — on
NixOS, `nix shell nixpkgs#nodejs_22 nixpkgs#git nixpkgs#postgresql` if they are not
installed system-wide. It reads `DB_URL`, `PORT` and the assets directory FROM THE
SYSTEMD UNIT, so they are written down in one place.

What it does, in this order, stopping at the first failure and saying what state
things are in:

1. **look** — fetch; list incoming commits and any new migrations; exit if none
2. **back up** — before anything changes; a migration can restructure data
3. **pull** — fast-forward only; local edits on the server are an error
4. **npm ci** — exactly the locked dependencies
5. **build** — while the OLD server still serves; a failed build disturbs nobody
6. **stop** the service — downtime starts…
7. **migrate** — …because old code must not answer against a new schema
8. **start** — …and ends: a few seconds
9. **check** — `/api/health` answers, and reports the new version

`DEPLOY_NO_SYSTEMD=1 ./scripts/deploy.sh` does everything except stop/start, for when
you run `npm start` by hand. `--force` rebuilds and restarts with nothing new.

> Tested here: the dry run, a full run in no-systemd mode against a real clone and
> database (backup → pull → npm ci → build → migrate), "nothing to do", a dirty
> checkout, and a failed backup. **NOT tested: the systemd half** — `sudo -u`,
> `systemctl stop/start`, reading the unit's `Environment=`, the health check. Read
> the first real run's output carefully.

To go back: `git checkout <previous commit> && npm ci && npm run build`, restart — and
if a migration had already changed data, restore the dump from step 2
(`./scripts/backup.sh restore <file>` is written for the dev cluster; for the system
database use `pg_restore` as in §5).

Browsers pick up a new build on their next load: `index.html` is never cached, and it
names the new hashed files. Connected clients see the stream drop and reconnect.

## 9. Backups, as a timer

```nix
# UNVERIFIED.
systemd.services.spatialdb-backup = {
  path = [ pkgs.postgresql pkgs.rsync pkgs.bash pkgs.coreutils pkgs.findutils pkgs.gawk ];
  environment = {
    DB_URL = "postgres:///spatialdb?host=/run/postgresql";
    SPATIALDB_ASSETS_DIR = "/var/lib/spatialdb/assets";
    SPATIALDB_BACKUP_DIR = "/var/lib/spatialdb/backups";   # then copy these OFF the machine
  };
  serviceConfig = { Type = "oneshot"; User = "spatialdb"; WorkingDirectory = "/var/lib/spatialdb/app"; ExecStart = "/var/lib/spatialdb/app/scripts/backup.sh dump"; };
};
systemd.timers.spatialdb-backup = { wantedBy = [ "timers.target" ]; timerConfig = { OnCalendar = "02:30"; Persistent = true; }; };
```

A backup on the same disk as the database protects against mistakes, not against the
disk. Send `/var/lib/spatialdb/backups` somewhere else.
