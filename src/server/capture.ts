/**
 * ============================================================================
 *  Capture — what a destructive mutation is about to destroy.
 * ============================================================================
 *
 *  Runs BEFORE the delete, inside the same transaction. If the delete rolls back
 *  so does the capture, and the two can never disagree.
 *
 *  The hard part is not the row being named. It is the CASCADE. `001_schema.sql`
 *  wires `on delete cascade` throughout, so deleting one record silently removes
 *  its links and its placements on every canvas — and un-deleting it has to bring
 *  exactly those back, no more and no less. This is precisely what soft deletes
 *  handle badly: a `deleted_at` on links cannot distinguish "removed because the
 *  record went" from "removed on purpose last Tuesday", so un-deleting either
 *  resurrects too much or too little. Capturing the ACTION rather than marking
 *  STATE sidesteps the question entirely.
 *
 *  Every query below mirrors a specific FK in 001_schema.sql. When you add a
 *  cascade there, add it here, or undo will quietly restore a partial object.
 */

import type { PoolClient } from 'pg';
import { CAPTURED_TABLES, type CapturedRows, type Mutation } from '../contract/mutations.js';

/**
 * Above this many rows we record counts instead of contents.
 *
 * Without a cap, deleting a 200,000-record table would write the whole table into
 * a single log row. TOAST would cope, but a mutation log where one row is 400MB is
 * its own problem — and undo of something that size is not the right tool anyway;
 * that is what a dump is for. So: capture generously, refuse to be absurd, and
 * say plainly when undo is unavailable rather than offering a button that would
 * time out.
 */
export const MAX_CAPTURE_ROWS = 10_000;

export interface Capture {
  rows: CapturedRows;
  counts: Record<string, number>;
  total: number;
  /** True when the cascade was too large to store. `rows` is then empty. */
  truncated: boolean;
}

function emptyRows(): CapturedRows {
  return {
    tables: [], fields: [], canvases: [], records: [],
    views: [], sections: [], links: [], placements: [], canvas_annotations: [],
    record_values: [],
  };
}

/**
 * All columns, as rows. `select *` on purpose: a capture must be able to restore
 * `created_at` and `created_by` byte-for-byte, so it cannot afford a hand-written
 * column list that drifts when the schema gains a column.
 */
/**
 * Everything that dies with a board: its state row, the cards placed ON it, its
 * annotations. `which` is a SQL predicate on the board's id.
 *
 * This is the cascade that is easiest to forget, because it is second-order:
 * record → canvases (010's foreign key) → placements and annotations (the original
 * ones). Miss it and undo brings the board's RECORD back with an empty canvas, and
 * nothing errors. Placements may already have been captured by record_id (a board
 * placed on itself, or a board on another board being deleted with its table), so
 * rows are de-duplicated by id.
 */
async function grabBoards(rows: CapturedRows, db: PoolClient, which: string, params: unknown[]) {
  await grab(rows, db, 'canvases', `select * from canvases where id ${which}`, params);
  if (!rows.canvases.length) return;
  const seen = new Set(rows.placements.map((p) => (p as { id: string }).id));
  const { rows: onBoards } = await db.query(`select * from placements where canvas_id ${which}`, params);
  for (const p of onBoards) if (!seen.has(p.id)) rows.placements.push(p);
  await grab(rows, db, 'canvas_annotations', `select * from canvas_annotations where canvas_id ${which}`, params);
}

async function grab(
  rows: CapturedRows,
  db: PoolClient,
  table: (typeof CAPTURED_TABLES)[number],
  sql: string,
  params: unknown[],
) {
  const { rows: got } = await db.query(sql, params);
  rows[table].push(...got);
}

