/**
 * ============================================================================
 *  Read surface.
 * ============================================================================
 *
 *  Reads are deliberately NOT symmetrical with writes. Writes go through the
 *  narrow mutation boundary because they must be replayable; reads just need to
 *  be fast and shaped for the screen that asks for them.
 *
 *  The one that matters is loadScene(): opening a canvas must be a single
 *  round trip. Fetching placements, then a record per placement, then links per
 *  record is the classic N+1 that turns a 40-card canvas into 80 queries.
 */

import type { PoolClient } from 'pg';
import type { MutationLogRow } from '../contract/events.js';
import { labelFrom, primaryKeyOf, type LabelField } from '../contract/labels.js';
import { ALL, inScope, type Scope } from '../contract/scope.js';

/* ────────────────────────────────────────────────────────────────────────────
 *  Schema — small, changes rarely, cache hard on the client and invalidate
 *  whenever a schema.* mutation arrives over the stream.
 * ──────────────────────────────────────────────────────────────────────────*/

export async function loadSchema(db: PoolClient) {
  // Sequential, not Promise.all: a single PoolClient cannot run concurrent
  // queries — pg serialises them and warns, and it errors outright in pg@9.
  const tables = await db.query(`select id, name, singular_name, color, icon, position, kind
                                   from tables order by position, name`);
  const fields = await db.query(`select id, table_id, name, key, type, options, position, required
                                   from fields order by table_id, position`);

  // Views ride along with the schema. They were writable (view.* mutations),
  // held in client state, captured by undo — and returned by no read at all, so
  // a saved view lived exactly until the next refresh. Same shape of gap as the
  // link fields the grid could not see: state that exists in two places, read
  // from one. They belong here rather than in their own endpoint because they
  // are small, per-table, and invalidated by the same events as fields.
  const views = await db.query(`select id, table_id, name, config, position
                                  from views order by table_id, position, created_at`);

  const group = (rows: Array<{ table_id: string }>) => {
    const m = new Map<string, unknown[]>();
    for (const r of rows) {
      if (!m.has(r.table_id)) m.set(r.table_id, []);
      m.get(r.table_id)!.push(r);
    }
    return m;
  };
  const fieldsBy = group(fields.rows), viewsBy = group(views.rows);
  return tables.rows.map((t) => ({
    ...t, fields: fieldsBy.get(t.id) ?? [], views: viewsBy.get(t.id) ?? [],
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Canvas scene — everything needed to paint a canvas, in one trip
 * ──────────────────────────────────────────────────────────────────────────*/

export interface Scene {
  canvas: { id: string; name: string; viewport: unknown };
  placements: Array<{
    record_id: string; x: number; y: number; w: number | null;
    h: number | null; z: number; collapsed: boolean; style: unknown;
  }>;
  records: Array<{ id: string; table_id: string; data: unknown }>;
  /** Only links where BOTH endpoints are placed on this canvas — those are the
   *  ones that can actually be drawn as arrows. */
  links: Array<{ id: string; field_id: string; from_record: string; to_record: string }>;
  annotations: Array<{ id: string; kind: string; geometry: unknown; style: unknown }>;
  /**
   * The log position this snapshot was taken at.
   *
   * The client stores it as its stream watermark and reconnects with
   * `?since=<seq>`. Without it, "refetch then resume the stream" always has
   * either a gap (resume too late, miss changes) or an overlap (resume too
   * early, re-apply changes the snapshot already contains). Reporting the
   * position from inside the same snapshot removes the guesswork: the client is
   * caught up to exactly here, no more and no less.
   *
   * This is what makes recovering from a `resync` event correct rather than
   * approximately correct.
   */
  seq: number;
}

/**
 * Opening a canvas is one round trip and one consistent snapshot.
 *
 * The five reads run inside REPEATABLE READ. Without a transaction they were
 * five independent snapshots, so a concurrent delete landing mid-read could
 * return a placement whose record was already gone — the client would try to
 * draw a card with no data. Cheap to prevent, and it is also what allows the
 * scene to report a single meaningful `seq`.
 */
export async function loadScene(db: PoolClient, canvasId: string): Promise<Scene | null> {
  await db.query('begin isolation level repeatable read');
  try {
    // A board is a RECORD in a table of kind 'canvas' (sql/010); `canvases` holds
    // only its state, created lazily. So "does this board exist" is asked of
    // records, and a board nobody has placed anything on yet is a perfectly good,
    // empty scene — not a 404. The left join supplies defaults for it.
    const canvas = await db.query(
      `select r.id, coalesce(c.viewport, '{}'::jsonb) as viewport, coalesce(c.config, '{}'::jsonb) as config
         from records r
         join tables t on t.id = r.table_id and t.kind = 'canvas'
         left join canvases c on c.id = r.id
        where r.id = $1`, [canvasId]);
    if (!canvas.rowCount) {
      await db.query('rollback');
      return null;
    }

    // Sequential, not Promise.all: one PoolClient cannot run concurrent queries.
    // These are indexed lookups on one canvas; round trips are not the
    // bottleneck (~2ms for the whole scene on the sample data).
    const placements = await db.query(
        `select record_id, x, y, w, h, z, collapsed, style
           from placements where canvas_id = $1 order by z, created_at`,
        [canvasId]);

    // Join through placements rather than issuing one query per card.
    // …plus the board's OWN record: its name is that record's primary field, and a
    // client arriving by URL may not have loaded the boards table.
    const records = await db.query(
        `select r.id, r.table_id, r.data
           from records r
           join placements p on p.record_id = r.id
          where p.canvas_id = $1
         union
         select r.id, r.table_id, r.data from records r where r.id = $1`,
        [canvasId]);

    // Both endpoints must be on this canvas, or there is nothing to draw.
    const links = await db.query(
        `select l.id, l.field_id, l.from_record, l.to_record
           from links l
           join placements pf on pf.record_id = l.from_record and pf.canvas_id = $1
           join placements pt on pt.record_id = l.to_record   and pt.canvas_id = $1`,
        [canvasId]);

    const annotations = await db.query(
      `select id, kind, geometry, style from canvas_annotations where canvas_id = $1`,
      [canvasId]);

    // Read inside the same snapshot as the data above — that is the entire point.
    const head = await db.query(`select coalesce(max(seq), 0) as seq from mutations`);

    await db.query('commit');

    return {
      canvas: canvas.rows[0],
      placements: placements.rows,
      records: records.rows,
      links: links.rows,
      annotations: annotations.rows,
      seq: Number(head.rows[0].seq),
    };
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

/** The log head on its own, for callers that need a watermark without a scene. */
export async function loadHead(db: PoolClient): Promise<number> {
  const { rows } = await db.query(`select coalesce(max(seq), 0) as seq from mutations`);
  return Number(rows[0].seq);
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Grid — records for one table
 * ──────────────────────────────────────────────────────────────────────────*/

export interface Page<T> {
  records: T[];
  /** True when more rows exist past this window. The tray needs to know so it
   *  can say "247 more" rather than silently pretending it showed everything. */
  hasMore: boolean;
}

/** Clamp caller-supplied paging so a bad query string cannot ask for the world. */
function paging(opts: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  return { limit, offset };
}

/**
 * The keyset cursor: "the (created_at, id) of the last row you were given".
 *
 * OPAQUE, and minted only by the server, because of one trap: node-pg parses
 * `timestamptz` into a JS Date, which has MILLISECOND precision, while Postgres
 * stores MICROSECONDS. A client building a cursor from the `created_at` it
 * received would send a truncated timestamp, and `(created_at, id) > (...)`
 * would then re-serve or skip rows that differ only below the millisecond —
 * which is every record created by one import batch. So the timestamp is taken
 * as `created_at::text` in SQL (full precision, offset included), never touches
 * a Date, and goes back into the comparison as `$n::timestamptz`.
 */
function encodeCursor(ts: string, id: string): string {
  return Buffer.from(JSON.stringify([ts, id])).toString('base64url');
}
function decodeCursor(cursor: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string'
      ? [v[0], v[1]] : null;
  } catch { return null; }
}

/** Thrown for a cursor that does not decode; the route turns it into a 400. */
export class BadCursor extends Error {}

export interface RecordPage {
  records: unknown[];
  hasMore: boolean;
  /** Pass back as `?after=` for the next page. Null on the last page. */
  nextCursor: string | null;
  /**
   * The log position this page was read at — same idea as `Scene.seq`. A page is
   * fetched while the stream is live, so an event can overtake the response: the
   * client applies seq 900, THEN ingests a page read at 899 and silently reverts
   * the row (or resurrects a deleted one). With this the client can tell a row it
   * has newer knowledge of from one it does not. See `ingestPage` in state.ts.
   */
  seq: number;
  /**
   * Links touching the returned records, in either direction.
   *
   * Included because a link is a ROW, not a value in `records.data` — the schema
   * models relations as rows so they can be FK-enforced and queried, which is
   * what makes endpoint validation and undo cascades possible. The cost is that a
   * grid rendering `record.data[field.key]` finds nothing for a link field and
   * shows it blank. The canvas read the `links` table and drew arrows; the grid
   * did not, so the same relation was visible in one view and invisible in the
   * other.
   */
  links: Array<{ field_id: string; from_record: string; to_record: string }>;
  /**
   * Display labels for records at the FAR end of those links, which usually live
   * in another table the client has not loaded. Without these the grid could only
   * show a UUID.
   *
   * `name` by convention, falling back to the first non-empty string value —
   * exactly the rule the canvas tray uses, kept identical so a record is not
   * called one thing in one place and another elsewhere.
   */
  labels: Record<string, string>;
}

export async function loadRecords(
  db: PoolClient,
  tableId: string,
  opts: { limit?: number; offset?: number; after?: string } = {},
): Promise<RecordPage> {
  const { limit, offset } = paging(opts);
  const after = opts.after ? decodeCursor(opts.after) : null;
  if (opts.after && !after) throw new BadCursor('unreadable cursor');

  // One snapshot for rows, links, labels and the seq that dates them — the same
  // reasoning as loadScene. Read-only, so the rollback paths are just hygiene.
  await db.query('begin isolation level repeatable read read only');
  try {
    const page = await loadRecordsIn(db, tableId, limit, offset, after);
    await db.query('commit');
    return page;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

async function loadRecordsIn(
  db: PoolClient, tableId: string, limit: number, offset: number,
  after: [string, string] | null,
): Promise<RecordPage> {
  const head = await db.query(`select coalesce(max(seq), 0) as seq from mutations`);
  const seq = Number(head.rows[0].seq);

  // Fetch one extra row to detect "more exist" without a second count query.
  //
  // KEYSET (`after`) is the path to use for walking a whole table. OFFSET is
  // kept for ad-hoc paging but is wrong for a walk: a row deleted from an
  // already-served page shifts every later row up by one, so the row that slid
  // across the page boundary is never served — and the stream cannot repair
  // that, because nothing happened to the skipped row. test/grid.ts shows both.
  const { rows } = after
    ? await db.query(
        `select id, table_id, data, created_at, updated_at, created_at::text as _ts
           from records
          where table_id = $1 and (created_at, id) > ($3::timestamptz, $4::uuid)
          order by created_at, id
          limit $2`,
        [tableId, limit + 1, after[0], after[1]])
    : await db.query(
        `select id, table_id, data, created_at, updated_at, created_at::text as _ts
           from records where table_id = $1
          order by created_at, id
          limit $2 offset $3`,
        [tableId, limit + 1, offset]);

  const hasMore = rows.length > limit;
  const served = rows.slice(0, limit);
  const last = served[served.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last._ts, last.id) : null;
  for (const r of served) delete r._ts;
  const records = served;
  const ids = records.map((r) => r.id as string);

  if (!ids.length) return { records, hasMore: false, nextCursor: null, seq, links: [], labels: {} };

  const links = await db.query(
    `select field_id, from_record, to_record
       from links where from_record = any($1::uuid[]) or to_record = any($1::uuid[])`,
    [ids],
  );

  // Label only the far ends we don't already have, and only those.
  const known = new Set(ids);
  const far = new Set<string>();
  for (const l of links.rows) {
    if (!known.has(l.from_record)) far.add(l.from_record);
    if (!known.has(l.to_record)) far.add(l.to_record);
  }

  // Labelled by each table's PRIMARY field (contract/labels.ts) — the same rule
  // the client applies to records it holds, so a chip reads the same before and
  // after its table loads. Far records can belong to any table, hence the join.
  const labels: Record<string, string> = {};
  const labelRows = far.size
    ? (await db.query(`select id, table_id, data from records where id = any($1::uuid[])`, [[...far]])).rows
    : [];
  const tableIds = [...new Set<string>([tableId, ...labelRows.map((r) => r.table_id as string)])];
  const primary = await primaryKeysFor(db, tableIds);
  for (const r of labelRows) labels[r.id] = labelFrom(r.data, primary.get(r.table_id), '(untitled)');
  for (const r of records) labels[r.id as string] = labelFrom(r.data, primary.get(tableId), '(untitled)');

  return { records, hasMore, nextCursor, seq, links: links.rows, labels };
}

/** table id → key of its primary field. One query, however many tables. */
async function primaryKeysFor(db: PoolClient, tableIds: string[]) {
  const { rows } = await db.query(
    `select table_id, key, type, position, name from fields where table_id = any($1::uuid[])`,
    [tableIds]);
  const byTable = new Map<string, LabelField[]>();
  for (const f of rows) {
    const a = byTable.get(f.table_id);
    if (a) a.push(f); else byTable.set(f.table_id, [f]);
  }
  return new Map(tableIds.map((id) => [id, primaryKeyOf(byTable.get(id) ?? [])] as const));
}

/**
 * Records NOT on a given canvas — the "unplaced" tray you drag from.
 *
 * Bounded. This previously had no limit at all, which meant it returned every
 * record in the database that was not on the current canvas — on a fresh canvas
 * that is the entire database, serialised into one JSON response, every time
 * the tray opens. Harmless with seed data, fatal by phase 2.
 *
 * Note the tie-break on `id` in the ordering. Without it, records sharing a
 * `created_at` (everything inserted in one batch, which is the common case)
 * order non-deterministically between queries, so paging can skip or repeat
 * rows. Batched creates make identical timestamps normal here, not rare.
 */
export async function loadUnplaced(
  db: PoolClient,
  canvasId: string,
  tableId?: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Page<unknown>> {
  const { limit, offset } = paging(opts);
  const { rows } = await db.query(
    `select r.id, r.table_id, r.data
       from records r
      where ($2::uuid is null or r.table_id = $2)
        and not exists (
          select 1 from placements p
           where p.record_id = r.id and p.canvas_id = $1)
      order by r.created_at, r.id
      limit $3 offset $4`,
    [canvasId, tableId ?? null, limit + 1, offset],
  );
  return { records: rows.slice(0, limit), hasMore: rows.length > limit };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Lookup resolution — the spec-vs-actual check
 *
 *  A `lookup` field carries { via_field_id, target_field_id }: follow the link,
 *  read a field off the far record. This is resolved server-side at read time
 *  rather than stored, so it can never go stale.
 * ──────────────────────────────────────────────────────────────────────────*/

export async function resolveLookup(
  db: PoolClient,
  lookupFieldId: string,
  recordIds: string[],
) {
  const { rows } = await db.query(
    `with cfg as (
       select options->>'via_field_id'    as via_field_id,
              options->>'target_field_id' as target_field_id
         from fields where id = $1
     ),
     target as (
       select f.key as target_key from fields f, cfg
        where f.id = cfg.target_field_id::uuid
     )
     select l.from_record as record_id,
            far.data -> (select target_key from target) as value
       from links l
       join cfg on l.field_id = cfg.via_field_id::uuid
       join records far on far.id = l.to_record
      where l.from_record = any($2::uuid[])`,
    [lookupFieldId, recordIds],
  );
  return rows;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Realtime catch-up
 *
 *  A client holds the last seq it applied. On (re)connect it asks for
 *  everything after that and replays it through the same code path used for
 *  optimistic local application — so live updates and reconnection are one
 *  mechanism, not two.
 * ──────────────────────────────────────────────────────────────────────────*/

export interface CatchUp {
  rows: MutationLogRow[];
  /**
   * The client's watermark is past the end of the log, so there is nothing to
   * send it and never will be. Reachable in normal operation: restoring from a
   * dump moves the head backwards, and so does pruning. Callers MUST tell the
   * client to resync rather than holding a silent connection open.
   */
  ahead: boolean;
  /**
   * The client is further behind than we are willing to replay. Callers MUST
   * treat this as "tell them to resync" and not send `rows` — a truncated prefix
   * is worse than nothing, because the client sets its watermark from the last
   * row it received, goes live, and skips the gap silently and permanently.
   */
  truncated: boolean;
  /** Current log head, so a truncated client learns how far behind it was. */
  head: number;
}

export async function mutationsSince(
  db: PoolClient,
  since: number,
  limit = 1000,
): Promise<CatchUp> {
  const head = await loadHead(db);

  // Checked BEFORE querying: `seq > <past the end>` matches nothing, which is
  // indistinguishable from "you are up to date" at the row level. The difference
  // is only visible by comparing against the head.
  if (since > head) return { rows: [], truncated: false, ahead: true, head };

  // One extra row is the truncation probe.
  const { rows } = await db.query(
    `select seq, id, client_id, type, payload, applied_at
       from mutations where seq > $1 order by seq limit $2`,
    [since, limit + 1],
  );

  if (rows.length > limit) return { rows: [], truncated: true, ahead: false, head };
  return { rows: rows as MutationLogRow[], truncated: false, ahead: false, head };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Undo
 *
 *  Note that `mutationsSince` above does NOT select the `undo` column, and must
 *  not: captures can be large and no client needs them on the realtime path.
 *  Undo reads them on demand, here.
 * ──────────────────────────────────────────────────────────────────────────*/

export interface UndoableEntry {
  seq: number;
  id: string;
  type: string;
  applied_at: string;
  actor_name: string | null;
  /** Row counts by table, so a UI can say "1 record, 3 links, 2 placements". */
  counts: Record<string, number>;
  total: number;
  /** Cascade too large to store — undo unavailable, restore from a dump. */
  truncated: boolean;
  /** Already reversed by a later `restore`, so offering undo again is noise. */
  undone_by: string | null;
}

/**
 * The recent destructive tail of the log — what there is to undo.
 *
 * `undone_by` exists because undo is itself a logged mutation: a `restore`
 * records which mutation it reversed, so "already undone" is a fact in the log
 * rather than state to track. It is not a hard block — undo is idempotent, so
 * pressing it twice does nothing — but a UI should grey it out.
 */
export async function loadUndoable(db: PoolClient, limit = 50): Promise<UndoableEntry[]> {
  const { rows } = await db.query(
    `select m.seq, m.id, m.type, m.applied_at,
            u.name as actor_name,
            m.undo->'counts'    as counts,
            m.undo->'total'     as total,
            m.undo->'truncated' as truncated,
            (select r.id from mutations r
              where r.type = 'restore'
                and r.payload->>'undoOf' = m.id::text
              order by r.seq desc limit 1) as undone_by
       from mutations m
       left join users u on u.id = m.actor_id
      where m.undo is not null
      order by m.seq desc
      limit $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    ...r,
    seq: Number(r.seq),
    total: Number(r.total ?? 0),
    counts: r.counts ?? {},
    truncated: r.truncated === true,
  }));
}

export interface UndoPayload {
  mutationId: string;
  type: string;
  applied_at: string;
  rows: unknown;
  counts: Record<string, number>;
  total: number;
  truncated: boolean;
}

/** The capture for one mutation — the rows a client needs to build `restore`. */
export async function loadUndo(
  db: PoolClient,
  mutationId: string,
): Promise<UndoPayload | null> {
  const { rows } = await db.query(
    `select id, type, applied_at, undo from mutations where id = $1`, [mutationId]);
  const row = rows[0];
  if (!row || !row.undo) return null;
  return {
    mutationId: row.id,
    type: row.type,
    applied_at: row.applied_at,
    rows: row.undo.rows,
    counts: row.undo.counts ?? {},
    total: Number(row.undo.total ?? 0),
    truncated: row.undo.truncated === true,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Search — for the command palette.
 *
 *  Finds records in ANY table, including ones the asking client has never
 *  opened, which is why it is a server read while the grid's own search is not.
 *
 *  THE RULE: every whitespace-separated term must appear somewhere in the
 *  record's VALUES, in any order, case-insensitively. "reel 3 prores" narrows.
 *
 *  SEARCH_EXPR must stay character-for-character identical to the index
 *  expression in sql/007_backlinks_and_search.sql, or Postgres will not use the
 *  index and every search becomes a scan of the whole table.
 *
 *  If nothing matches exactly, a second pass uses trigram word-similarity, so a
 *  typo ("deliverible") still finds its record. That pass is skipped silently
 *  when pg_trgm is not installed.
 *
 *  Ranking is done here, in JS, over a bounded candidate set: a match in the
 *  record's LABEL (its primary field) beats a match buried in some other value,
 *  and a label that STARTS with the term beats one that merely contains it.
 *  SQL cannot rank on the label cheaply — which field is primary is per table.
 * ──────────────────────────────────────────────────────────────────────────*/

const SEARCH_EXPR = `lower(jsonb_path_query_array(data, '$.*')::text)`;
const CANDIDATES = 300;

export interface SearchHit {
  record: { id: string; table_id: string; data: Record<string, unknown> }; label: string;
  /** Present when a scope was given: does this record belong to the scoped record? */
  inScope?: boolean;
}

/**
 * The asker's SCOPE, if they have one (contract/scope.ts). Search RANKS by it and
 * never filters on it — "I can't find it" is the worst failure a search can have,
 * so a scope decides what comes first, not what exists. The one exception is
 * ARCHIVED: a record whose every project is archived is left out, because that is
 * what archiving a project is for.
 */
export interface SearchScope { scopeTableId: string; scope: Scope; archived: string[]; showArchived: boolean }

export async function searchRecords(
  db: PoolClient, q: string, tableIds: string[], limit = 30, within?: SearchScope,
): Promise<{ results: SearchHit[]; fuzzy: boolean }> {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const tables = tableIds.filter((t) => /^[0-9a-f-]{36}$/i.test(t));
  // Nothing typed and no table named: there is no sensible "everything".
  if (!terms.length && !tables.length) return { results: [], fuzzy: false };
  limit = Math.min(Math.max(limit || 30, 1), 100);

  const scope = tables.length ? `table_id = any($1::uuid[])` : `true`;
  const base = tables.length ? [tables] : [];
  const n = base.length;
  // LIKE metacharacters in what the user typed are literals, not wildcards.
  const likes = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  let fuzzy = false;
  let { rows } = await db.query(
    `select id, table_id, data from records
      where ${scope} ${likes.map((_, i) => `and ${SEARCH_EXPR} like $${n + i + 1}`).join(' ')}
      order by created_at desc limit ${CANDIDATES}`,
    [...base, ...likes]);

  if (!rows.length && terms.length) {
    try {
      // `term <% text`: some WORD in the text is similar to the term. Index-backed.
      ({ rows } = await db.query(
        `select id, table_id, data from records
          where ${scope} ${terms.map((_, i) => `and $${n + i + 1} <% ${SEARCH_EXPR}`).join(' ')}
          order by ${terms.map((_, i) => `word_similarity($${n + i + 1}, ${SEARCH_EXPR})`).join(' + ')} desc
          limit ${limit}`,
        [...base, ...terms]));
      fuzzy = rows.length > 0;
    } catch { /* pg_trgm not installed: exact matching only */ }
  }

  // Which scope-table records does each candidate BELONG to? One query, through
  // membership-flagged link fields only. A candidate from a table with no
  // membership field belongs to nothing — and is therefore never "archived".
  const memberOf = new Map<string, string[]>();
  if (within && rows.length) {
    const m = await db.query(
      `select l.from_record, l.to_record
         from links l join fields f on f.id = l.field_id
        where l.from_record = any($1::uuid[])
          and f.options->>'membership' = 'true' and f.options->>'target_table_id' = $2`,
      [rows.map((r) => r.id), within.scopeTableId]);
    for (const x of m.rows) {
      const a = memberOf.get(x.from_record);
      if (a) a.push(x.to_record); else memberOf.set(x.from_record, [x.to_record]);
    }
    const archived = new Set(within.archived);
    rows = rows.filter((r) => inScope(ALL, memberOf.get(r.id) ?? [], archived, within.showArchived));
  }

  const primary = await primaryKeysFor(db, [...new Set(rows.map((r) => r.table_id as string))]);
  const hits = rows.map((r, i) => {
    const label = labelFrom(r.data, primary.get(r.table_id), '(untitled)');
    const l = label.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (l.startsWith(t)) score += 4;
      else if (new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(l)) score += 3;
      else if (l.includes(t)) score += 2;
    }
    const hit: SearchHit = { record: r, label };
    if (within && within.scope.kind !== 'all') {
      hit.inScope = inScope(within.scope, memberOf.get(r.id) ?? [], new Set(), true);
      // In-scope first, whatever else is true — then the label ranking within each.
      if (hit.inScope) score += 100;
    }
    return { hit, score, i };
  });
  // Stable: equal scores keep the query's order (newest first; similarity for fuzzy).
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  return { results: hits.slice(0, limit).map((h) => h.hit), fuzzy };
}
