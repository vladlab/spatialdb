/**
 * ============================================================================
 *  Server-side application of mutations.
 * ============================================================================
 *
 *  applyBatch() is the ONLY function in the system that writes. Everything
 *  else reads. Keeping that literally true is what makes the offline story
 *  cheap later — an offline queue just calls this with a backlog.
 *
 *  Invariants enforced here (not in the client, which can lie):
 *    - role gating on schema mutations
 *    - BOTH of a link's endpoints match their tables: the source in the table
 *      that owns the field, the target in the field's configured target table
 *    - record data keys name real fields on that record's table, on create as
 *      well as on update
 *
 *  NOT enforced, deliberately, and worth a decision before phase 3 makes it
 *  user-visible: field VALUES are unchecked. A `number` field will accept
 *  "banana". Keys are structural (a wrong key is always a bug); values are the
 *  kind of thing a grid editor should coerce and a schema-driven form should
 *  constrain. Adding it here means a type-per-field validator and a decision
 *  about what to do with the rows already in the database.
 */

import type { Pool, PoolClient } from 'pg';
import {
  DESTRUCTIVE_MUTATIONS, Mutation, MutationRequest, SCHEMA_MUTATIONS,
  type CapturedRows,
} from '../contract/mutations.js';
import { toMutationEvent, type MutationEvent } from '../contract/events.js';
import { validateValue } from '../contract/values.js';
import { lookupConfigError, type LookupFieldInfo } from '../contract/lookups.js';
import { backlinkConfigError } from '../contract/backlinks.js';
import { arrowStyleError } from '../contract/arrows.js';
import { countOptionError } from '../contract/pills.js';
import { compareConfigError } from '../contract/compare.js';
import { linkMatchError } from '../contract/match.js';
import { SYSTEM_FIELD_TYPES, isSystemKey } from '../contract/systemFields.js';
import { assetIdsIn } from '../contract/richtext.js';
import { membershipError } from '../contract/scope.js';
import { shapeOptionError } from '../contract/shapes.js';
import { reportDefError } from '../contract/reports.js';
import { toolsProblem } from '../contract/tools.js';
import { vocabularyOptionError } from '../contract/vocab.js';
import { junctionColumnTarget, junctionOf, junctionProblem } from '../contract/junction.js';
import { captureFor, JUNCTION_ROWS_OF, uncapturableMessage, type Capture } from './capture.js';

