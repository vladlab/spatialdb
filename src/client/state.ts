/**
 * ============================================================================
 *  Local state, and the ONE function that mutates it.
 * ============================================================================
 *
 *  `applyMutation` is called from exactly two places, and that is the whole
 *  point of the architecture:
 *
 *    1. optimistically, the instant the user does something, before any
 *       network call leaves; and
 *    2. from the stream, for every mutation any other client made — and for
 *       replayed history after a reconnect.
 *
 *  Same function, same input shape. Live updates, reconnection and (later)
 *  draining an offline queue are one mechanism rather than three.
 *
 *  ── IDEMPOTENCY IS THE LOAD-BEARING PROPERTY ──────────────────────────────
 *
 *  Applying the same mutation twice must be indistinguishable from applying it
 *  once. This is what turned the old stream-shape bug from untidy into
 *  destructive: the client failed to recognise the echo of its own writes on
 *  reconnect, re-applied them, and — because local apply was not idempotent —
 *  produced duplicate records.
 *
 *  The store has three independent guards against double-application:
 *
 *    1. drop any event whose `seq` is at or below the watermark  (store.ts)
 *    2. skip any event whose `clientId` is our own               (store.ts)
 *    3. make every apply idempotent                              (this file)
 *
 *  Any one of them alone is sufficient. Requiring all three to work is how you
 *  get a system that stays correct when one of them regresses — and one of them
 *  already did.
 *
 *  Idempotency here is mostly structural rather than defensive: state is keyed
 *  Maps, so "insert" is naturally an upsert and "delete" is naturally a no-op on
 *  something already gone. Where the server has interesting conflict semantics
 *  (`placement.add`'s `on conflict do update`), this mirrors them exactly —
 *  local and server apply must agree, or clients converge on the wrong answer.
 */

import type { Mutation } from '../contract/mutations.js';
import { compareFields, labelFrom, primaryKeyOf } from '../contract/labels.js';

/* ────────────────────────────────────────────────────────────────────────────
 *  Row shapes — deliberately the server's read shapes, snake_case and all.
 *
 *  Not camelCased on arrival. A scene payload can be dropped straight into
 *  state, and there is no third naming convention to keep straight. (The stream
 *  contract is camelCase because it mirrors the mutation contract, which the
 *  client also authors. Read payloads mirror the database, which it does not.)
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TableRow {
  id: string; name: string; singular_name: string;
  color: string; icon: string; position: number;
  /** 'canvas' = a table of BOARDS: each record in it is a canvas (sql/010). */
  kind?: 'records' | 'canvas';
}
export interface FieldRow {
  id: string; table_id: string; name: string; key: string; type: string;
  options: Record<string, unknown>; position: number; required: boolean;
}
export interface RecordRow {
  id: string; table_id: string; data: Record<string, unknown>;
}
/**
 * The STATE of a board — viewport and card settings — keyed by the id of the
 * RECORD that is the board (sql/010). It has no name: a board's name is its
 * record's primary field. An entry may be absent for a board nothing has been
 * placed on yet; read it with defaults.
 */
export interface CanvasRow {
  id: string;
  viewport?: unknown;
  /** Validated as contract/canvasConfig.ts on write; read tolerantly. */
  config?: unknown;
}
export interface PlacementRow {
  canvas_id: string; record_id: string;
  x: number; y: number; w: number | null; h: number | null; z: number;
  collapsed: boolean; style: Record<string, unknown>;
}
export interface LinkRow {
  id: string | null; field_id: string; from_record: string; to_record: string;
}
export interface AnnotationRow {
  id: string; canvas_id: string; kind: string;
  geometry: Record<string, unknown>; style: Record<string, unknown>;
}
export interface ViewRow {
  id: string; table_id: string; name: string;
  config: Record<string, unknown>; position: number;
}

/**
 * Placements and links are keyed by their NATURAL key, not by row id, because
 * that is what their mutations address. `placement.remove` carries
 * (canvasId, recordId) and `link.remove` carries (fieldId, from, to) — no row
 * id anywhere. Keying by row id would mean a scan to find what to delete, and
 * would make removal non-idempotent if the id were not known locally.
 *
 * Both keys match a UNIQUE constraint in the schema, so client and server agree
 * on identity by construction.
 */
export const placementKey = (canvasId: string, recordId: string) => `${canvasId}|${recordId}`;
export const linkKey = (fieldId: string, from: string, to: string) =>
  `${fieldId}|${from}|${to}`;

