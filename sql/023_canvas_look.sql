-- ============================================================================
--  023 — card settings shared by every canvas of a table
-- ============================================================================
--
--  CANVAS-BRIEF.md Part A (Nov 14, 2026). Every Work has a canvas now (022), and
--  setting the same card fields on each one by hand was the complaint. So the LOOK
--  of a canvas — which fields its cards show, hide-empty and pins, colour rules,
--  glow (contract/canvasConfig.ts LOOK_KEYS) — lives on its HOME TABLE by default:
--
--    tables.canvas_look   jsonb, null = none set (today's defaults)
--
--  Written by `table.update { canvasLook }`, replaced whole, undoable like any
--  table.update. A canvas whose config ticks `ownLook` keeps its own look instead,
--  all of it. `defaults` and `stacks` were never part of a look: they stay per canvas.
--
--  Nothing must change on screen at deploy. So every canvas that already says
--  ANYTHING about how its cards look — a non-empty `cardFields`, `hideEmpty`, pins,
--  rules, a glow — is ticked `ownLook` here and keeps exactly what it had. Canvases
--  with nothing set (most of them, and every new one) share from now on; their
--  table has no look yet, so they read the defaults, as they did.
--  The test mirrors contract/canvasConfig.ts `hasLook`.

alter table tables add column canvas_look jsonb;

comment on column tables.canvas_look is
  'The shared card settings of every canvas whose record is in this table, unless the canvas config ticks ownLook. See sql/023_canvas_look.sql.';

update canvases set config = config || '{"ownLook": true}'::jsonb
 where coalesce(config->'cardFields', '{}'::jsonb) <> '{}'::jsonb
    or coalesce(config->'pinnedFields', '{}'::jsonb) <> '{}'::jsonb
    or coalesce(config->'rules', '{}'::jsonb) <> '{}'::jsonb
    or coalesce(config->'hideEmpty', 'false'::jsonb) = 'true'::jsonb
    or (config ? 'glow' and config->'glow' <> 'null'::jsonb);
