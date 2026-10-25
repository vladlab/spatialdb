-- ============================================================================
--  020 — a calendar IS a record (VIEWS-BRIEF.md Part B)
-- ============================================================================
--
--  As a report is a record in a table of kind 'report' (013), a calendar is a
--  record in a table of kind 'calendar'. Its definition — the sources, the rows,
--  the remembered layout — is a `structured` value of shape 'calendar' on that
--  record (contract/calendar.ts validates it on both sides, and the server checks
--  it against the schema on every write). Nothing else is stored: a calendar is
--  DERIVED each time it is opened.
--
--  So the whole migration is: the kind is allowed. Same rule as boards and
--  reports — set when the table is made, never changed.

alter table tables drop constraint tables_kind_check;
alter table tables add constraint tables_kind_check check (kind in ('records', 'canvas', 'report', 'junction', 'calendar'));
