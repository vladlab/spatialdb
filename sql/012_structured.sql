-- ============================================================================
--  012 — a field type: `structured`
-- ============================================================================
--
--  A value that is a small JSON OBJECT with a known SHAPE, for groups of facts
--  that belong to one record and do not deserve a table of their own:
--
--    manifest       what a Files record physically IS — one file, an IMF/DCP
--                   folder and its members, an image sequence (pattern + frame
--                   range, NEVER the file list), a multi-mono audio set.
--    audio_layout   tracks and the channels inside them — on a Deliverable (the
--                   spec), an Edit (as built) and a File (as probed), so they can
--                   be compared.
--    json           anything else, unvalidated beyond "an object, not too big".
--
--  The shape is named in the field's options (`{ "shape": "manifest" }`) and its
--  rules live in src/contract/shapes.ts, shared by server and client. The database
--  does not know about shapes: `records.data` is jsonb already, so a structured
--  value is simply an object where a string or number would otherwise be.
--
--  Why not tables? A manifest's members are not things anyone links to, filters by
--  or edits one at a time; they are a description of one record. A layout is a
--  VALUE you copy from a spec onto an edit. If a member ever needs to be a record in
--  its own right, the Files convention has a `parent` self-link for promoting it.
--
--  Only the CHECK constraint changes. No data moves.

alter table fields drop constraint fields_type_check;
alter table fields add constraint fields_type_check check (type in (
  'text', 'long_text', 'number', 'select', 'multi_select', 'date', 'checkbox',
  'link', 'file_path', 'lookup', 'backlink', 'rich_text', 'attachment', 'structured'));
