-- ============================================================================
--  022 — an ordinary table whose records each HAVE a canvas
-- ============================================================================
--
--  A table of kind 'canvas' (010) says two things at once: "every record in it IS
--  a canvas" and "it is a navigation utility, not data" — folded away in the tree,
--  left out of the junction, report and calendar pickers, no desktop tools.
--
--  Works wants the first and not the second. In practice every work gets a canvas,
--  and a Work plus a separately made board named after it is one thing with two
--  names that can disagree. But Works is DATA: reports walk it, junctions pair it,
--  calendars may row by it. So it cannot become kind 'canvas' — and kind is set
--  when a table is made and never changed anyway.
--
--  So a table of ordinary records can say so itself:
--
--    tables.record_canvases   boolean, default false
--
--  Set and cleared by `table.update { recordCanvases }` (a tick in Table
--  settings), on a table of kind 'records' only. Nothing about storage changes:
--  `canvases.id` has referenced `records(id)` since 010, whatever the record's
--  table, and the state row is still created lazily, on the first placement. So
--
--    - every record of such a table is listed with the canvases, scoped by its
--      own membership link like any board ("every work, post-scope");
--    - deleting the record takes its canvas with it, and undo brings both back —
--      capture.ts already keys that on the record's id, not on the table's kind;
--    - the table stays a data table everywhere else.
--
--  Unticking hides the canvases and stops new ones being started; what was placed
--  stays in the database and is back when the box is ticked again.

alter table tables add column record_canvases boolean not null default false;

comment on column tables.record_canvases is
  'For kind = records: every record of this table also has a canvas, listed with the boards. See sql/022_record_canvases.sql.';
