-- ============================================================================
--  011 — real users: passwords and sessions
-- ============================================================================
--
--  The app has had users, roles and an actor on every logged mutation since 001.
--  What it never had was IDENTITY: the server treated every request as "the first
--  admin". This adds the missing piece — proving who you are — and nothing else.
--  Roles and their enforcement are unchanged.
--
--  password_hash   Self-describing: `scrypt$N$r$p$<salt b64>$<hash b64>`. The
--                  algorithm and its cost are IN the value, so both can be raised
--                  later (or moved to argon2) by re-hashing at next login, with no
--                  migration. NULL = cannot log in with a password (an account that
--                  only exists for a proxy/SSO login, or one not set up yet).
--  disabled        People leave. A disabled user cannot log in and their sessions
--                  are deleted — but their ROW stays, because `mutations.actor_id`
--                  points at it and "who did this" must outlive their access.
--                  Users are never deleted.
--
--  sessions        One row per login. The cookie holds a random 256-bit token; the
--                  table holds only its SHA-256 — a leaked database (or backup)
--                  therefore contains no usable session. Revoking is deleting a
--                  row. `expires_at` slides forward with use; idle sessions die.
--
--  NONE of this goes through the mutation log. Mutations are kept forever and
--  streamed to every client; credentials must be in neither place. User management
--  has its own endpoints (src/server/auth.ts).

alter table users
  add column password_hash text,
  add column disabled boolean not null default false;

create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text not null default ''
);
create index sessions_user on sessions (user_id);
create index sessions_expiry on sessions (expires_at);
