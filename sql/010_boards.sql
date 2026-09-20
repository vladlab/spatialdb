-- ============================================================================
--  010 — a canvas IS a record
-- ============================================================================
--
--  Canvases were their own kind of thing: a row in `canvases`, outside the
--  relational model. That needed a special mechanism for everything a record gets
--  for free — and three were already built or planned: filing a canvas under a
--  section (`config.sectionId`, 009), scoping it to a project (a planned second
--  tag), and finding it (canvases were not in search at all). They also could not
--  carry a status, an owner, or a link to anything.
--
--  So: a TABLE can be marked `kind = 'canvas'` — "a table of boards" — and every
--  record in such a table IS a canvas.
--
--    - Filing is table membership of a section. Scope is a membership LINK on the
--      record ("this board is about Duke"). Both already exist for every table; a
--      board needs nothing of its own. `config.sectionId` is removed again.
--    - A board has fields, sorts and filters in the grid, is found by the palette.
--    - A board can be PLACED ON another board — it is a record, and records become
--      cards — which is navigation between canvases for free.
--
--  `canvases` stays, but now means "the STATE of a board": viewport and card
--  settings, keyed by the record's id.
--
--    - `canvases.id` references `records(id)` ON DELETE CASCADE. Delete the record
--      and the board goes — and with it, by the existing cascades, its placements
--      and annotations. *** capture.ts mirrors that *** (record.delete and
--      table.delete now capture the board's state and contents): this is the one
--      invariant in the codebase that nothing enforces. test/undo.ts covers it.
--    - name, description and position are dropped. A board's name is its record's
--      primary field — ONE name, not two that can disagree.
--    - The state row is created LAZILY, the first time something needs it (a
--      placement, a viewport save). So creating a board is an ordinary
--      record.create in a boards table — from the grid, a script, anywhere — with
--      no special case, and `canvas.create` / `canvas.delete` are retired.
--
--  `kind` is set when a table is created and never changed: turning a table of
--  files into a table of boards is not an edit anyone means to make.

alter table tables add column kind text not null default 'records'
  check (kind in ('records', 'canvas'));

-- ── carry existing canvases across, KEEPING THEIR IDS ───────────────────────
-- Placements, annotations, bookmarks and URLs all refer to a canvas by id, so the
-- new record takes the same id. Only done if there is anything to carry: a fresh
-- database gets no table it did not ask for (the app makes a boards table the
-- first time someone presses "+ canvas").
do $$
declare
  boards uuid;
begin
  if exists (select 1 from canvases) then
    insert into tables (name, singular_name, kind, position)
      values ('Canvases', 'Canvas', 'canvas', (select coalesce(max(position), 0) + 1 from tables))
      returning id into boards;
    insert into fields (table_id, name, key, type, position) values
      (boards, 'Name', 'name', 'text', 0),
      (boards, 'Description', 'description', 'long_text', 1);
    insert into records (id, table_id, data, created_at, updated_at)
      select c.id, boards,
             jsonb_strip_nulls(jsonb_build_object('name', c.name, 'description', nullif(c.description, ''))),
             c.created_at, c.updated_at
        from canvases c order by c.position, c.name;
  end if;
end $$;

alter table canvases
  drop column name, drop column description, drop column position,
  add constraint canvases_record_fk foreign key (id) references records(id) on delete cascade;
alter table canvases alter column id drop default;

-- 009's per-canvas section tag is superseded by table membership. Strip it, or the
-- (strict) config contract would refuse every later update to those canvases.
update canvases set config = config - 'sectionId' where config ? 'sectionId';
