-- ============================================================================
--  013 — a report IS a record (REPORTS-BRIEF.md §4)
-- ============================================================================
--
--  As a canvas is a record in a table of kind 'canvas' (010), a report is a record
--  in a table of kind 'report'. Its definition — the walk — is a `structured` value
--  of shape 'report' on that record (contract/reports.ts validates it, on both
--  sides, and the server checks it against the schema on every write). Nothing else
--  is stored: a report is DERIVED each time it is opened; a snapshot of one is an
--  attachment on the same record, made through the asset store that exists.
--
--  So the whole migration is: the kind is allowed. Same rule as boards — set when
--  the table is made, never changed.

alter table tables drop constraint tables_kind_check;
alter table tables add constraint tables_kind_check check (kind in ('records', 'canvas', 'report'));
