-- ============================================================================
--  017 — field sections: a table's fields, grouped for the full record view
-- ============================================================================
--
--  A table with sixty fields is a wall in the record tray. A section is a named
--  group of fields ("Video", "Audio", "File system"), defined in the schema editor
--  (Table settings) and drawn in the tray as a foldable well of its own. The whole
--  rule is src/contract/fieldSections.ts; the storage is this one column:
--
--    tables.field_sections   [ { "id", "name", "folded"?: true, "fields": [<field id>, …] }, … ]
--
--  Named `field_sections` because `sections` (009) already means the navigation's
--  groups of TABLES. These are groups of FIELDS inside one table.
--
--  Replaced whole by `table.update { fieldSections }`, like `tools` (014) and
--  `junction` (016). No foreign keys into fields, by the same precedent: a
--  `field.delete` does not rewrite this, an id that no longer resolves is skipped,
--  and undoing the delete heals it — so nothing here cascades and capture.ts needs
--  no mirror (a table's own row is captured with `select *`, this column included).
--
--  `fields.position` stays THE field order (primary, grid columns, cards). The
--  schema editor keeps it in step with the arrangement it writes.

alter table tables add column field_sections jsonb not null default '[]';

comment on column tables.field_sections is
  'Fields grouped for the record tray: [{ id, name, folded?, fields: [field id] }]. '
  'See sql/017_field_sections.sql and src/contract/fieldSections.ts.';
