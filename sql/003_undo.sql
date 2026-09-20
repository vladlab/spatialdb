-- ============================================================================
--  Undo capture — 003
--
--  001_schema.sql deliberately has no soft deletes, and stated the trade:
--
--      "soft deletes — adds `where deleted_at is null` to every query forever.
--       For a team this size, nightly pg_dump is cheaper recoverability than
--       carrying tombstones in the schema."
--
--  The first half of that is still right. The second half was wrong, and the
--  error was conflating two different problems:
--
--    * A DUMP is disaster recovery. Disk failure, a lost data directory, a
--      destructive migration, cluster corruption. Nothing else covers those.
--    * UNDO is a mis-click. Restoring the whole database to 3am to recover one
--      record throws away everyone else's day — so in practice nobody does it,
--      the mis-click stays unfixed, and the dump never served the purpose the
--      comment claimed it did.
--
--  Both are needed. This migration solves the second one, without tombstones.
--
--  The observation that makes it cheap: the mutation log already records WHO
--  changed WHAT and WHEN. The only thing it was missing is what a delete
--  actually removed — `{"type":"record.delete","id":"…"}` names the victim and
--  keeps nothing. So capture the rows the delete is about to destroy, cascades
--  included, and undo becomes a read plus an ordinary write.
--
--  Why a column here rather than tombstones in every table:
--    * queries stay clean — no `where deleted_at is null` anywhere, ever
--    * cascades come out right. Un-deleting a record needs to know which of its
--      links went away BECAUSE OF that delete versus independently. The log
--      knows, because it recorded the action rather than the state.
--    * it is auditable for free: "what did this deliverable contain before it
--      was deleted" is now answerable
--    * an undo is itself a logged mutation, so undo is undoable
-- ============================================================================

-- Nullable: only destructive mutations carry a capture.
--
-- Deliberately NOT selected by the catch-up query in reads.ts, which lists its
-- columns explicitly. Undo payloads can be large and clients never need them, so
-- they must not ride along on the realtime hot path. Postgres keeps large jsonb
-- out of line in TOAST anyway, so a wide capture costs nothing to skip.
alter table mutations add column undo jsonb;

comment on column mutations.undo is
  'Rows destroyed by this mutation, cascades included, for undo. Null for '
  'non-destructive mutations. See sql/003_undo.sql and src/server/capture.ts.';

-- Finding what can be undone: the recent destructive tail of the log.
-- Partial index, because the overwhelming majority of rows have undo IS NULL.
create index mutations_undoable_idx on mutations (seq desc) where undo is not null;

-- ============================================================================
--  Retention interacts with this, and the interaction is worth stating.
--
--  002 notes the log can be pruned past the longest plausible offline window.
--  Pruning now also throws away undo capacity, and — separately — breaks
--  idempotency for any pruned mutation id, because the dedup check in
--  applyBatch is `select 1 from mutations where id = $1` and the row is gone.
--
--  So three windows are actually the same number and should be decided together:
--    * how far behind a client may be and still replay      (catch-up limit)
--    * how long an offline queue may hold unsent mutations  (idempotency)
--    * how far back you can undo                            (this column)
--
--  Nothing here enforces that. It is a decision to make deliberately rather
--  than discover.
-- ============================================================================
