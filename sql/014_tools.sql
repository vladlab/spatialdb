-- ============================================================================
--  014 — tools: what the DESKTOP client may do to a table, and who wrote a batch
-- ============================================================================
--
--  A TOOL is code compiled into the desktop client (file drop, later a Resolve
--  timeline reader, QC). The server never runs one and never sends anything to
--  execute; its whole knowledge of a tool is the shared rule file
--  src/contract/tools.ts and this one column:
--
--    tables.tools   { "<toolId>": { "map": { "<outputKey>": "<fieldId>" } } }
--                   "file drop is enabled on Files; its width goes into THAT
--                   field". Validated on write against tools.ts and the table's
--                   fields; replaced whole by `table.update { tools }`.
--
--  No foreign keys into fields, by the precedent of views and sections: a
--  `field.delete` does not rewrite this, an id that no longer resolves is skipped
--  when the tool runs, and undoing the delete heals it. So nothing here cascades
--  and capture.ts needs no mirror.
--
--    mutations.via  a short tag naming the tool that produced a batch
--                   ("file_drop"), null for everything a person typed. Provenance
--                   for the audit trail: "45 records · via File drop". It is on the
--                   LOG ROW, not inside the mutation, so a tool's writes stay
--                   ordinary mutations — same replay, same undo, same stream.

alter table tables    add column tools jsonb not null default '{}';
alter table mutations add column via   text;