export async function captureFor(db: PoolClient, m: Mutation): Promise<Capture | null> {
  const rows = emptyRows();

  switch (m.type) {
    case 'record.delete': {
      await grab(rows, db, 'records', `select * from records where id = $1`, [m.id]);
      if (!rows.records.length) return null;   // nothing there; nothing to undo
      // links(from_record) and links(to_record) both cascade.
      await grab(rows, db, 'links',
        `select * from links where from_record = $1 or to_record = $1`, [m.id]);
      // placements(record_id) cascades — every canvas this record sat on.
      await grab(rows, db, 'placements',
        `select * from placements where record_id = $1`, [m.id]);
      // If this record IS a board (sql/010), deleting it cascades into the board's
      // state and, through that, every card and annotation ON it.
      await grabBoards(rows, db, `= $1`, [m.id]);
      break;
    }

    case 'field.delete': {
      await grab(rows, db, 'fields', `select * from fields where id = $1`, [m.id]);
      if (!rows.fields.length) return null;
      // links(field_id) cascades.
      await grab(rows, db, 'links', `select * from links where field_id = $1`, [m.id]);
      // apply() strips this field's key from every record's data in the same
      // transaction (an unstripped key was unwritable — assertFieldKeysExist
      // rejects a key with no field — so "the value survives" was a trap, not a
      // feature). The records themselves are NOT deleted, so whole-row capture
      // is the wrong shape; keep exactly the values about to be stripped, keyed
      // by record, and restore merges them back. Runs before the strip because
      // captureFor always runs before applyOne.
      const { rows: vals } = await db.query(
        `select r.id as record_id, f.key, r.data -> f.key as value
           from records r
           join fields f on f.id = $1 and r.table_id = f.table_id
          where r.data ? f.key`,
        [m.id]);
      rows.record_values.push(...vals);
      break;
    }

    case 'table.delete': {
      await grab(rows, db, 'tables', `select * from tables where id = $1`, [m.id]);
      if (!rows.tables.length) return null;
      // fields(table_id), records(table_id), views(table_id) all cascade.
      await grab(rows, db, 'fields', `select * from fields where table_id = $1`, [m.id]);
      await grab(rows, db, 'records', `select * from records where table_id = $1`, [m.id]);
      await grab(rows, db, 'views', `select * from views where table_id = $1`, [m.id]);
      // Second-order: links die two ways — their field went, or an endpoint
      // record went. A link from ANOTHER table pointing INTO this one is
      // destroyed by the record cascade, and is easy to forget.
      await grab(rows, db, 'links',
        `select distinct l.* from links l
          where l.field_id in (select id from fields where table_id = $1)
             or l.from_record in (select id from records where table_id = $1)
             or l.to_record   in (select id from records where table_id = $1)`,
        [m.id]);
      // Placements of this table's records, on every canvas.
      await grab(rows, db, 'placements',
        `select p.* from placements p
          where p.record_id in (select id from records where table_id = $1)`,
        [m.id]);
      // A table of BOARDS takes every board's state and contents with it.
      await grabBoards(rows, db, `in (select id from records where table_id = $1)`, [m.id]);
      break;
    }

    case 'link.remove': {
      await grab(rows, db, 'links',
        `select * from links
          where field_id = $1 and from_record = $2 and to_record = $3`,
        [m.fieldId, m.fromRecord, m.toRecord]);
      if (!rows.links.length) return null;
      break;
    }

    case 'placement.remove': {
      // The one people will actually undo: "unplace" is a keystroke away from
      // "delete" in every canvas app ever built.
      await grab(rows, db, 'placements',
        `select * from placements where canvas_id = $1 and record_id = $2`,
        [m.canvasId, m.recordId]);
      if (!rows.placements.length) return null;
      break;
    }

    case 'annotation.delete': {
      await grab(rows, db, 'canvas_annotations',
        `select * from canvas_annotations where id = $1`, [m.id]);
      if (!rows.canvas_annotations.length) return null;
      break;
    }

    case 'section.delete': {
      // One row, no children: a section owns nothing (its tables are a list of ids).
      await grab(rows, db, 'sections', `select * from sections where id = $1`, [m.id]);
      if (!rows.sections.length) return null;
      break;
    }

    case 'view.delete': {
      await grab(rows, db, 'views', `select * from views where id = $1`, [m.id]);
      if (!rows.views.length) return null;
      break;
    }

    default:
      return null;   // not destructive
  }

  const counts: Record<string, number> = {};
  let total = 0;
  for (const table of CAPTURED_TABLES) {
    const n = rows[table].length;
    if (n) counts[table] = n;
    total += n;
  }
  // Not in CAPTURED_TABLES (it is not a table), but it is capture volume all the
  // same: stripping a key from 200,000 records must hit the same cap as deleting
  // them would.
  if (rows.record_values.length) {
    counts.record_values = rows.record_values.length;
    total += rows.record_values.length;
  }

  if (total > MAX_CAPTURE_ROWS) {
    // Keep the counts — knowing 43,000 rows went is useful even when you cannot
    // put them back — and say so honestly rather than storing a payload nobody
    // can use.
    return { rows: emptyRows(), counts, total, truncated: true };
  }

  return { rows, counts, total, truncated: false };
}
