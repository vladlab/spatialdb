-- ============================================================================
--  019 — the `dimensions` field type: a frame size, width × height, as ONE value
-- ============================================================================
--
--  "Nobody wants to type a width and a height as two different numbers" (the
--  owner, Oct 17). A spec's "3840×2160" is one fact; the file's stored size is one
--  fact; comparing them is one rule. The value is the canonical text "1920×1080"
--  (U+00D7 between two positive integers — contract/dimensions.ts), which the
--  editor produces from whatever was typed and validateValue insists on. It sorts
--  naturally, filters as text, compares by equality, and the ffprobe analyzer's
--  `dimensions` output fills it from width and height.
--
--  Only the CHECK constraint changes. No data moves; the two number columns a
--  table may already have stay as they are.

alter table fields drop constraint fields_type_check;
alter table fields add constraint fields_type_check check (type in (
  'text', 'long_text', 'number', 'select', 'multi_select', 'date', 'checkbox',
  'link', 'file_path', 'dimensions', 'lookup', 'backlink', 'rich_text', 'attachment', 'structured'));
