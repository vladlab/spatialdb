-- ============================================================================
--  Spatial relational database — core schema (v1)
--
--  Sized for a small trusted team (3-10 people, single Postgres instance).
--  Design notes are inline; the ones worth arguing with are marked  << DECISION
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
--  People
--
--  << DECISION: role is a single column, not an RBAC system. With a handful of
--  trusted users the meaningful distinction is "can change the schema" vs
--  "can change data" vs "can only look". Row-level permissions can be added
--  later via Postgres RLS without touching this shape.
-- ─────────────────────────────────────────────────────────────────────────────
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null default '',
  role        text not null default 'editor'
                check (role in ('admin', 'editor', 'viewer')),
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  Schema layer: user-defined tables and fields
--
--  << DECISION: no dynamic DDL. User "tables" are rows here, not real Postgres
--  tables. Creating a table at runtime via DDL means a migration engine, lock
--  risk, and a permanent maintenance burden — a whole product on its own. At
--  this scale JSONB + GIN is comfortably fast enough.
-- ─────────────────────────────────────────────────────────────────────────────
create table tables (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,               -- plural, for the sidebar: "Deliverables"
  singular_name text not null default '',    -- for card labels: "Deliverable"
  color         text not null default '',    -- default card tint for this type
  icon          text not null default '',
  position      integer not null default 0,  -- sidebar ordering
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table fields (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id) on delete cascade,

  name       text not null,   -- display name; renameable freely
  -- << DECISION: `key` is the immutable identifier used inside records.data.
  -- Generated from the name at creation, then frozen. This is why renaming a
  -- field is O(1) instead of rewriting every record in the table.
  key        text not null,

  type       text not null check (type in (
               'text',          -- single line
               'long_text',     -- rich text (TipTap JSON)
               'number',
               'select',        -- single choice
               'multi_select',
               'date',
               'checkbox',
               'link',          -- relation to records in another table
               'file_path',     -- local absolute path + probed media metadata
               'lookup'         -- pulls a field from a linked record (read-only)
             )),

  -- Type-specific config. Shapes by type:
  --   select/multi_select : { "choices": [{ "id", "label", "color" }] }
  --   number              : { "precision": 2, "suffix": "Mbps" }
  --   link                : { "target_table_id": uuid, "symmetric_field_id": uuid|null }
  --   lookup              : { "via_field_id": uuid, "target_field_id": uuid }
  --   file_path           : { "probe_on_set": true }
  options    jsonb not null default '{}'::jsonb,

  position   integer not null default 0,
  required   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (table_id, key)
);

create index fields_table_idx on fields (table_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
--  Records — the actual data
--
--  << DECISION: scalar values live in `data` JSONB keyed by fields.key.
--  Relations do NOT live here (see `links`) because we need to query them from
--  both directions and join on them.
-- ─────────────────────────────────────────────────────────────────────────────
create table records (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null
);

create index records_table_idx on records (table_id);
create index records_data_idx  on records using gin (data jsonb_path_ops);

-- ─────────────────────────────────────────────────────────────────────────────
--  Links — relations as real rows
--
--  << DECISION: `field_id` is part of the identity of a link, not just
--  decoration. A single table needs multiple distinct relations to the SAME
--  target table — an Edit has both `inputs` and `outputs` pointing at Files.
--  Without field_id those collapse into one indistinguishable set.
-- ─────────────────────────────────────────────────────────────────────────────
create table links (
  id          uuid primary key default gen_random_uuid(),
  field_id    uuid not null references fields(id)  on delete cascade,
  from_record uuid not null references records(id) on delete cascade,
  to_record   uuid not null references records(id) on delete cascade,
  created_at  timestamptz not null default now(),

  unique (field_id, from_record, to_record)
);

-- Both directions are hot paths: "what does this Edit output?" and
-- "which Edit produced this File?"
create index links_from_idx on links (from_record, field_id);
create index links_to_idx   on links (to_record,   field_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  Grid views — per table, like Airtable
-- ─────────────────────────────────────────────────────────────────────────────
create table views (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id) on delete cascade,
  name       text not null default 'Grid',
  type       text not null default 'grid' check (type in ('grid')),
  -- { "filters": [...], "sorts": [...], "hidden_fields": [...], "widths": {...} }
  config     jsonb not null default '{}'::jsonb,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index views_table_idx on views (table_id, position);

-- ─────────────────────────────────────────────────────────────────────────────
--  Canvases — the killer feature
--
--  << DECISION: a canvas is NOT a view of one table. It is a workspace-level
--  surface that can hold records from any table at once. This is the deliberate
--  break from Airtable's model and the entire reason this system exists.
-- ─────────────────────────────────────────────────────────────────────────────
create table canvases (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  -- last/default camera: { "x": 0, "y": 0, "scale": 1 }
  viewport    jsonb not null default '{}'::jsonb,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  Placements — the keystone table
--
--  Position belongs to the (canvas, record) PAIR, never to the record itself.
--  Consequences, all of them intentional:
--    * one record can sit on many canvases at different positions
--    * a record can exist with no placement at all (grid-only, "unplaced")
--    * deleting a placement is NOT deleting a record  <- surface this in the UI
-- ─────────────────────────────────────────────────────────────────────────────
create table placements (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references canvases(id) on delete cascade,
  record_id  uuid not null references records(id)  on delete cascade,

  x          double precision not null default 0,
  y          double precision not null default 0,
  w          double precision,               -- null = auto-size
  h          double precision,
  z          integer not null default 0,

  collapsed  boolean not null default false,
  -- per-placement presentation overrides: color, fold state, pinned, etc.
  -- Presentation only — never put record data in here.
  style      jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- << DECISION: a record appears at most once per canvas. Allowing duplicates
  -- makes "where is this record?" ambiguous and complicates arrow routing.
  unique (canvas_id, record_id)
);

create index placements_canvas_idx on placements (canvas_id);
create index placements_record_idx on placements (record_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  Canvas annotations — drawing, not data
--
--  << DECISION: arrows split in two. A relation between records is a `link`
--  and draws itself whenever both endpoints are placed. Anything the user
--  draws that carries no data meaning lives here and is canvas-local.
-- ─────────────────────────────────────────────────────────────────────────────
create table canvas_annotations (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references canvases(id) on delete cascade,
  kind       text not null check (kind in ('arrow', 'area', 'label')),
  geometry   jsonb not null default '{}'::jsonb,
  style      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index canvas_annotations_canvas_idx on canvas_annotations (canvas_id);

-- ─────────────────────────────────────────────────────────────────────────────
--  updated_at maintenance
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'tables', 'fields', 'records', 'views',
    'canvases', 'placements', 'canvas_annotations'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================================
--  Deliberately NOT in v1, and why
--
--  soft deletes      — adds `where deleted_at is null` to every query forever.
--                      For a team this size, nightly pg_dump is cheaper
--                      recoverability than carrying tombstones in the schema.
--  formula engine    — `lookup` covers the real need (spec vs actual QC).
--                      A full expression language is a product unto itself.
--  attachments       — media is referenced by absolute path, not uploaded.
--  audit log         — add later as an append-only table if it's ever needed.
--  RLS policies      — everyone here is trusted; add when that stops being true.
-- ============================================================================
