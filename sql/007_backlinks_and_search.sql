-- ============================================================================
--  007 — backlink fields, and an index for searching every record
-- ============================================================================

-- ── 1. `backlink`: the other end of a link, as a field ──────────────────────
--
--  A link lives on ONE side: `Edits.inputs → Files`. Open the file and nothing
--  says an edit uses it. But in a lineage model that is the question — is this
--  file an output of something? an input to anything? — and the ROLE of a record
--  is exactly the set of links pointing AT it (PLAN.md, "a role belongs to the
--  relationship"). A backlink field shows them: read-only, computed, configured
--  with { source_field_id } — the link field, on any table including this one,
--  whose target is this table. It is a column, so it sorts and filters:
--  "deliverables with no file", "files nothing uses".
--
--  No data moves. Like `lookup`, it stores nothing in records.data.

alter table fields drop constraint fields_type_check;
alter table fields add constraint fields_type_check check (type in (
  'text', 'long_text', 'number', 'select', 'multi_select', 'date', 'checkbox',
  'link', 'file_path', 'lookup', 'backlink'));

-- ── 2. search ───────────────────────────────────────────────────────────────
--
--  The command palette finds a record in ANY table, including ones the client
--  has never opened — so it has to be a server query, and it has to stay fast as
--  "every file we ever touched" accumulates.
--
--  What is searched is the record's VALUES, lowercased, as one string:
--      jsonb_path_query_array(data, '$.*')  →  ["reel_10", 240, "done"]
--  Values only: searching data::text would match KEY names too, and "codec"
--  would find every record that has a codec.
--
--  It is an EXPRESSION index, not a generated column, on purpose. `restore`
--  (undo of a delete) re-inserts captured rows using the column list from
--  pg_attribute; a generated column would be in that list and cannot be
--  inserted into. An expression index adds no column. The query must use the
--  same expression to hit the index — it lives in one place, reads.ts.
--
--  pg_trgm turns `ILIKE '%term%'` into an index lookup (terms of 3+ characters)
--  and gives typo tolerance via word similarity. It ships with Postgres, but if
--  it is somehow unavailable this migration must not block the app: search then
--  falls back to a scan, which is merely slower.

do $$
begin
  create extension if not exists pg_trgm;
  execute $i$
    create index if not exists records_search_trgm on records
      using gin ((lower(jsonb_path_query_array(data, '$.*')::text)) gin_trgm_ops)
  $i$;
exception when others then
  raise notice 'pg_trgm unavailable (%): search will scan instead of using an index', sqlerrm;
end $$;
