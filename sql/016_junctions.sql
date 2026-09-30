-- ============================================================================
--  016 — a junction: a relationship that has attributes
-- ============================================================================
--
--  "Does this file SATISFY that deliverable?" is not a link between a file and a
--  deliverable — it is a STATE of that link. Two parallel link fields ("targets",
--  "satisfies") encode one relation twice to carry one bit, and lose the rest:
--  the rejected attempt, the note about why, the row someone can open and edit.
--
--  The relational answer is the association object — a table whose rows ARE the
--  pairs, carrying whatever the pair carries. Rails' `has_many :through`, Django's
--  `through` model, Jira's typed issue links, Salesforce's contact roles. Here it
--  is a table of kind 'junction' (as 'canvas' and 'report' are kinds, 010/013):
--
--    tables.junction  { a, b, status?, match? }
--        a, b     the two ENDPOINT link fields, on this table, each "single", each
--                 pointing at one of the tables being connected
--        status   optionally, a select field on this table: the verb of the row
--                 ("Uploaded", "Rejected", "Accepted") — the vocabulary is the
--                 field's own choices, nothing is hard-coded here
--        match    optionally, pairs of link fields [on A's table, on B's table]
--                 that SHOULD agree (a file's Work, a deliverable's Work): the
--                 picker offers agreeing rows first. A filter, never a constraint.
--
--  Rules, enforced in apply.ts because none of them fit a check constraint:
--
--    * a junction row links to EXACTLY ONE record through `a` and one through `b`
--      — checked at the end of every batch for every row the batch touched, so a
--      row is created (record.create + two link.add, one batch) or not at all,
--      and an endpoint can never be unlinked: removing the relationship is
--      deleting the row, which undo restores whole.
--    * one row per pair: a second (file, deliverable) row is refused.
--    * deleting an endpoint record (or its table) deletes the junction rows that
--      hung off it — a cascade apply.ts performs and capture.ts mirrors, exactly
--      as a board's placements go with the board. There is no such thing as a
--      half-connected junction row.
--    * an endpoint link field cannot be deleted; delete the junction table.
--
--  What the endpoint tables get: an ordinary BACKLINK field each, pointing at the
--  junction's `a` (or `b`) field. The client makes them when the junction is made
--  and treats them as writable — the "+" on a Files row's "Delivery" column is
--  what creates a junction row. No new field type, no data on the endpoint.
--
--  Like `tools`: replaced whole by `table.update { junction }`, validated against
--  this table's fields (contract/junction.ts) on write. `kind` is set when the
--  table is made and never changed.

alter table tables drop constraint tables_kind_check;
alter table tables add constraint tables_kind_check check (kind in ('records', 'canvas', 'report', 'junction'));

alter table tables add column junction jsonb not null default '{}';

comment on column tables.junction is
  'For kind = junction: { a, b, status?, match? } — endpoint link fields, the '
  'status select, and the field pairs the picker prefers to see agree. '
  'See sql/016_junctions.sql and src/contract/junction.ts.';
