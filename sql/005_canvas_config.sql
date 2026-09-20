-- ============================================================================
--  005 — a canvas can say how its cards look
-- ============================================================================
--
--  "On THIS board, File cards show codec and width." That is a property of the
--  canvas, not of each card: set it once and every File card on the board
--  follows, including ones placed later. So it lives on `canvases`, not in
--  `placements.style` (which stays for genuinely per-card things).
--
--  The shape is validated by src/contract/canvasConfig.ts on both sides — same
--  arrangement as views.config. Like a view's config it names fields by ID and is
--  tolerant of ids that no longer exist, so deleting a field (and undoing that)
--  needs no fix-up here.
--
--  No capture change needed: `restore` derives its column list from
--  pg_attribute, so an undone canvas.delete brings `config` back with it.

alter table canvases add column config jsonb not null default '{}'::jsonb;