export class MutationError extends Error {
  /**
   * The idempotency key of the mutation this was thrown for, once applyBatch knows
   * it. Goes back to the client as `failed` (server/failures.ts), which is what lets
   * it give up ONE action instead of the whole batch.
   */
  mutationId?: string;
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Name the mutation an error belongs to — any error, not only ours (a Postgres one too). */
function blame<E>(err: E, mutationId: string): E {
  if (err && typeof err === 'object' && (err as { mutationId?: string }).mutationId === undefined) {
    try { (err as { mutationId?: string }).mutationId = mutationId; } catch { /* frozen: goes unnamed */ }
  }
  return err;
}

export interface Actor {
  id: string;
  role: 'admin' | 'editor' | 'viewer';
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Validation that needs the database
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * BOTH endpoints, not just the target.
 *
 * A link's identity is (field, from, to). The field belongs to exactly one
 * table, so `fromRecord` must live in that table just as surely as `toRecord`
 * must live in the field's configured target table. Only the target used to be
 * checked, which let a Files record own a link on an Edits-owned `outputs`
 * field — loadScene would return it and the canvas would draw a nonsense arrow.
 * Bad rows also get more expensive to find the longer they accumulate.
 */
async function assertLinkEndpointsValid(
  db: PoolClient,
  fieldId: string,
  fromRecord: string,
  toRecord: string,
) {
  const { rows } = await db.query(
    `select f.type,
            f.table_id                          as owner_table_id,
            f.options->>'target_table_id'       as target_table_id,
            src.table_id                        as from_table_id,
            dst.table_id                        as to_table_id
       from fields f
       left join records src on src.id = $2
       left join records dst on dst.id = $3
      where f.id = $1`,
    [fieldId, fromRecord, toRecord],
  );
  const row = rows[0];
  if (!row) throw new MutationError('link field does not exist');
  if (row.type !== 'link') throw new MutationError('field is not a link field');

  if (!row.from_table_id) throw new MutationError('source record does not exist');
  if (row.from_table_id !== row.owner_table_id) {
    throw new MutationError(
      `link source must be in table ${row.owner_table_id} (which owns this field), ` +
        `got ${row.from_table_id}`,
    );
  }

  if (!row.to_table_id) throw new MutationError('target record does not exist');
  if (row.target_table_id && row.to_table_id !== row.target_table_id) {
    throw new MutationError(
      `link target must be in table ${row.target_table_id}, got ${row.to_table_id}`,
    );
  }
}

/**
 * A lookup's configuration must make sense WHEN IT IS WRITTEN: follow a link
 * field on its own table, show a readable field on the table that link points
 * at. The rule is `lookupConfigError` in contract/lookups.ts — the same function
 * the field form runs — fed here from one query instead of from the store.
 *
 * Only checked on write. A lookup can still BREAK later (its link field or far
 * field is deleted); that is tolerated at read time on purpose — see the
 * contract file.
 */
async function assertLookupConfigValid(
  db: PoolClient, tableId: string, options: Record<string, unknown> | undefined,
) {
  const ids = [options?.via_field_id, options?.target_field_id].filter((x): x is string => typeof x === 'string');
  // Not uuids → not fields. Asking Postgres would be a 500 (invalid uuid syntax).
  const valid = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const { rows } = valid.length
    ? await db.query(`select id, table_id, key, type, options from fields where id = any($1::uuid[])`, [valid])
    : { rows: [] as LookupFieldInfo[] };
  const err = lookupConfigError(tableId, options, (id) => rows.find((r) => r.id === id));
  if (err) throw new MutationError(`lookup: ${err}`);
}

/**
 * A board's STATE row (viewport, card settings) is created the first time
 * something needs it — a placement, a viewport save, an annotation — not when the
 * board's record is created. That is what lets a board be made by an ordinary
 * `record.create`, from anywhere, with no special case (sql/010_boards.sql).
 *
 * It also guards the door: the id must be a record in a table of kind 'canvas'.
 * Without that, anything with a uuid could be turned into a canvas by placing a
 * card "on" it.
 */
async function ensureBoardState(db: PoolClient, id: string) {
  const made = await db.query(
    `insert into canvases (id)
       select r.id from records r join tables t on t.id = r.table_id
        where r.id = $1 and t.kind = 'canvas'
     on conflict (id) do nothing`, [id]);
  if (made.rowCount) return;
  const exists = await db.query(`select 1 from canvases where id = $1`, [id]);
  if (!exists.rowCount) throw new MutationError('not a board: that id is not a record in a boards table');
}

/** `options.arrow`, if present, must be a style the canvas can draw — contract/arrows.ts. */
/** `options.compare` on a link: every pair names a field on the right side with a legal rule. */
async function assertCompareValid(db: PoolClient, tableId: string, fieldType: string, options: Record<string, unknown> | undefined) {
  if (!options || options.compare === undefined) return;
  let target = String(options.target_table_id ?? '');
  if (fieldType === 'backlink') {
    // A JUNCTION column compares against the other end's table (sql/016); no other backlink compares.
    const t = await compareTargetOfBacklink(db, options);
    if (!t) throw new MutationError('compare: only a link, or the column of a junction, can compare');
    target = t;
  } else if (fieldType !== 'link') throw new MutationError('compare: only a link, or the column of a junction, can compare');
  const fields = (await db.query(`select id, key, name, type, table_id, options from fields where table_id = $1 or table_id = $2`, [tableId, target])).rows;
  const err = compareConfigError({ table_id: tableId, options }, fields, target);
  if (err) throw new MutationError(err);
}

/** The table a junction column's comparisons are against, or null when the backlink is no junction column. */
export async function compareTargetOfBacklink(db: PoolClient | Pool, options: Record<string, unknown> | null | undefined): Promise<string | null> {
  const fields = (await db.query(`select id, table_id, type, options from fields`)).rows;
  const junctions = (await db.query(`select kind, junction from tables where kind = 'junction'`)).rows;
  const byId = new Map(fields.map((f) => [f.id, f]));
  return junctionColumnTarget({ type: 'backlink', options }, (id) => byId.get(id), junctions);
}

/** `tables.tools` — the mapping must name this table's own fields, of types that accept each output (contract/tools.ts). */
async function assertToolsValid(db: PoolClient, tableId: string, tools: Record<string, unknown>) {
  const fields = (await db.query(`select id, type, options from fields where table_id = $1`, [tableId])).rows;
  const err = toolsProblem(tools, fields);
  if (err) throw new MutationError(err);
}

/**
 * `tables.junction` — only on a table of kind 'junction'; the endpoints, status and
 * match pairs must be real fields in the right places (contract/junction.ts).
 * Every field is fetched: the match pairs live on the two endpoint tables, whose
 * ids are only known once the config parses, and the schema is small.
 */
async function assertJunctionValid(db: PoolClient, tableId: string, junction: Record<string, unknown>) {
  const t = await db.query(`select kind from tables where id = $1`, [tableId]);
  if (!t.rowCount) throw new MutationError('table does not exist');
  if (t.rows[0].kind !== 'junction') throw new MutationError(`only a table of kind 'junction' has a junction config`);
  const fields = (await db.query(`select id, table_id, type, options from fields`)).rows;
  const err = junctionProblem(tableId, junction, fields);
  if (err) throw new MutationError(`junction: ${err}`);
}

/**
 * What a batch must leave true of every junction row it touched (sql/016):
 * exactly one link through each endpoint, and no other row of the same table
 * making the same pair. Checked at the END of the batch, so "create the row and
 * its two links" is legal in any order within one request, and a row can never
 * exist half-connected across a commit.
 */
async function assertJunctionRowsWhole(db: PoolClient, touched: Array<{ recordId: string; by: string }>) {
  // The LAST mutation to touch a row is the one named when the row is not whole.
  const by = new Map(touched.map((t) => [t.recordId, t.by]));
  const ids = [...by.keys()];
  if (!ids.length) return;
  const refuse = (recordId: string, message: string) => blame(new MutationError(message), by.get(recordId) ?? '');
  const { rows } = await db.query(
    `select r.id, t.kind, t.junction, t.name from records r join tables t on t.id = r.table_id
      where r.id = any($1::uuid[]) and t.kind = 'junction'`, [ids]);
  for (const r of rows) {
    const cfg = junctionOf(r);
    if (!cfg) continue;   // not configured yet (table.create ran, table.update has not): nothing to hold it to
    const ends = await db.query(
      `select (select array_agg(to_record) from links where field_id = $2 and from_record = $1) as a,
              (select array_agg(to_record) from links where field_id = $3 and from_record = $1) as b`,
      [r.id, cfg.a, cfg.b]);
    const a: string[] = ends.rows[0].a ?? [], b: string[] = ends.rows[0].b ?? [];
    if (a.length !== 1 || b.length !== 1) {
      throw refuse(r.id,
        `a row of '${r.name}' must link exactly one record through each endpoint (has ${a.length} and ${b.length}) — ` +
        `create it with both links in one batch, and delete the row rather than unlinking an end`);
    }
    const dupe = await db.query(
      `select 1 from links la join links lb on lb.from_record = la.from_record
        where la.field_id = $1 and la.to_record = $2 and lb.field_id = $3 and lb.to_record = $4 and la.from_record <> $5`,
      [cfg.a, a[0], cfg.b, b[0], r.id]);
    if (dupe.rowCount) throw refuse(r.id, `'${r.name}' already has a row for that pair — edit it instead of making another`);
  }
}

/**
 * `options.match` on a link — the pairs of fields its picker narrows by
 * (contract/match.ts): each pair one link-like field of the link's own table and
 * one of its target table, leading to the same table.
 *
 * What is NEW must be right; pairs the field already held are left alone (the
 * contract says why: a match can break later and is then merely inert, and must
 * not hold the field's other settings hostage). `was` is the stored value on an
 * update.
 */
async function assertLinkMatchValid(
  db: PoolClient, link: { id: string; table_id: string; type: string; options: Record<string, unknown> | undefined }, was?: unknown,
) {
  if (link.options?.match === undefined) return;
  // Every field: a pair's backlink side is resolved through its source field, on
  // a third table. The schema is small (assertJunctionValid does the same).
  const fields = (await db.query(`select id, table_id, type, options from fields`)).rows;
  const byId = new Map<string, { id: string; table_id: string; type: string; options: Record<string, unknown> | null }>(fields.map((f) => [f.id, f]));
  const err = linkMatchError({ ...link, options: link.options }, (id) => byId.get(id), was);
  if (err) throw new MutationError(err);
}

function assertArrowStyleValid(options: Record<string, unknown> | undefined) {
  const err = arrowStyleError(options);
  if (err) throw new MutationError(err);
}

/**
 * `options.membership` — "records of this table BELONG to what this links to"
 * (contract/scope.ts). Shape is the contract's; what needs the database is
 * uniqueness: at most one membership field per table per target, because a new
 * record made inside a scope is auto-linked through it and there must be exactly
 * one answer to "through which field?".
 */
async function assertMembershipValid(
  db: PoolClient, tableId: string, fieldType: string, options: Record<string, unknown> | undefined, selfId: string,
) {
  const err = membershipError(fieldType, options);
  if (err) throw new MutationError(err);
  if (options?.membership !== true) return;
  const clash = await db.query(
    `select name from fields
      where table_id = $1 and id <> $2 and type = 'link'
        and options->>'membership' = 'true' and options->>'target_table_id' = $3`,
    [tableId, selfId, String(options.target_table_id ?? '')]);
  if (clash.rowCount) {
    throw new MutationError(`'${clash.rows[0].name}' is already this table's membership link to that table — a table belongs through ONE field`);
  }
}

/** The same, for backlinks — rule in contract/backlinks.ts. */
async function assertBacklinkConfigValid(
  db: PoolClient, tableId: string, options: Record<string, unknown> | undefined,
) {
  const id = options?.source_field_id;
  const { rows } = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
    ? await db.query(`select id, table_id, key, type, options from fields where id = $1`, [id])
    : { rows: [] as LookupFieldInfo[] };
  const err = backlinkConfigError(tableId, options, (x) => rows.find((r) => r.id === x));
  if (err) throw new MutationError(`backlink: ${err}`);
}

/**
 * Keys must name real fields on the given table.
 *
 * Keyed on TABLE rather than record so that `record.create` can use it too. The
 * old version took a record id, which meant a create — where the record does
 * not exist yet — could only pass an empty key list and validated nothing. The
 * header comment above claimed this invariant was enforced; for creates it was
 * not, so `{"not_a_field": "x"}` stored happily while the identical key was
 * rejected on update.
 */
async function assertFieldKeysExistForTable(db: PoolClient, tableId: string, keys: string[]) {
  if (keys.length === 0) return;
  const { rows } = await db.query(`select key from fields where table_id = $1`, [tableId]);
  const known = new Set(rows.map((r) => r.key as string));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length) {
    throw new MutationError(`unknown field key(s): ${unknown.join(', ')}`);
  }
}

/** Same check, for a record that already exists. */
async function assertFieldKeysExist(db: PoolClient, recordId: string, keys: string[]) {
  if (keys.length === 0) return;
  const { rows } = await db.query(`select table_id from records where id = $1`, [recordId]);
  if (!rows[0]) throw new MutationError('record does not exist');
  await assertFieldKeysExistForTable(db, rows[0].table_id, keys);
}

/**
 * Values must be legal for their field's type — the rule itself lives in
 * contract/values.ts so the client can apply the identical check before
 * queueing. Enforced here for the same reason keys are: the contract file only
 * protects clients that use it.
 *
 * WRITE-TIME ONLY, deliberately. Rows that predate a rule are left as they
 * are; a bad old value surfaces the next time that field is edited, which is
 * when someone can actually fix it. (`unset` never comes through here — it
 * removes values and there is nothing to validate about an absence.)
 */
async function assertValuesValid(
  db: PoolClient, tableId: string, data: Record<string, unknown>,
) {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const { rows } = await db.query(
    `select key, type, options from fields where table_id = $1 and key = any($2)`,
    [tableId, keys]);
  const referenced = new Set<string>();
  for (const f of rows as Array<{ key: string; type: any; options: any }>) {
    const err = validateValue(f, data[f.key]);
    if (err) throw new MutationError(err);
    for (const id of assetIdsIn(f.type, data[f.key])) referenced.add(id);
    // A report definition names tables and fields; `validateValue` checked its
    // shape, this checks they EXIST and fit together (contract/reports.ts). Only
    // for records that carry one — two small queries, and reports are few.
    if (f.type === 'structured' && f.options?.shape === 'report' && data[f.key] !== undefined) {
      const [fields, tables] = await Promise.all([
        db.query(`select id, key, name, type, table_id, options from fields`),
        db.query(`select id, name, kind, junction from tables`),   // kind + junction: a via may go THROUGH one
      ]);
      const rerr = reportDefError(data[f.key], fields.rows, tables.rows);
      if (rerr) throw new MutationError(`'${f.key}': ${rerr}`);
    }
  }

  // The one check the shared contract cannot make: that every asset a value
  // refers to EXISTS. Without it a record can point at a file that was never
  // uploaded — a failed paste, a hand-written mutation — and show a broken image
  // forever with nothing to say why. One query per record write, only for records
  // that actually carry rich text or attachments.
  if (referenced.size) {
    const ids = [...referenced];
    const found = await db.query(`select id from assets where id = any($1::uuid[])`, [ids]);
    if (found.rowCount !== ids.length) {
      const have = new Set(found.rows.map((r) => r.id as string));
      throw new MutationError(`unknown asset: ${ids.filter((id) => !have.has(id)).join(', ')} — upload the file first`);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Per-mutation SQL
 * ──────────────────────────────────────────────────────────────────────────*/

async function applyOne(db: PoolClient, m: Mutation, actor: Actor): Promise<void> {
  if (SCHEMA_MUTATIONS.has(m.type) && actor.role !== 'admin') {
    throw new MutationError(`role '${actor.role}' may not change the schema`, 403);
  }
  // `restore` cannot be gated statically: recreating a record needs 'editor',
  // recreating a table or field needs 'admin'. Gate on what it actually carries,
  // or undoing a table.delete would be an editor's back door into the schema.
  if (m.type === 'restore' && actor.role !== 'admin') {
    if (m.rows.tables.length || m.rows.fields.length) {
      throw new MutationError(
        `role '${actor.role}' may not restore tables or fields`, 403);
    }
  }
  if (actor.role === 'viewer') {
    throw new MutationError('viewers may not write', 403);
  }

  switch (m.type) {
    /* ── schema ── */
    case 'table.create':
      await db.query(
        `insert into tables (id, name, singular_name, color, icon, kind) values ($1,$2,$3,$4,$5,$6)`,
        [m.id, m.name, m.singularName, m.color, m.icon, m.kind ?? 'records'],
      );
      return;

    case 'table.update':
      if (m.tools !== undefined) await assertToolsValid(db, m.id, m.tools);
      if (m.junction !== undefined) await assertJunctionValid(db, m.id, m.junction);
      await db.query(
        `update tables set
           name          = coalesce($2, name),
           singular_name = coalesce($3, singular_name),
           color         = coalesce($4, color),
           icon          = coalesce($5, icon),
           position      = coalesce($6, position),
           tools         = coalesce($7::jsonb, tools),
           junction      = coalesce($8::jsonb, junction)
         where id = $1`,
        [m.id, m.name ?? null, m.singularName ?? null, m.color ?? null, m.icon ?? null,
         m.position ?? null, m.tools === undefined ? null : JSON.stringify(m.tools),
         m.junction === undefined ? null : JSON.stringify(m.junction)],
      );
      return;

    case 'table.delete':
      // Junction rows hanging off this table's records go with them (sql/016) —
      // captured by captureFor with the same query.
      await db.query(`delete from records where id in (${JUNCTION_ROWS_OF('in (select id from records where table_id = $1)')})`, [m.id]);
      await db.query(`delete from tables where id = $1`, [m.id]);
      return;

    case 'field.create':
      if (SYSTEM_FIELD_TYPES.has(m.fieldType)) throw new MutationError(`'${m.fieldType}' is a system field type — every table has it already`);
      if (isSystemKey(m.key)) throw new MutationError(`a field key may not start with '_' (reserved for system fields)`);
      assertArrowStyleValid(m.options);
      { const err = countOptionError(m.fieldType, m.options); if (err) throw new MutationError(err); }
      await assertCompareValid(db, m.tableId, m.fieldType, m.options);
      await assertLinkMatchValid(db, { id: m.id, table_id: m.tableId, type: m.fieldType, options: m.options });
      if (m.fieldType === 'structured') { const err = shapeOptionError(m.options); if (err) throw new MutationError(err); }
      if (m.fieldType === 'select' || m.fieldType === 'multi_select') { const err = vocabularyOptionError(m.options); if (err) throw new MutationError(err); }
      await assertMembershipValid(db, m.tableId, m.fieldType, m.options, m.id);
      if (m.fieldType === 'lookup') await assertLookupConfigValid(db, m.tableId, m.options);
      if (m.fieldType === 'backlink') await assertBacklinkConfigValid(db, m.tableId, m.options);
      await db.query(
        // APPENDED: position = one past the table's last field. It used to default to 0
        // for every new field, so a field created through the API without a follow-up
        // position update tied with the first column — and ties break alphabetically,
        // so "Alt work" sorted ahead of "Name" and became the table's PRIMARY field,
        // renaming every record. The app always sent a position; a script or the
        // desktop tools would not have.
        `insert into fields (id, table_id, name, key, type, options, required, position)
         values ($1,$2,$3,$4,$5,$6,$7, (select coalesce(max(position), -1) + 1 from fields where table_id = $2))`,
        [m.id, m.tableId, m.name, m.key, m.fieldType, JSON.stringify(m.options), m.required],
      );
      return;

    case 'field.update':
      assertArrowStyleValid(m.options);
      if (m.options) {
        // Re-pointing an existing lookup gets the same check as creating one.
        const cur = await db.query(`select table_id, type, options->'match' as match from fields where id = $1`, [m.id]);
        if (cur.rowCount) await assertMembershipValid(db, cur.rows[0].table_id, cur.rows[0].type, m.options, m.id);
        if (cur.rowCount) { const err = countOptionError(cur.rows[0].type, m.options); if (err) throw new MutationError(err); }
        if (cur.rows[0]?.type === 'lookup') await assertLookupConfigValid(db, cur.rows[0].table_id, m.options);
        if (cur.rows[0]?.type === 'backlink') await assertBacklinkConfigValid(db, cur.rows[0].table_id, m.options);
        if (cur.rowCount) await assertCompareValid(db, cur.rows[0].table_id, cur.rows[0].type, m.options);
        if (cur.rowCount) await assertLinkMatchValid(db, { id: m.id, table_id: cur.rows[0].table_id, type: cur.rows[0].type, options: m.options }, cur.rows[0].match ?? undefined);
        if (cur.rows[0]?.type === 'select' || cur.rows[0]?.type === 'multi_select') { const err = vocabularyOptionError(m.options); if (err) throw new MutationError(err); }
        if (cur.rows[0]?.type === 'structured') {
          const err = shapeOptionError(m.options);
          if (err) throw new MutationError(err);
          // The shape is what every stored value was validated AGAINST. Changing it
          // would leave a column of values that no longer match their own field.
          const was = await db.query(`select options->>'shape' as shape from fields where id = $1`, [m.id]);
          if (was.rows[0]?.shape && was.rows[0].shape !== m.options.shape) {
            throw new MutationError(`a structured field's shape cannot be changed (it is '${was.rows[0].shape}') — make a new field`);
          }
        }
      }
      await db.query(
        `update fields set
           name     = coalesce($2, name),
           options  = coalesce($3::jsonb, options),
           required = coalesce($4, required),
           position = coalesce($5, position)
         where id = $1`,
        [m.id, m.name ?? null, m.options ? JSON.stringify(m.options) : null,
         m.required ?? null, m.position ?? null],
      );
      return;

    case 'field.delete': {
      // An endpoint of a junction is what makes its rows pairs: without it every
      // row is half-connected. The junction TABLE can go; its endpoint cannot.
      const endpoint = await db.query(`select name from tables where kind = 'junction' and (junction->>'a' = $1 or junction->>'b' = $1)`, [m.id]);
      if (endpoint.rowCount) throw new MutationError(`that field is an endpoint of the junction '${endpoint.rows[0].name}' — delete the junction table instead`);
      // Strip the field's key from every record of its table BEFORE deleting
      // the field. Leaving the key was the worse option: the value survived but
      // became unwritable (assertFieldKeysExist rejects a key with no field),
      // an orphaned state nothing could ever clean up from the UI. The values
      // are not lost — captureFor recorded them as record_values before this
      // runs, so undoing the delete brings them back. Same transaction, so the
      // strip and the delete can never disagree.
      await db.query(
        `update records r
            set data = r.data - f.key, updated_by = $2
           from fields f
          where f.id = $1 and r.table_id = f.table_id and r.data ? f.key`,
        [m.id, actor.id]);
      await db.query(`delete from fields where id = $1`, [m.id]);
      return;
    }

    /* ── records ── */
    case 'record.create':
      // Reserved keys (system fields the client folded into data) are never written.
      for (const k of Object.keys(m.data)) if (isSystemKey(k)) delete (m.data as Record<string, unknown>)[k];
      // Against the TABLE, since the record does not exist yet. This is the
      // check that used to be a no-op.
      await assertFieldKeysExistForTable(db, m.tableId, Object.keys(m.data));
      await assertValuesValid(db, m.tableId, m.data);
      await db.query(
        `insert into records (id, table_id, data, created_by, updated_by)
         values ($1,$2,$3,$4,$4)`,
        [m.id, m.tableId, JSON.stringify(m.data), actor.id],
      );
      return;

    case 'record.update': {
      for (const k of Object.keys(m.set)) if (isSystemKey(k)) delete (m.set as Record<string, unknown>)[k];
      m.unset = m.unset.filter((k) => !isSystemKey(k));
      const keys = [...Object.keys(m.set), ...m.unset];
      await assertFieldKeysExist(db, m.id, keys);
      {
        const { rows } = await db.query(`select table_id from records where id = $1`, [m.id]);
        // With no keys the check above returns before it looks, and `rows[0].table_id`
        // was then a TypeError — a 500, which the client retried forever.
        if (!rows[0]) throw new MutationError('record does not exist');
        await assertValuesValid(db, rows[0].table_id, m.set);
      }
      // `data || patch` merges at the top level: per-FIELD last-write-wins, so
      // concurrent edits to different fields of one record don't clobber.
      await db.query(
        `update records
            set data = (data || $2::jsonb) - $3::text[],
                updated_by = $4
          where id = $1`,
        [m.id, JSON.stringify(m.set), m.unset, actor.id],
      );
      return;
    }

    case 'record.delete':
      // Junction rows that pair this record with something go first (sql/016):
      // a junction row without one of its ends is not a thing. captureFor mirrors
      // this with the same query. Then the FK cascades take links and placements.
      await db.query(`delete from records where id in (${JUNCTION_ROWS_OF('= $1')})`, [m.id]);
      await db.query(`delete from records where id = $1`, [m.id]);
      return;

    /* ── links ── */
    case 'link.add':
      await assertLinkEndpointsValid(db, m.fieldId, m.fromRecord, m.toRecord);
      // A link field ticked "single" holds at most ONE link per record. Refused, not
      // silently replaced: a replacement is `link.remove` + `link.add` in one batch,
      // which the client sends — and which is one Ctrl+Z.
      {
        const single = await db.query(
          `select 1 from fields f where f.id = $1 and (f.options->>'single')::boolean
              and exists (select 1 from links l where l.field_id = $1 and l.from_record = $2 and l.to_record <> $3)`,
          [m.fieldId, m.fromRecord, m.toRecord]);
        if (single.rowCount) throw new MutationError('this link field is "single": the record already links to another record — remove that link first (or replace it in one batch)');
      }
      await db.query(
        `insert into links (id, field_id, from_record, to_record)
         values ($1,$2,$3,$4)
         on conflict (field_id, from_record, to_record) do nothing`,
        [m.id, m.fieldId, m.fromRecord, m.toRecord],
      );
      return;

    case 'link.remove':
      await db.query(
        `delete from links where field_id = $1 and from_record = $2 and to_record = $3`,
        [m.fieldId, m.fromRecord, m.toRecord],
      );
      return;

    /* ── canvases ── */
    // Retired — see the contract. They still PARSE (old log rows must replay) but
    // are never applied: a board is a record in a table of kind 'canvas'.
    case 'canvas.create':
    case 'canvas.delete':
      throw new MutationError(
        `${m.type} is retired: a canvas is a record in a boards table — use record.${m.type === 'canvas.create' ? 'create' : 'delete'}`);

    case 'canvas.update':
      // name / description / position are accepted for old log rows and IGNORED:
      // a board's name is its record's primary field now.
      await ensureBoardState(db, m.id);
      await db.query(
        `update canvases set
           viewport   = coalesce($2::jsonb, viewport),
           config     = coalesce($3::jsonb, config),
           updated_at = now()
         where id = $1`,
        [m.id, m.viewport ? JSON.stringify(m.viewport) : null, m.config ? JSON.stringify(m.config) : null],
      );
      return;

    /* ── placements ── */
    case 'placement.add':
      await ensureBoardState(db, m.canvasId);
      await db.query(
        `insert into placements (id, canvas_id, record_id, x, y, w, h, z)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (canvas_id, record_id)
         do update set x = excluded.x, y = excluded.y, z = excluded.z`,
        [m.id, m.canvasId, m.recordId, m.x, m.y, m.w, m.h, m.z],
      );
      return;

    case 'placement.move': {
      // One statement for the whole batch — a ten-card drag is a single
      // round trip, not ten.
      const recordIds = m.moves.map((mv) => mv.recordId);
      const xs = m.moves.map((mv) => mv.x);
      const ys = m.moves.map((mv) => mv.y);
      const zs = m.moves.map((mv) => mv.z ?? null);
      await db.query(
        `update placements p
            set x = v.x, y = v.y, z = coalesce(v.z, p.z)
           from (
             select unnest($2::uuid[]) as record_id,
                    unnest($3::float8[]) as x,
                    unnest($4::float8[]) as y,
                    unnest($5::int[]) as z
           ) v
          where p.canvas_id = $1 and p.record_id = v.record_id`,
        [m.canvasId, recordIds, xs, ys, zs],
      );
      return;
    }

    case 'placement.update':
      await db.query(
        `update placements set
           w         = coalesce($3, w),
           h         = coalesce($4, h),
           collapsed = coalesce($5, collapsed),
           style     = coalesce($6::jsonb, style)
         where canvas_id = $1 and record_id = $2`,
        [m.canvasId, m.recordId, m.w ?? null, m.h ?? null, m.collapsed ?? null,
         m.style ? JSON.stringify(m.style) : null],
      );
      return;

    case 'placement.remove':
      // Removes the placement ONLY. The record survives.
      await db.query(`delete from placements where canvas_id = $1 and record_id = $2`,
        [m.canvasId, m.recordId]);
      return;

    /* ── annotations ── */
    case 'annotation.create':
      await ensureBoardState(db, m.canvasId);
      await db.query(
        `insert into canvas_annotations (id, canvas_id, kind, geometry, style)
         values ($1,$2,$3,$4,$5)`,
        [m.id, m.canvasId, m.kind, JSON.stringify(m.geometry), JSON.stringify(m.style)],
      );
      return;

    case 'annotation.update':
      await db.query(
        `update canvas_annotations set
           geometry = coalesce($2::jsonb, geometry),
           style    = coalesce($3::jsonb, style)
         where id = $1`,
        [m.id, m.geometry ? JSON.stringify(m.geometry) : null,
         m.style ? JSON.stringify(m.style) : null],
      );
      return;

    case 'annotation.delete':
      await db.query(`delete from canvas_annotations where id = $1`, [m.id]);
      return;

    /* ── views ── */
    case 'section.create':
      await db.query(
        `insert into sections (id, name, description, icon, color, position)
         values ($1,$2,$3,$4,$5, (select coalesce(max(position), 0) + 1 from sections))
         on conflict (id) do nothing`,
        [m.id, m.name, m.description, m.icon, m.color]);
      return;

    case 'section.update': {
      // The scope table has to be one of the section's OWN tables, and the
      // "archived" marker a checkbox ON that table. Checked against what the row
      // will be after this update, so both can be set in one mutation.
      const cur = await db.query(`select table_ids, scope_table_id from sections where id = $1`, [m.id]);
      if (!cur.rowCount) throw new MutationError('no such section');
      const tableIds: string[] = m.tableIds ?? cur.rows[0].table_ids;
      const scope = m.scopeTableId === undefined ? cur.rows[0].scope_table_id as string | null : m.scopeTableId;
      if (m.scopeTableId && !tableIds.includes(m.scopeTableId)) {
        throw new MutationError('the scope table must be one of the section\'s tables');
      }
      if (m.archivedFieldId) {
        const f = await db.query(`select table_id, type from fields where id = $1`, [m.archivedFieldId]);
        if (!f.rowCount || f.rows[0].type !== 'checkbox' || f.rows[0].table_id !== scope) {
          throw new MutationError('the archived marker must be a checkbox field on the scope table');
        }
      }
      // `= $n` with a flag, not coalesce, for the two NULLABLE columns: coalesce
      // cannot tell "leave it alone" from "set it to null".
      await db.query(
        `update sections set
           name        = coalesce($2, name),
           description = coalesce($3, description),
           icon        = coalesce($4, icon),
           color       = coalesce($5, color),
           table_ids   = coalesce($6::jsonb, table_ids),
           scope_table_id    = case when $7 then $8::uuid else scope_table_id end,
           archived_field_id = case when $9 then $10::uuid
                                    -- clearing the scope table clears its marker too
                                    when $7 and $8::uuid is null then null
                                    else archived_field_id end,
           position    = coalesce($11, position),
           updated_at  = now()
         where id = $1`,
        [m.id, m.name ?? null, m.description ?? null, m.icon ?? null, m.color ?? null,
         m.tableIds ? JSON.stringify(m.tableIds) : null,
         m.scopeTableId !== undefined, m.scopeTableId ?? null,
         m.archivedFieldId !== undefined, m.archivedFieldId ?? null,
         m.position ?? null]);
      return;
    }

    case 'section.delete':
      await db.query(`delete from sections where id = $1`, [m.id]);
      return;

    case 'view.create':
      await db.query(
        `insert into views (id, table_id, name, config) values ($1,$2,$3,$4)`,
        [m.id, m.tableId, m.name, JSON.stringify(m.config)],
      );
      return;

    case 'view.update':
      await db.query(
        `update views set
           name     = coalesce($2, name),
           config   = coalesce($3::jsonb, config),
           position = coalesce($4, position)
         where id = $1`,
        [m.id, m.name ?? null, m.config ? JSON.stringify(m.config) : null,
         m.position ?? null],
      );
      return;

    case 'view.delete':
      await db.query(`delete from views where id = $1`, [m.id]);
      return;

    /* ── undo ── */
    case 'restore':
      await restoreRows(db, m.rows);
      return;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Restore
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Insert order is a foreign-key dependency order, not the key order of the
 * payload. Parents before children, every time:
 *
 *   tables  →  fields, records, views
 *   canvases →  placements, canvas_annotations
 *   fields + records  →  links
 *   canvases + records  →  placements
 */
const RESTORE_ORDER = [
  // `canvases` AFTER `records`: a board's state row references its record (010).
  'tables', 'sections', 'fields', 'records', 'canvases', 'views', 'links',
  'placements', 'canvas_annotations',
] as const;

/**
 * Guards that keep a restore from violating a foreign key.
 *
 * History is not a stack. Delete a record (capturing its placement on canvas C),
 * then delete canvas C, then undo the record — and the captured placement points
 * at a canvas that no longer exists. Inserting it blindly aborts the whole
 * transaction and the undo fails for a reason the user cannot act on.
 *
 * So each insert filters to rows whose parents are still present, and the caller
 * reports what was skipped. Restoring a record without one of its four canvas
 * placements is a good outcome; refusing to restore the record at all is not.
 */
const RESTORE_GUARDS: Partial<Record<(typeof RESTORE_ORDER)[number], string>> = {
  fields: `exists (select 1 from tables t where t.id = x.table_id)`,
  canvases: `exists (select 1 from records r where r.id = x.id)`,
  records: `exists (select 1 from tables t where t.id = x.table_id)`,
  views: `exists (select 1 from tables t where t.id = x.table_id)`,
  links: `exists (select 1 from fields f where f.id = x.field_id)
      and exists (select 1 from records r where r.id = x.from_record)
      and exists (select 1 from records r where r.id = x.to_record)`,
  placements: `exists (select 1 from canvases c where c.id = x.canvas_id)
      and exists (select 1 from records r where r.id = x.record_id)`,
  canvas_annotations: `exists (select 1 from canvases c where c.id = x.canvas_id)`,
};

/**
 * Column lists, read from the catalog rather than written down.
 *
 * These were hardcoded, and that was a silent data-loss bug. Capture uses
 * `select *`, so it picks up any column a later migration adds — but a
 * hardcoded restore list does not, so the value was captured and then thrown
 * away on the way back in. Proven: add a column, populate it, delete the row,
 * undo, and the column comes back null with no error anywhere.
 *
 * A recovery tool that quietly returns less than it saved is worse than one that
 * fails loudly, and "remember to update this list" is not a real safeguard —
 * exactly the same reasoning as contract/events.ts. So ask Postgres.
 *
 * NOT cached, deliberately. The first version memoised this per process, and the
 * undo suite caught it immediately: earlier tests warmed the cache, a later one
 * added a column, and the restore silently dropped it again — the identical bug,
 * one layer down. A catalog lookup is sub-millisecond and a restore is a rare
 * human-initiated action, so there is nothing here worth optimising and a whole
 * class of staleness worth avoiding.
 */
async function columnsOf(db: PoolClient, table: string): Promise<string> {
  const { rows } = await db.query(
    `select string_agg(quote_ident(attname), ', ' order by attnum) as cols
       from pg_attribute
      where attrelid = $1::regclass
        and attnum > 0
        and not attisdropped`,
    [table],
  );
  const cols = rows[0]?.cols;
  if (!cols) throw new MutationError(`cannot resolve columns for ${table}`);
  return cols;
}

export interface RestoreResult {
  inserted: Record<string, number>;
  skipped: Record<string, number>;
}

/**
 * Re-insert captured rows verbatim. Idempotent: `on conflict do nothing`, so
 * replaying a restore — or two people hitting undo at once — is a no-op rather
 * than a duplicate-key error.
 */
export async function restoreRows(
  db: PoolClient,
  rows: CapturedRows,
): Promise<RestoreResult> {
  const inserted: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  for (const table of RESTORE_ORDER) {
    const batch = rows[table];
    if (!batch?.length) continue;

    const guard = RESTORE_GUARDS[table];
    const cols = await columnsOf(db, table);

    // jsonb_populate_record casts each captured object back into the table's own
    // row type, so timestamps and jsonb columns land as themselves rather than as
    // strings — which is what makes a restore byte-for-byte rather than lossy.
    const { rowCount } = await db.query(
      `insert into ${table} (${cols})
       select ${cols} from (
         select (jsonb_populate_record(null::${table}, elem)).*
           from jsonb_array_elements($1::jsonb) as elem
       ) x
       ${guard ? `where ${guard}` : ''}
       on conflict do nothing`,
      [JSON.stringify(batch)],
    );

    inserted[table] = rowCount ?? 0;
    const missed = batch.length - (rowCount ?? 0);
    if (missed > 0) skipped[table] = missed;
  }

  // Values stripped by field.delete, merged back one key at a time. Runs after
  // the inserts above so the field row (restored earlier in RESTORE_ORDER) is
  // present before its values are. Three guards, same philosophy as
  // RESTORE_GUARDS — restore what can land cleanly, skip and report the rest:
  //
  //   record still exists     — it may have been deleted since;
  //   a field with this key   — otherwise we would recreate the exact orphaned-
  //   exists on its table       key state the strip was built to eliminate;
  //   the key is absent       — if the user re-created a same-key field and
  //                             typed new values, undo must not overwrite them.
  //                             Insert-only, like `on conflict do nothing`.
  if (rows.record_values?.length) {
    const { rowCount } = await db.query(
      `update records r
          set data = r.data || jsonb_build_object(v.key, v.value)
         from jsonb_to_recordset($1::jsonb) as v(record_id uuid, key text, value jsonb)
        where r.id = v.record_id
          and not (r.data ? v.key)
          and exists (select 1 from fields f
                       where f.table_id = r.table_id and f.key = v.key)`,
      [JSON.stringify(rows.record_values)]);
    inserted.record_values = rowCount ?? 0;
    const missed = rows.record_values.length - (rowCount ?? 0);
    if (missed > 0) skipped.record_values = missed;
  }

  return { inserted, skipped };
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Batch entry point
 * ──────────────────────────────────────────────────────────────────────────*/

export interface BatchResult {
  seq: number;
  applied: string[];
  skipped: string[];
  serverTime: string;
  /**
   * One event per mutation actually applied, ready to broadcast verbatim.
   *
   * Built here rather than in the HTTP handler on purpose. The handler used to
   * assemble its own ad-hoc per-batch payload out of whatever happened to be in
   * scope, which is how it diverged from the catch-up shape in the first place.
   * These come from the same `returning` clause a catch-up read would see, run
   * through the same converter, so there is nothing left to get out of step.
   *
   * Skipped (already-applied) ids produce NO event: they are not new changes,
   * and re-broadcasting them told every peer to re-apply old work.
   */
  events: MutationEvent[];
}

/**
 * Applies a batch in a single transaction: all or nothing.
 *
 * Already-seen mutation ids are skipped rather than erroring, so replaying a
 * batch after a dropped connection is a no-op instead of a duplicate.
 */
export async function applyBatch(
  db: PoolClient,
  req: MutationRequest,
  actor: Actor,
): Promise<BatchResult> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const events: MutationEvent[] = [];
  let seq = 0;
  /** Records that may be junction rows and were created or re-linked here — checked whole at the end. */
  const touched: Array<{ recordId: string; by: string }> = [];

  await db.query('begin');
  try {
    // ONE WRITER AT A TIME. `mutations.seq` is assigned when a row is INSERTED, not
    // when its transaction commits, so two overlapping batches could commit out of
    // seq order: a 400-record file drop takes seqs 3…402 over half a second, a
    // colleague's one-cell edit takes seq 30 in the middle and commits first. The
    // stream delivers 30, and then — correctly, by its own rule — refuses everything
    // at or below 30 when the drop commits. Every connected client lost 27 records
    // of that drop, silently, and a reconnect (`since=402`) did not bring them back.
    // The watermark logic everywhere (stream, catch-up, scene.seq, page.seq) is only
    // sound if seq order IS commit order, and this lock is what makes it so: it is
    // held until commit or rollback, and a waiting batch has not taken a seq yet.
    // The cost is that batches queue behind each other, which at this scale is a
    // few milliseconds. sql/002 named this as the fix to reach for; test/stream.ts 11.
    await db.query(`select pg_advisory_xact_lock(hashtext('spatialdb.mutation_log'))`);
    for (const entry of req.mutations) {
      const dupe = await db.query(`select 1 from mutations where id = $1`, [entry.id]);
      if (dupe.rowCount) {
        skipped.push(entry.id);
        continue;
      }

      // Whatever goes wrong from here to the log row belongs to THIS mutation, and
      // says so (`blame`) — a refusal of ours, or an error Postgres raised.
      let rows;
      try {
        // Capture BEFORE applying, inside the same transaction. If the mutation
        // rolls back so does its capture, so the two can never disagree.
        let capture: Capture | null = null;
        if (DESTRUCTIVE_MUTATIONS.has(entry.mutation.type)) {
          capture = await captureFor(db, entry.mutation);
          // Too much to keep means no undo — and this used to go ahead regardless,
          // under a dialog that said "everything is captured". Now the delete has
          // to SAY it is meant to be permanent (`withoutUndo`), or it does not run.
          if (capture?.truncated && (entry.mutation as { withoutUndo?: true }).withoutUndo !== true) {
            throw new MutationError(uncapturableMessage(entry.mutation.type, capture), 409);
          }
        }

        await applyOne(db, entry.mutation, actor);
        const mm = entry.mutation;
        if (mm.type === 'record.create') touched.push({ recordId: mm.id, by: entry.id });
        else if (mm.type === 'link.add' || mm.type === 'link.remove') touched.push({ recordId: mm.fromRecord, by: entry.id });

        ({ rows } = await db.query(
          `insert into mutations (id, actor_id, client_id, type, payload, undo, via)
           values ($1,$2,$3,$4,$5,$6,$7)
           returning seq, id, client_id, type, payload, applied_at, via`,
          [entry.id, actor.id, req.clientId, entry.mutation.type,
           JSON.stringify(entry.mutation),
           capture ? JSON.stringify(capture) : null,
           req.via ?? null],
        ));
      } catch (err) {
        throw blame(err, entry.id);
      }
      events.push(toMutationEvent(rows[0], false));
      seq = Number(rows[0].seq);
      applied.push(entry.id);
    }

    // A fully-skipped batch (an idempotent replay) applied nothing, so there is
    // no new seq to report. Reporting 0 was actively harmful: API.md tells the
    // client to store the response seq as its watermark, so a replay rewound it
    // to zero and triggered a full replay of the entire log from the beginning.
    // Report the current head instead — "nothing new, and here is where we are".
    if (seq === 0) {
      const { rows } = await db.query(`select coalesce(max(seq), 0) as head from mutations`);
      seq = Number(rows[0].head);
    }

    // The one invariant that spans mutations: a junction row is whole, or the
    // batch that touched it does not commit (sql/016).
    await assertJunctionRowsWhole(db, touched);

    await db.query('commit');
  } catch (err) {
    // The rollback can fail too (the connection is what broke); the ORIGINAL error
    // is the one worth reporting.
    await db.query('rollback').catch(() => {});
    throw err;
  }

  return { seq, applied, skipped, serverTime: new Date().toISOString(), events };
}
