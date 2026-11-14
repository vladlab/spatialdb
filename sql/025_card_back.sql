-- ============================================================================
--  025 — the back of a card, set on its table
-- ============================================================================
--
--  CANVAS-BRIEF.md C2 (Nov 14, 2026). Space lifts a canvas card up to examine it;
--  F flips it. The back is a read-only, fixed layout of the record's fields, the
--  same for every card of the table:
--
--    tables.card_back   jsonb: an ordered list of field ids, or null for the default
--                       (every field but the title, schema order, under the table's
--                       field-section names) — contract/cardBack.ts
--
--  Written by `table.update { cardBack }`, replaced whole, null back to the default.

alter table tables add column card_back jsonb;

comment on column tables.card_back is
  'The fields on the back of this table''s cards (examine, then flip), in order; null = every field. See sql/025_card_back.sql and src/contract/cardBack.ts.';