/** The app's navigation — see sql/009_sections.sql. Server shape, snake_case. */
export interface SectionRow {
  id: string; name: string; description: string; icon: string; color: string;
  table_ids: string[]; scope_table_id: string | null; archived_field_id: string | null;
  position: number;
}

export interface State {
  tables: Map<string, TableRow>;
  fields: Map<string, FieldRow>;
  records: Map<string, RecordRow>;
  canvases: Map<string, CanvasRow>;
  placements: Map<string, PlacementRow>;
  links: Map<string, LinkRow>;
  annotations: Map<string, AnnotationRow>;
  views: Map<string, ViewRow>;
  sections: Map<string, SectionRow>;
}

export function emptyState(): State {
  return {
    tables: new Map(), fields: new Map(), records: new Map(),
    canvases: new Map(), placements: new Map(), links: new Map(),
    annotations: new Map(), views: new Map(), sections: new Map(),
  };
}

export function clearState(state: State) {
  for (const collection of Object.values(state)) collection.clear();
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Cascades
 *
 *  The schema deletes with `on delete cascade`, so the client must too. Without
 *  this, deleting a record leaves its links and placements behind locally and
 *  the canvas draws arrows to cards that no longer exist — a divergence that
 *  survives until the next full refetch and looks like a rendering bug.
 * ──────────────────────────────────────────────────────────────────────────*/

function dropRecord(state: State, recordId: string) {
  state.records.delete(recordId);
  // If the record IS a board, its state, cards and annotations go with it — the
  // server's cascade (records → canvases → placements, annotations). Harmless
  // for an ordinary record: there is nothing keyed by its id to drop.
  dropCanvas(state, recordId);
  for (const [key, l] of state.links) {
    if (l.from_record === recordId || l.to_record === recordId) state.links.delete(key);
  }
  for (const [key, p] of state.placements) {
    if (p.record_id === recordId) state.placements.delete(key);
  }
}

function dropField(state: State, fieldId: string) {
  // Mirror of the server: deleting a field strips its key from every loaded
  // record of its table. Look the field up BEFORE deleting it — its key and
  // table are needed for the strip — and skip cleanly if it is already gone,
  // which keeps a replayed field.delete a no-op.
  const field = state.fields.get(fieldId);
  state.fields.delete(fieldId);
  if (field) {
    for (const r of state.records.values()) {
      if (r.table_id === field.table_id && field.key in r.data) delete r.data[field.key];
    }
  }
  for (const [key, l] of state.links) {
    if (l.field_id === fieldId) state.links.delete(key);
  }
}

function dropTable(state: State, tableId: string) {
  state.tables.delete(tableId);
  for (const f of [...state.fields.values()]) {
    if (f.table_id === tableId) dropField(state, f.id);
  }
  for (const r of [...state.records.values()]) {
    if (r.table_id === tableId) dropRecord(state, r.id);
  }
  for (const [id, v] of state.views) {
    if (v.table_id === tableId) state.views.delete(id);
  }
}

/** The board's state entry, created if this is the first thing to need it. */
function boardState(state: State, id: string): CanvasRow {
  let c = state.canvases.get(id);
  if (!c) { c = { id, viewport: {}, config: {} }; state.canvases.set(id, c); }
  return state.canvases.get(id)!;     // the reactive proxy, not the plain object just set
}

function dropCanvas(state: State, canvasId: string) {
  state.canvases.delete(canvasId);
  for (const [key, p] of state.placements) {
    if (p.canvas_id === canvasId) state.placements.delete(key);
  }
  for (const [id, a] of state.annotations) {
    if (a.canvas_id === canvasId) state.annotations.delete(id);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Apply
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Apply one mutation to local state. Idempotent for every mutation type.
 *
 * `create` is deliberately create-IF-ABSENT rather than overwrite. Overwriting
 * would be correct for an echo of our own write (identical data) but wrong for a
 * replayed create arriving after later updates to the same row — it would silently
 * revert them. The seq guard should prevent that ordering, but "should" is exactly
 * what the third guard exists not to rely on.
 *
 * The exception is `placement.add`, which mirrors the server's
 * `on conflict do update set x, y, z`: re-adding a placed record MOVES it. Client
 * and server must agree on that or the two diverge on a real user action —
 * dragging a card out of the tray onto a canvas it is already on.
 */
export function applyMutation(state: State, m: Mutation): void {
  switch (m.type) {
    /* ── schema ── */
    case 'table.create': {
      if (state.tables.has(m.id)) return;
      state.tables.set(m.id, {
        id: m.id, name: m.name, singular_name: m.singularName,
        color: m.color, icon: m.icon, position: 0, kind: m.kind ?? 'records',
      });
      return;
    }
    case 'table.update': {
      const t = state.tables.get(m.id);
      if (!t) return;   // unknown row: nothing to patch, and not an error
      if (m.name !== undefined) t.name = m.name;
      if (m.singularName !== undefined) t.singular_name = m.singularName;
      if (m.color !== undefined) t.color = m.color;
      if (m.icon !== undefined) t.icon = m.icon;
      if (m.position !== undefined) t.position = m.position;
      return;
    }
    case 'table.delete':
      dropTable(state, m.id);
      return;

    case 'field.create': {
      if (state.fields.has(m.id)) return;
      state.fields.set(m.id, {
        id: m.id, table_id: m.tableId, name: m.name, key: m.key,
        type: m.fieldType, options: m.options as Record<string, unknown>,
        // Appended, exactly as the server does (apply.ts says why it is not 0).
        position: Math.max(-1, ...[...state.fields.values()].filter((f) => f.table_id === m.tableId).map((f) => f.position)) + 1,
        required: m.required,
      });
      return;
    }
    case 'field.update': {
      const f = state.fields.get(m.id);
      if (!f) return;
      if (m.name !== undefined) f.name = m.name;
      if (m.options !== undefined) f.options = m.options as Record<string, unknown>;
      if (m.required !== undefined) f.required = m.required;
      if (m.position !== undefined) f.position = m.position;
      return;
    }
    case 'field.delete':
      dropField(state, m.id);
      return;

    /* ── records ── */
    case 'record.create': {
      if (state.records.has(m.id)) return;
      state.records.set(m.id, {
        id: m.id, table_id: m.tableId,
        data: { ...(m.data as Record<string, unknown>) },
      });
      return;
    }
    case 'record.update': {
      const r = state.records.get(m.id);
      if (!r) return;
      // Mirrors the server's `(data || patch) - unset`: per-FIELD merge, so two
      // people editing different fields of one record do not clobber each other.
      // Naturally idempotent — applying the same patch twice is the same state.
      r.data = { ...r.data, ...(m.set as Record<string, unknown>) };
      for (const key of m.unset) delete r.data[key];
      return;
    }
    case 'record.delete':
      dropRecord(state, m.id);
      return;

    /* ── links ── */
    case 'link.add': {
      const key = linkKey(m.fieldId, m.fromRecord, m.toRecord);
      if (state.links.has(key)) return;   // server: on conflict do nothing
      state.links.set(key, {
        id: m.id, field_id: m.fieldId,
        from_record: m.fromRecord, to_record: m.toRecord,
      });
      return;
    }
    case 'link.remove':
      state.links.delete(linkKey(m.fieldId, m.fromRecord, m.toRecord));
      return;

    /* ── canvases ── */
    // RETIRED (sql/010): still parsed so old log rows replay, never applied.
    case 'canvas.create':
    case 'canvas.delete':
      return;
    case 'canvas.update': {
      // Board state is created lazily — here too, exactly as the server does.
      const c = boardState(state, m.id);
      if (m.viewport !== undefined) c.viewport = m.viewport;
      if (m.config !== undefined) c.config = m.config;
      return;
    }

    /* ── placements ── */
    case 'placement.add': {
      boardState(state, m.canvasId);
      const key = placementKey(m.canvasId, m.recordId);
      const existing = state.placements.get(key);
      if (existing) {
        // Server: `on conflict (canvas_id, record_id) do update set x, y, z`.
        // Note w/h are NOT touched on conflict — mirrored exactly, because a
        // silent disagreement here shows up as a card that is the wrong size on
        // one screen and not another.
        existing.x = m.x;
        existing.y = m.y;
        existing.z = m.z;
        return;
      }
      state.placements.set(key, {
        canvas_id: m.canvasId, record_id: m.recordId,
        x: m.x, y: m.y, w: m.w, h: m.h, z: m.z,
        collapsed: false, style: {},
      });
      return;
    }
    case 'placement.move': {
      // One mutation covers every selected card. Setting coordinates is
      // absolutely idempotent — the same move applied twice is the same place.
      for (const mv of m.moves) {
        const p = state.placements.get(placementKey(m.canvasId, mv.recordId));
        if (!p) continue;
        p.x = mv.x;
        p.y = mv.y;
        if (mv.z !== undefined) p.z = mv.z;
      }
      return;
    }
    case 'placement.update': {
      const p = state.placements.get(placementKey(m.canvasId, m.recordId));
      if (!p) return;
      if (m.w !== undefined) p.w = m.w;
      if (m.h !== undefined) p.h = m.h;
      if (m.collapsed !== undefined) p.collapsed = m.collapsed;
      if (m.style !== undefined) p.style = m.style as Record<string, unknown>;
      return;
    }
    case 'placement.remove':
      // NOT a delete. The record survives and stays in its grid — see the note
      // on the placements table in 001_schema.sql.
      state.placements.delete(placementKey(m.canvasId, m.recordId));
      return;

    /* ── annotations ── */
    case 'annotation.create': {
      if (state.annotations.has(m.id)) return;
      state.annotations.set(m.id, {
        id: m.id, canvas_id: m.canvasId, kind: m.kind,
        geometry: m.geometry as Record<string, unknown>,
        style: m.style as Record<string, unknown>,
      });
      return;
    }
    case 'annotation.update': {
      const a = state.annotations.get(m.id);
      if (!a) return;
      if (m.geometry !== undefined) a.geometry = m.geometry as Record<string, unknown>;
      if (m.style !== undefined) a.style = m.style as Record<string, unknown>;
      return;
    }
    case 'annotation.delete':
      state.annotations.delete(m.id);
      return;

    /* ── views ── */
    case 'section.create':
      if (state.sections.has(m.id)) return;
      state.sections.set(m.id, {
        id: m.id, name: m.name, description: m.description ?? '', icon: m.icon ?? '', color: m.color ?? '',
        table_ids: [], scope_table_id: null, archived_field_id: null,
        position: Math.max(0, ...[...state.sections.values()].map((x) => x.position)) + 1,
      });
      return;
    case 'section.update': {
      const sec = state.sections.get(m.id);
      if (!sec) return;
      if (m.name !== undefined) sec.name = m.name;
      if (m.description !== undefined) sec.description = m.description;
      if (m.icon !== undefined) sec.icon = m.icon;
      if (m.color !== undefined) sec.color = m.color;
      if (m.tableIds !== undefined) sec.table_ids = [...m.tableIds];
      if (m.scopeTableId !== undefined) {
        sec.scope_table_id = m.scopeTableId;
        if (m.scopeTableId === null) sec.archived_field_id = null;   // as the server does
      }
      if (m.archivedFieldId !== undefined) sec.archived_field_id = m.archivedFieldId;
      if (m.position !== undefined) sec.position = m.position;
      return;
    }
    case 'section.delete':
      state.sections.delete(m.id);
      return;

    case 'view.create': {
      if (state.views.has(m.id)) return;
      state.views.set(m.id, {
        id: m.id, table_id: m.tableId, name: m.name,
        config: m.config as Record<string, unknown>, position: 0,
      });
      return;
    }
    case 'view.update': {
      const v = state.views.get(m.id);
      if (!v) return;
      if (m.name !== undefined) v.name = m.name;
      if (m.config !== undefined) v.config = m.config as Record<string, unknown>;
      if (m.position !== undefined) v.position = m.position;
      return;
    }
    case 'view.delete':
      state.views.delete(m.id);
      return;

    /* ── undo ── */
    case 'restore': {
      // The rows travel in the payload precisely so this is possible: undo is an
      // ordinary mutation the client can apply optimistically and a peer can
      // apply from the stream, with no special path. Every ingest below is
      // create-if-absent, so a replayed restore is a no-op.
      const r = m.rows as {
        tables: any[]; fields: any[]; canvases: any[]; records: any[];
        views: any[]; links: any[]; placements: any[]; canvas_annotations: any[];
      };
      for (const t of r.tables) if (!state.tables.has(t.id)) state.tables.set(t.id, t);
      for (const f of r.fields) if (!state.fields.has(f.id)) state.fields.set(f.id, f);
      for (const c of r.canvases) if (!state.canvases.has(c.id)) state.canvases.set(c.id, c);
      for (const rec of r.records) if (!state.records.has(rec.id)) state.records.set(rec.id, rec);
      for (const v of r.views) if (!state.views.has(v.id)) state.views.set(v.id, v);
      for (const sec of (r as any).sections ?? []) if (!state.sections.has(sec.id)) state.sections.set(sec.id, sec);
      for (const l of r.links) {
        const key = linkKey(l.field_id, l.from_record, l.to_record);
        if (!state.links.has(key)) state.links.set(key, l);
      }
      for (const p of r.placements) {
        const key = placementKey(p.canvas_id, p.record_id);
        if (!state.placements.has(key)) state.placements.set(key, p);
      }
      for (const a of r.canvas_annotations) {
        if (!state.annotations.has(a.id)) state.annotations.set(a.id, a);
      }
      // Values stripped by a field.delete, merged back key-by-key. Same three
      // guards as the server (record exists / a field with that key exists on
      // its table / key still absent), so both sides converge on the same data
      // — and set-if-absent keeps a replayed restore a no-op here too.
      for (const v of (r as any).record_values ?? []) {
        const rec = state.records.get(v.record_id);
        if (!rec || v.key in rec.data) continue;
        let fieldExists = false;
        for (const f of state.fields.values()) {
          if (f.table_id === rec.table_id && f.key === v.key) { fieldExists = true; break; }
        }
        if (fieldExists) rec.data[v.key] = v.value;
      }
      return;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Hydration from read endpoints
 * ──────────────────────────────────────────────────────────────────────────*/

export function ingestSchema(
  state: State,
  tables: Array<TableRow & { fields: FieldRow[]; views?: ViewRow[] }>,
) {
  for (const t of tables) {
    const { fields, views, ...table } = t;
    state.tables.set(table.id, table as TableRow);
    for (const f of fields) state.fields.set(f.id, f);
    for (const v of views ?? []) state.views.set(v.id, v);
  }
}

export function ingestRecords(state: State, records: RecordRow[]) {
  for (const r of records) state.records.set(r.id, r);
}

/* ── pages, and the two ways a page can be stale ───────────────────────────

   A page of records is fetched while the client is LIVE — the stream is
   applying events and the user may be typing. So by the time a page arrives it
   can be older than what the client already knows, in two ways:

   1. A stream event overtakes the HTTP response. We apply seq 900 (a peer
      deleted row X), then ingest a page read at 899 that still contains X.
      X is resurrected, and nothing will ever remove it again: the delete
      event is behind the watermark.
   2. The user edits a row whose page has not arrived. The page overwrites the
      optimistic value, and the echo that would have restored it is skipped
      BECAUSE it is our own. The cell silently reverts; the server has the edit.

   Both were possible before whole-table loading and nearly unreachable, because
   a table was one request. Walking a 50k-row table is a hundred requests over a
   second or more — a window wide enough to type into.

   So the store records what it touched while a load is in flight, and ingest
   skips any row the client knows something NEWER about than the page does.
   "Newer" needs the page to say how old it is — hence `page.seq`. Local writes
   are stamped Infinity: nothing the server has not yet seen can be older than
   any snapshot. */

/** Identity of whatever a mutation changes that a records page could clobber. */
export function touchedBy(m: Mutation): string[] {
  switch (m.type) {
    case 'record.create':
    case 'record.update':
    case 'record.delete':
      return [`r:${m.id}`];
    case 'link.add':
    case 'link.remove':
      return [`l:${linkKey(m.fieldId, m.fromRecord, m.toRecord)}`];
    case 'restore': {
      const r = m.rows as unknown as {
        records?: Array<{ id: string }>; record_values?: Array<{ record_id: string }>;
        links?: Array<{ field_id: string; from_record: string; to_record: string }>;
      };
      return [
        ...(r.records ?? []).map((x) => `r:${x.id}`),
        ...(r.record_values ?? []).map((x) => `r:${x.record_id}`),
        ...(r.links ?? []).map((l) => `l:${linkKey(l.field_id, l.from_record, l.to_record)}`),
      ];
    }
    default:
      // table.delete / field.delete are not tracked. A stale page after either
      // can only add rows to a table that no longer renders, or a key no field
      // displays; both are invisible and gone on the next load.
      return [];
  }
}

export interface RecordsPage {
  records: RecordRow[];
  links?: Array<{ field_id: string; from_record: string; to_record: string }>;
  seq: number;
}

/** Ingest a page, skipping anything `touched` says we know better. Returns rows taken. */
export function ingestPage(
  state: State, page: RecordsPage, touched: ReadonlyMap<string, number>,
): number {
  const newer = (key: string) => (touched.get(key) ?? -1) > page.seq;
  let taken = 0;
  for (const r of page.records) {
    if (newer(`r:${r.id}`)) continue;
    state.records.set(r.id, r);
    taken++;
  }
  for (const l of page.links ?? []) {
    const key = linkKey(l.field_id, l.from_record, l.to_record);
    if (newer(`l:${key}`)) continue;
    state.links.set(key, { id: null, ...l });
  }
  return taken;
}

/**
 * `/api/canvases`: every board — its RECORD and its state in one row. Both are
 * kept: the record so the board can be named and listed, the state so it can be
 * drawn. Records already held are left alone (they may be newer).
 */
export function ingestCanvases(
  state: State, boards: Array<RecordRow & { config?: unknown; viewport?: unknown }>,
) {
  for (const b of boards) {
    const { config, viewport, ...record } = b;
    if (!state.records.has(record.id)) state.records.set(record.id, record);
    state.canvases.set(b.id, { id: b.id, config, viewport });
  }
}

/** Tables whose records are boards. */
export const isBoardsTable = (t: TableRow | undefined) => t?.kind === 'canvas';

/** Every board the client knows of, optionally only those in the given tables. */
export function boardsOf(state: State, tableIds?: ReadonlySet<string>): RecordRow[] {
  return [...state.records.values()].filter((r) =>
    isBoardsTable(state.tables.get(r.table_id)) && (!tableIds || tableIds.has(r.table_id)));
}

/** A `/api/canvases/:id/scene` payload. Phase 2 will lean on this. */
export function ingestScene(
  state: State,
  scene: {
    canvas: CanvasRow;
    placements: Array<Omit<PlacementRow, 'canvas_id'>>;
    records: RecordRow[];
    links: LinkRow[];
    annotations: Array<Omit<AnnotationRow, 'canvas_id'>>;
  },
) {
  state.canvases.set(scene.canvas.id, scene.canvas);
  for (const p of scene.placements) {
    state.placements.set(placementKey(scene.canvas.id, p.record_id),
      { ...p, canvas_id: scene.canvas.id });
  }
  ingestRecords(state, scene.records);
  for (const l of scene.links) {
    state.links.set(linkKey(l.field_id, l.from_record, l.to_record), l);
  }
  for (const a of scene.annotations) {
    state.annotations.set(a.id, { ...a, canvas_id: scene.canvas.id });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Selectors
 * ──────────────────────────────────────────────────────────────────────────*/

export function fieldsOf(state: State, tableId: string): FieldRow[] {
  return [...state.fields.values()]
    .filter((f) => f.table_id === tableId)
    .sort(compareFields);   // the ONE field order — see contract/labels.ts
}

export function recordsOf(state: State, tableId: string): RecordRow[] {
  return [...state.records.values()].filter((r) => r.table_id === tableId);
}

/**
 * What to CALL a record — chips, the tray, the link picker, card titles. The
 * rule lives in contract/labels.ts (the server uses it too): the table's first
 * plain-valued field, by position.
 *
 * `primaryKeys` is the hot-path form: one pass over the fields, then a Map
 * lookup per record. Anything labelling MANY records (the picker's candidate
 * list, sorting by a link column) should hold it in a computed and call
 * `labelFrom` itself; `recordLabel` is the convenience for a handful.
 */
export function primaryKeys(state: State): Map<string, string | undefined> {
  const byTable = new Map<string, FieldRow[]>();
  for (const f of state.fields.values()) {
    const a = byTable.get(f.table_id);
    if (a) a.push(f); else byTable.set(f.table_id, [f]);
  }
  const out = new Map<string, string | undefined>();
  for (const [tableId, fs] of byTable) out.set(tableId, primaryKeyOf(fs));
  return out;
}

export function recordLabel(
  state: State, r: { id: string; table_id: string; data: Record<string, unknown> },
  keys: Map<string, string | undefined> = primaryKeys(state),
): string {
  return labelFrom(r.data, keys.get(r.table_id), r.id.slice(0, 8));
}

export function sectionsSorted(state: State): SectionRow[] {
  return [...state.sections.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * The tables a section offers, in ITS order, skipping ids that no longer resolve
 * (a deleted table — which reappears here by itself if that delete is undone).
 * `null` section = "Everything": every table.
 */
export function tablesOfSection(state: State, section: SectionRow | null | undefined): TableRow[] {
  if (!section) return tablesSorted(state);
  return section.table_ids.map((id) => state.tables.get(id)).filter((t): t is TableRow => !!t);
}

export function viewsOf(state: State, tableId: string): ViewRow[] {
  return [...state.views.values()]
    .filter((v) => v.table_id === tableId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function tablesSorted(state: State): TableRow[] {
  return [...state.tables.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
