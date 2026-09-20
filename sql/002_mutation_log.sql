-- ============================================================================
--  Mutation log — 002
--
--  One table that does three jobs at once, which is why it earns its place
--  despite v1 otherwise avoiding bookkeeping tables:
--
--    1. IDEMPOTENCY. `id` is client-generated and unique, so replaying a batch
--       after a dropped connection (or draining an offline queue) is safe.
--    2. CATCH-UP. `seq` is monotonic. A client reconnects with the last seq it
--       saw and receives everything after it. That is the entire sync protocol.
--    3. AUDIT. Who changed what, when — free, and genuinely useful when someone
--       asks why a deliverable's spec changed.
-- ============================================================================

create table mutations (
  id         uuid primary key,              -- client-generated idempotency key
  seq        bigserial not null unique,     -- server-assigned order
  actor_id   uuid references users(id) on delete set null,
  client_id  uuid not null,                 -- so a client can skip its own echo
  type       text not null,
  payload    jsonb not null,
  applied_at timestamptz not null default now()
);

create index mutations_seq_idx        on mutations (seq);
create index mutations_applied_at_idx on mutations (applied_at desc);

-- NOTE on ordering: bigserial values are assigned at INSERT time, not COMMIT
-- time, so under heavy concurrency a reader could briefly observe a gap and
-- miss a row. At 3-10 users this is vanishingly unlikely, and last-write-wins
-- semantics tolerate minor reordering anyway.
--
-- If it ever matters, the cheap fix at this scale is to serialise writes with
-- a transaction-scoped advisory lock in the apply path:
--     select pg_advisory_xact_lock(hashtext('mutation_log'));
-- That makes seq strictly commit-ordered at the cost of one writer at a time —
-- entirely acceptable for a team this size, and far simpler than the
-- alternatives.

-- Retention: the log grows without bound. It is safe to prune anything older
-- than the longest plausible offline window (say 30 days) — clients further
-- behind than that should do a full refetch rather than replay.
--     delete from mutations where applied_at < now() - interval '30 days';
