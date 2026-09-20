-- ============================================================================
--  009 — sections: what the app's HOME PAGE is made of
-- ============================================================================
--
--  This database is meant to hold more than one kind of thing — projects and
--  their files, but also the computers, the field drives, whatever comes next.
--  A SECTION is a named part of the app: "Projects", "Computers", "Drives". It
--  lists which tables belong to it and, optionally, names one of them as its
--  SCOPE table (Projects is scoped by the Projects table: pick "Duke" and
--  everything narrows to it — that arrives with the scope feature).
--
--  A section is NAVIGATION, and nothing else:
--
--    - It changes what is OFFERED (the home page, the table and canvas pickers,
--      which results the palette ranks first). It never changes what EXISTS.
--      Links, lookups and backlinks cross sections freely — a file lives on a
--      drive, a drive sits in a computer.
--    - It is NOT a permission. Every table stays reachable through the built-in
--      "Everything" section, the palette, and any link. If access control is ever
--      wanted it is a different, server-enforced feature; do not grow it from this.
--
--  `table_ids` is a JSON list, deliberately NOT a join table with foreign keys:
--
--    - a table may be in several sections, or none (then it is only in Everything);
--    - an id that no longer resolves is simply skipped when read — the same
--      tolerance as views.config — so deleting a table needs no fix-up here, and
--      UNDOING that delete puts it straight back in its sections;
--    - no cascade means no undo capture to keep in step (the one invariant in this
--      codebase that is not automated: capture.ts must mirror every cascade).
--
--  `scope_table_id` / `archived_field_id` have no foreign keys for the same
--  reason. They are validated on write (src/contract/sections.ts is the shape;
--  apply.ts checks the ids) and read tolerantly.

create table sections (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (name <> ''),
  description        text not null default '',
  icon               text not null default '',          -- an emoji or a short string
  color              text not null default '',
  table_ids          jsonb not null default '[]'::jsonb,
  scope_table_id     uuid,
  archived_field_id  uuid,                              -- a checkbox on the scope table
  position           integer not null default 0,
  created_at         timestamptz not null default clock_timestamp(),
  updated_at         timestamptz not null default now()
);
