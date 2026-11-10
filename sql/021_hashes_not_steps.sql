-- ============================================================================
--  021 — hashes are not recipe steps (contract/tools.ts, Nov 10 2026)
-- ============================================================================
--
--  A File-drop recipe could carry `hash-xxh3` / `hash-md5` / `hash-sha256` steps,
--  each with an "into the manifest" tick and an optional column. Three ways to be
--  confused about one thing. Now: every hash lives in the record's MANIFEST; the
--  xxh3 fingerprint runs at every drop and md5 / sha256 run from the record, on
--  every File-drop table, with nothing to enable or map. The contract refuses a
--  hash step in a recipe, so the stored ones go.
--
--  What this does NOT do: touch any record. A manifest keeps every hash it has; a
--  text column that held a copy of one keeps its values and is now an ordinary
--  column nothing writes to (delete it when you like). A table whose recipe maps
--  no Manifest field keeps working, without fingerprints, and its editor asks for
--  one the next time the recipe is edited.

update tables t
   set tools = jsonb_set(t.tools, '{file_drop,steps}', coalesce((
         select jsonb_agg(x.step order by x.ord)
           from jsonb_array_elements(t.tools->'file_drop'->'steps') with ordinality as x(step, ord)
          where x.step->>'analyzer' not like 'hash-%'), '[]'::jsonb))
 where jsonb_typeof(t.tools->'file_drop'->'steps') = 'array'
   and exists (select 1 from jsonb_array_elements(t.tools->'file_drop'->'steps') s where s->>'analyzer' like 'hash-%');
