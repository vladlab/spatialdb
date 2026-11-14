-- ============================================================================
--  024 — a card's watermark, set on its table
-- ============================================================================
--
--  CANVAS-BRIEF.md B2 (Nov 14, 2026). A large, faint icon behind a card's rows
--  saying what it IS — a video file, an audio file, a deliverable. Identity, like
--  the table's colour, so it belongs to the TABLE and is the same on every canvas:
--
--    tables.card_icon   jsonb, null = no watermark
--                       { icon? } or { byField, map, icon? } — contract/cardIcon.ts
--
--  Written by `table.update { cardIcon }`, replaced whole, null clears it. No
--  backfill: every table starts with none, as today.

alter table tables add column card_icon jsonb;

comment on column tables.card_icon is
  'The watermark icon of this table''s canvas cards: one icon, or chosen per record from a field''s value. See sql/024_card_icon.sql and src/contract/cardIcon.ts.';
