-- ============================================================================
--  015 — tools as RECIPES: a File-drop config is an ordered list of steps, each
--  naming its analyzer, what it runs on, and where its outputs go.
-- ============================================================================
--
--  014 stored `{ "file_drop": { "map": { "<output>": "<fieldId>" } } }` — one flat
--  mapping, with WHICH program derived each value and WHEN it ran hidden in the
--  desktop client's code. The owner's objection (Sept 27): a reader a year from
--  now cannot tell how the values are derived. Now (contract/tools.ts):
--
--    { "file_drop": { "steps": [
--        { "analyzer": "filesystem",              "map": { "path": "…", "name": "…" } },
--        { "analyzer": "ffprobe", "runs_on": { "media": ["video", "audio"] },
--                                                  "map": { "width": "…" } },
--        { "analyzer": "hash-xxh3",               "map": { "hash": "…" } } ] } }
--
--  This rewrites any 014-shaped config into the steps its keys imply — the
--  filesystem, then the sequence and package readers, ffprobe, and an xxh3 hash
--  step only if a hash was mapped. Nothing else changes; no data moves.

do $$
declare
  t record;
  m jsonb;
  fs jsonb; seq jsonb; imf jsonb; ff jsonb; h jsonb;
  steps jsonb;
  k text;
begin
  for t in select id, tools from tables where tools ? 'file_drop' and (tools->'file_drop') ? 'map' loop
    m := t.tools->'file_drop'->'map';
    fs := '{}'; seq := '{}'; imf := '{}'; ff := '{}'; h := '{}';
    for k in select jsonb_object_keys(m) loop
      if k in ('path','name','extension','media','kind','manifest','file_count','total_size','modified') then fs := fs || jsonb_build_object(k, m->k);
      elsif k in ('first_frame','last_frame','gaps') then seq := seq || jsonb_build_object(k, m->k);
      elsif k in ('bundle_type','cpl_title') then imf := imf || jsonb_build_object(k, m->k);
      elsif k = 'hash' then h := h || jsonb_build_object(k, m->k);
      else ff := ff || jsonb_build_object(k, m->k);   -- every stream-level output
      end if;
    end loop;
    steps := jsonb_build_array(jsonb_build_object('analyzer', 'filesystem', 'map', fs));
    if seq <> '{}' then steps := steps || jsonb_build_object('analyzer', 'sequence', 'map', seq); end if;
    if imf <> '{}' then steps := steps || jsonb_build_object('analyzer', 'imf', 'map', imf); end if;
    steps := steps || jsonb_build_object('analyzer', 'ffprobe', 'map', ff);
    if h <> '{}' then steps := steps || jsonb_build_object('analyzer', 'hash-xxh3', 'map', h); end if;
    update tables set tools = tools || jsonb_build_object('file_drop', jsonb_build_object('steps', steps)) where id = t.id;
  end loop;
end $$;
