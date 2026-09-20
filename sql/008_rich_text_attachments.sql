-- ============================================================================
--  008 — two field types: `rich_text` and `attachment`
-- ============================================================================
--
--  rich_text   A formatted document: headings, lists, tables, inline images.
--              Stored as TipTap/ProseMirror JSON in records.data — an OBJECT, not
--              a string. For the notes that belong to a record: a deliverable's
--              pasted emails and the screenshots of whatever PDF they refer to.
--              `long_text` stays what it is — a plain multi-line string, readable
--              in psql and writable by a script. This does not replace it.
--
--  attachment  A list of asset ids (sql/006). Images, PDFs; later the Tauri
--              client's waveform PNGs and other QC output.
--
--  Neither holds bytes. An image inside a rich_text document is a node carrying
--  an ASSET ID; the rule that makes that safe to store in a mutation log is
--  enforced on write (src/contract/richtext.ts): no `src`, no data: URIs, and
--  every asset id must exist.
--
--  Only the CHECK constraint changes. No data moves.

alter table fields drop constraint fields_type_check;
alter table fields add constraint fields_type_check check (type in (
  'text', 'long_text', 'number', 'select', 'multi_select', 'date', 'checkbox',
  'link', 'file_path', 'lookup', 'backlink', 'rich_text', 'attachment'));
