-- ============================================================================
--  018 — utility tables: a flag the owner sets, for the vocabulary tables
-- ============================================================================
--
--  Boards, reports and junctions are UTILITY tables by KIND: they exist to serve
--  the data tables, and the navigation folds them away ("show 3 utility tables").
--  Since Oct 17 the vocabularies live in tables too — Containers, Codecs, one row
--  per canonical name with an Aliases column — and those are ordinary tables of
--  records that ALSO only exist to serve others. Nobody browses Containers. So a
--  table can say so itself:
--
--    tables.utility   boolean, default false
--
--  Set and cleared by `table.update { utility }` (a tick in Table settings). It is
--  NAVIGATION only, like sections (009): a utility table is folded in the tree and
--  left out of the new-junction and canvas pickers, and is still there for links,
--  the link picker, the command palette, reports and the file drop's resolver
--  (which uses this flag for nothing — a vocabulary is whatever a link points at).
--  The flag was almost not added ("UI creep"); it is one tick, only really there
--  during the design phase, and the owner judged it worth having.

alter table tables add column utility boolean not null default false;

comment on column tables.utility is
  'Folded away in the navigation with the boards, reports and junctions; nothing else. See sql/018_utility.sql.';
