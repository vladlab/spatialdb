-- Worked example: does this schema actually express the real workflow?
-- Deliverable (spec) <- File (actual) <- outputs/inputs - Edit, all on one canvas.

-- ── Tables ───────────────────────────────────────────────────────────────────
insert into tables (id, name, singular_name) values
  ('11111111-1111-1111-1111-111111111111', 'Deliverables', 'Deliverable'),
  ('22222222-2222-2222-2222-222222222222', 'Files',        'File'),
  ('33333333-3333-3333-3333-333333333333', 'Edits',        'Edit');

-- ── Fields ───────────────────────────────────────────────────────────────────
-- Deliverable: the spec
insert into fields (table_id, name, key, type, options) values
  ('11111111-1111-1111-1111-111111111111', 'Name',           'name',           'text',   '{}'),
  ('11111111-1111-1111-1111-111111111111', 'Required codec', 'required_codec', 'text',   '{}'),
  ('11111111-1111-1111-1111-111111111111', 'Required width', 'required_width', 'number', '{}');

-- File: the actual, as probed by ffprobe
insert into fields (table_id, name, key, type, options) values
  ('22222222-2222-2222-2222-222222222222', 'Name',   'name',        'text',      '{}'),
  ('22222222-2222-2222-2222-222222222222', 'Path',   'source_path', 'file_path', '{"probe_on_set": true}'),
  ('22222222-2222-2222-2222-222222222222', 'Codec',  'codec',       'text',      '{}'),
  ('22222222-2222-2222-2222-222222222222', 'Width',  'width',       'number',    '{}');

-- File -> Deliverable  (which spec does this file answer to?)
insert into fields (id, table_id, name, key, type, options) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'For deliverable', 'for_deliverable', 'link',
   '{"target_table_id": "11111111-1111-1111-1111-111111111111"}');

-- THE CRITICAL CASE: two distinct link fields from Edits to the SAME table.
-- This is why links.field_id has to be part of a link's identity.
insert into fields (id, table_id, name, key, type, options) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333', 'Inputs',  'inputs',  'link',
   '{"target_table_id": "22222222-2222-2222-2222-222222222222"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'Outputs', 'outputs', 'link',
   '{"target_table_id": "22222222-2222-2222-2222-222222222222"}');

insert into fields (table_id, name, key, type, options) values
  ('33333333-3333-3333-3333-333333333333', 'Name', 'name', 'text', '{}');

-- Field order. Positions default to 0, and the FIRST plain-valued field by
-- position is the table's primary field — the one its records are named by
-- (src/contract/labels.ts). Left all at 0, ties break by name and Files would be
-- labelled by "Codec". Anything that creates fields outside the UI has to do
-- this; see "set the position" in API.md.
update fields set position = p.pos
  from (values ('name', 0), ('source_path', 1), ('codec', 2), ('width', 3),
               ('required_codec', 1), ('required_width', 2),
               ('for_deliverable', 4), ('inputs', 1), ('outputs', 2)) as p(key, pos)
 where fields.key = p.key;

-- ── Records ──────────────────────────────────────────────────────────────────
insert into records (id, table_id, data) values
  ('d0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '{"name": "Trailer 30s", "required_codec": "h264", "required_width": 1920}'),

  -- conforms to spec
  ('f0000000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   '{"name": "trailer_v3_h264.mp4", "source_path": "/mnt/media/trailer_v3_h264.mp4", "codec": "h264", "width": 1920}'),

  -- WRONG codec and WRONG width — QC should catch this
  ('f0000000-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   '{"name": "trailer_v3_prores.mov", "source_path": "/mnt/media/trailer_v3_prores.mov", "codec": "prores", "width": 1280}'),

  -- a source file, used as an input (not a deliverable output)
  ('f0000000-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '{"name": "master_graded.mov", "source_path": "/mnt/media/master_graded.mov", "codec": "prores", "width": 3840}'),

  ('e0000000-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   '{"name": "Trailer Edit V3"}');

-- ── Links ────────────────────────────────────────────────────────────────────
-- Both output files answer to the same deliverable spec
insert into links (field_id, from_record, to_record) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001');

-- Edit V3: one input, two outputs — same target table, different fields
insert into links (field_id, from_record, to_record) values
  ('bbbbbbbb-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002');

-- ── Canvas + placements (records from THREE different tables, one surface) ────
-- A canvas is a RECORD in a table of kind 'canvas' (sql/010_boards.sql); the
-- `canvases` row is only its state. So: a boards table, a board record, its state.
insert into tables (id, name, singular_name, kind, position) values
  ('44444444-4444-4444-4444-444444444444', 'Boards', 'Board', 'canvas', 9);
insert into fields (table_id, name, key, type, position) values
  ('44444444-4444-4444-4444-444444444444', 'Name', 'name', 'text', 0);
insert into records (id, table_id, data) values
  ('c0000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   '{"name": "Trailer 30s — delivery"}');
insert into canvases (id) values
  ('c0000000-0000-0000-0000-000000000001');

insert into placements (canvas_id, record_id, x, y) values
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',   0,   0),
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 400,   0),
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 800, -80),
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 800, 120);
-- note: master_graded.mov exists as a record but is deliberately NOT placed.
