/**
 * ============================================================================
 *  The mutation contract — the entire write surface of the system.
 * ============================================================================
 *
 *  This file is shared verbatim between the web client, the Tauri desktop
 *  client, and the server. It is the single source of truth for "what is a
 *  legal write", and it exists to keep one promise: adding offline support
 *  later should be additive, not a rewrite.
 *
 *  Three rules make that possible:
 *
 *  1. EVERY write is one of the mutations below. There is no ad-hoc SQL and no
 *     generic table-CRUD endpoint. If a write can't be expressed here, add a
 *     mutation — don't reach around the boundary. (This is also why we don't
 *     expose PostgREST/Supabase auto-CRUD directly: it would let the UI bypass
 *     invariants like "a link's target must match the field's target table".)
 *
 *  2. Mutations are plain serialisable data. The same object is applied
 *     optimistically on the client, sent to the server, persisted, and then
 *     broadcast to peers. One shape, four uses. An offline queue is then just
 *     an array of these on disk, replayed on reconnect.
 *
 *  3. The CLIENT generates all UUIDs. A create renders instantly with its final
 *     id and never needs a server round-trip to find out what it is. This is
 *     what makes optimistic creation work, and it's a prerequisite for offline.
 */

import { z } from 'zod';
import { ViewConfig } from './views.js';
import { CanvasConfig } from './canvasConfig.js';

/**
 * `z.guid()`, not `z.uuid()`. Zod's strict uuid() enforces RFC 4122 version and
 * variant bits, but Postgres's `uuid` type accepts any 8-4-4-4-12 hex string.
 * A validation layer stricter than the storage layer rejects ids the database
 * would happily hold — which bites on seed data, fixtures and imports. The
 * version nibble carries no meaning for us, so validate the shape only.
 */
const uuid = z.guid();

/**
 * Every object below is `z.strictObject`, not `z.object`. Plain `z.object`
 * silently STRIPS keys it does not know, which turned every misspelt mutation
 * into a successful no-op: `record.update` sent with `data:` instead of `set:`
 * parsed to "set nothing, unset nothing", returned 200, and wrote a log row that
 * did nothing. `field.update` carrying `key` or `fieldType` — which this contract
 * deliberately refuses to support — looked like it had worked. A write that
 * cannot be honoured should fail where someone is looking, not succeed quietly.
 *
 * The cost is version skew: a client older than the server will throw on a
 * stream event carrying a field it has never heard of, instead of ignoring it.
 * That is the right way round. Ignoring it means applying HALF a mutation and
 * diverging silently; throwing surfaces "update the client" in store.errors.
 * It will matter once Tauri builds can lag the server — ship them together.
 *
 * MutationResponse stays loose on purpose: it is diagnostic, nothing is applied
 * from it, and a new server-side field there should not break an old client.
 */

/* ────────────────────────────────────────────────────────────────────────────
 *  Schema mutations — restricted to users with role 'admin'
 * ──────────────────────────────────────────────────────────────────────────*/

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'link',
  'file_path',
  'lookup',
  'backlink',
  'rich_text',
  'attachment',
] as const;

const TableCreate = z.strictObject({
  type: z.literal('table.create'),
  id: uuid,
  name: z.string().min(1),
  singularName: z.string().default(''),
  color: z.string().default(''),
  icon: z.string().default(''),
  /**
   * 'canvas' = a table of BOARDS: every record in it is a canvas (sql/010). Set
   * here and nowhere else — table.update deliberately cannot change it.
   */
  // optional, not defaulted: every table.create already in the log (and in callers)
  // predates it, and absent must keep meaning an ordinary table.
  kind: z.enum(['records', 'canvas']).optional(),
});

const TableUpdate = z.strictObject({
  type: z.literal('table.update'),
  id: uuid,
  name: z.string().min(1).optional(),
  singularName: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  position: z.number().int().optional(),
});

const TableDelete = z.strictObject({
  type: z.literal('table.delete'),
  id: uuid,
});

const FieldCreate = z.strictObject({
  type: z.literal('field.create'),
  id: uuid,
  tableId: uuid,
  name: z.string().min(1),
  /** Immutable once set — see the note on fields.key in schema.sql. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase snake_case'),
  fieldType: z.enum(FIELD_TYPES),
  options: z.record(z.string(), z.unknown()).default({}),
  required: z.boolean().default(false),
});

const FieldUpdate = z.strictObject({
  type: z.literal('field.update'),
  id: uuid,
  // Deliberately no `key` and no `fieldType`: renaming is free, but changing a
  // field's identity or type is a data migration, not an edit. If it's ever
  // needed it should be an explicit, separate, destructive mutation.
  name: z.string().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  required: z.boolean().optional(),
  position: z.number().int().optional(),
});

const FieldDelete = z.strictObject({
  type: z.literal('field.delete'),
  id: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Record mutations
 * ──────────────────────────────────────────────────────────────────────────*/

const RecordCreate = z.strictObject({
  type: z.literal('record.create'),
  id: uuid,
  tableId: uuid,
  data: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Partial update, merged field-by-field on the server (`data || patch`).
 *
 * This gives per-FIELD last-write-wins rather than per-RECORD. Two people
 * editing different fields of the same record don't clobber each other, which
 * at this team size removes almost all real conflicts without any CRDT.
 */
const RecordUpdate = z.strictObject({
  type: z.literal('record.update'),
  id: uuid,
  set: z.record(z.string(), z.unknown()).default({}),
  unset: z.array(z.string()).default([]),
});

const RecordDelete = z.strictObject({
  type: z.literal('record.delete'),
  id: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Link mutations — relations are their own rows, never values inside a record
 * ──────────────────────────────────────────────────────────────────────────*/

const LinkAdd = z.strictObject({
  type: z.literal('link.add'),
  id: uuid,
  /** Which link field this belongs to. Distinguishes Edit.inputs from
   *  Edit.outputs when both point at the Files table. */
  fieldId: uuid,
  fromRecord: uuid,
  toRecord: uuid,
});

const LinkRemove = z.strictObject({
  type: z.literal('link.remove'),
  fieldId: uuid,
  fromRecord: uuid,
  toRecord: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Canvas + placement mutations
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * RETIRED (sql/010_boards.sql): a canvas is a record in a table of kind 'canvas',
 * so creating one is `record.create` and deleting one is `record.delete`.
 *
 * These two stay in the union for ONE reason: the mutation log still contains
 * them, the stream re-validates everything it sends with this strict schema, and
 * a client catching up across the change must be able to PARSE the old rows. The
 * server refuses to apply them and the client ignores them. Do not delete these
 * until the log has been pruned past the migration.
 */
const CanvasCreate = z.strictObject({
  type: z.literal('canvas.create'),
  id: uuid,
  name: z.string().min(1),
  description: z.string().default(''),
});

const CanvasUpdate = z.strictObject({
  type: z.literal('canvas.update'),
  id: uuid,
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  viewport: z.strictObject({ x: z.number(), y: z.number(), scale: z.number() }).optional(),
  position: z.number().int().optional(),
  /** How cards look on this canvas. Replaced WHOLE — see contract/canvasConfig.ts. */
  config: CanvasConfig.optional(),
});

const CanvasDelete = z.strictObject({
  type: z.literal('canvas.delete'),
  id: uuid,
});

/** Put an existing record onto a canvas. */
const PlacementAdd = z.strictObject({
  type: z.literal('placement.add'),
  id: uuid,
  canvasId: uuid,
  recordId: uuid,
  x: z.number(),
  y: z.number(),
  w: z.number().nullable().default(null),
  h: z.number().nullable().default(null),
  z: z.number().int().default(0),
});

/**
 * Batch move. A drag of ten selected cards is ONE mutation, not ten.
 *
 * During the drag nothing goes through this at all — positions are written
 * straight into local state (ephemeral, like the viewport) and exactly one
 * `placement.move` carrying every moved card lands on drop. See
 * client/canvas/useCardDrag.ts for the full reasoning. An earlier version of
 * this comment described per-frame optimistic applies with a debounced send;
 * that design was rejected before the drag shipped — it made undo mean "go
 * back one frame" — and the comment outlived it.
 */
const PlacementMove = z.strictObject({
  type: z.literal('placement.move'),
  canvasId: uuid,
  moves: z
    .array(
      z.strictObject({
        recordId: uuid,
        x: z.number(),
        y: z.number(),
        z: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

const PlacementUpdate = z.strictObject({
  type: z.literal('placement.update'),
  canvasId: uuid,
  recordId: uuid,
  w: z.number().nullable().optional(),
  h: z.number().nullable().optional(),
  collapsed: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Take a record OFF a canvas. This is NOT a delete — the record continues to
 * exist and stays visible in its grid. These two operations must never share a
 * code path, a keyboard shortcut, or a confirmation dialog.
 */
const PlacementRemove = z.strictObject({
  type: z.literal('placement.remove'),
  canvasId: uuid,
  recordId: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Canvas annotations — drawing that carries no data meaning
 * ──────────────────────────────────────────────────────────────────────────*/

const AnnotationCreate = z.strictObject({
  type: z.literal('annotation.create'),
  id: uuid,
  canvasId: uuid,
  kind: z.enum(['arrow', 'area', 'label']),
  geometry: z.record(z.string(), z.unknown()).default({}),
  style: z.record(z.string(), z.unknown()).default({}),
});

const AnnotationUpdate = z.strictObject({
  type: z.literal('annotation.update'),
  id: uuid,
  geometry: z.record(z.string(), z.unknown()).optional(),
  style: z.record(z.string(), z.unknown()).optional(),
});

const AnnotationDelete = z.strictObject({
  type: z.literal('annotation.delete'),
  id: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Grid view mutations
 * ──────────────────────────────────────────────────────────────────────────*/

/* ── sections ──────────────────────────────────────────────────────────────
   The app's navigation: see sql/009_sections.sql for what a section is and, more
   importantly, what it is NOT (a filter on data; a permission). */

const SectionCreate = z.strictObject({
  type: z.literal('section.create'),
  id: uuid,
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  icon: z.string().max(8).default(''),
  color: z.string().max(32).default(''),
});

const SectionUpdate = z.strictObject({
  type: z.literal('section.update'),
  id: uuid,
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  icon: z.string().max(8).optional(),
  color: z.string().max(32).optional(),
  /** Replaced WHOLE, in display order. A table may be in several sections. */
  tableIds: z.array(uuid).max(500).optional(),
  /** null clears it. Must be one of the section's own tables (checked on the server). */
  scopeTableId: uuid.nullable().optional(),
  /** null clears it. A checkbox field on the scope table: "this one is archived". */
  archivedFieldId: uuid.nullable().optional(),
  position: z.number().int().optional(),
});

const SectionDelete = z.strictObject({
  type: z.literal('section.delete'),
  id: uuid,
});

const ViewCreate = z.strictObject({
  type: z.literal('view.create'),
  id: uuid,
  tableId: uuid,
  name: z.string().min(1).default('Grid'),
  // The real shape, not z.record(unknown): a free-form bag here meant the first
  // test to create a view invented `{ sorts: [] }`, which nothing would ever
  // read. See contract/views.ts. Replaced WHOLE on update — a config is small,
  // and a per-key merge would need its own conflict rules for arrays.
  config: ViewConfig.default({ sort: [], filters: [], hidden: [] }),
});

const ViewUpdate = z.strictObject({
  type: z.literal('view.update'),
  id: uuid,
  name: z.string().min(1).optional(),
  config: ViewConfig.optional(),
  position: z.number().int().optional(),
});

const ViewDelete = z.strictObject({
  type: z.literal('view.delete'),
  id: uuid,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  Undo
 *
 *  A destructive mutation captures the rows it destroys (see sql/003_undo.sql
 *  and src/server/capture.ts). Undo then reads that capture back and sends it as
 *  a `restore` mutation.
 *
 *  Two design decisions worth arguing with:
 *
 *  1. THE ROWS TRAVEL IN THE PAYLOAD, rather than `restore` carrying only the id
 *     of the mutation being undone and letting the server look it up.
 *
 *     Carrying just the id would be smaller, and it would break the property the
 *     whole architecture rests on: the client could not apply the mutation,
 *     because it would not have the data. Neither could a peer receiving it over
 *     the stream. Undo would need its own apply path, its own stream handling,
 *     and would never work offline. Putting the rows in the payload keeps undo an
 *     ordinary mutation — optimistic locally, streamed to peers, replayed on
 *     reconnect, idempotent, all for free.
 *
 *     The cost is that the data appears twice in the log: once in the delete's
 *     capture, once in the restore's payload. That is real storage, and it buys a
 *     restore that is itself auditable and undoable.
 *
 *  2. ONE `restore` MUTATION, NOT N ORDINARY ONES.
 *
 *     Expressing undo as `record.create` + `link.add` + `placement.add` … was the
 *     first instinct and it does not survive contact: undoing a `table.delete` of
 *     a 2,000-record table needs thousands of mutations, and the batch cap is 500.
 *     It is also lossy — `record.create` cannot restore `created_at` or
 *     `created_by`, so an undo would silently rewrite history's authorship.
 *
 *     One mutation carrying whole rows is atomic regardless of cascade size and
 *     restores rows byte-for-byte.
 * ──────────────────────────────────────────────────────────────────────────*/

/** A row as it exists in the database: snake_case, timestamps and all. */
const Row = z.record(z.string(), z.unknown());

/**
 * Rows grouped by table. Insert order matters for foreign keys and is fixed by
 * the server (see RESTORE_ORDER in apply.ts), not by key order here.
 */
export const CapturedRows = z.strictObject({
  tables: z.array(Row).default([]),
  fields: z.array(Row).default([]),
  canvases: z.array(Row).default([]),
  records: z.array(Row).default([]),
  views: z.array(Row).default([]),
  sections: z.array(Row).default([]),
  links: z.array(Row).default([]),
  placements: z.array(Row).default([]),
  canvas_annotations: z.array(Row).default([]),
  /**
   * NOT a table — surgical patches to rows that still exist.
   *
   * `field.delete` strips its key from every record's `data` (leaving it was
   * worse: the value became unwritable, because assertFieldKeysExist rejects a
   * key with no field). Whole-record capture cannot restore that — the records
   * were not deleted, and re-inserting them would clobber edits made since. So
   * the capture keeps exactly what was stripped, and restore merges each value
   * back only where the record survives, a field with that key exists again,
   * and the key is still absent — the same insert-only, never-overwrite rule
   * as every other collection here, one level down.
   */
  record_values: z.array(z.strictObject({
    record_id: uuid,
    key: z.string(),
    value: z.unknown(),
  })).default([]),
});

export type CapturedRows = z.infer<typeof CapturedRows>;

export const CAPTURED_TABLES = [
  'tables', 'fields', 'canvases', 'records', 'views', 'sections',
  'links', 'placements', 'canvas_annotations',
] as const;

const Restore = z.strictObject({
  type: z.literal('restore'),
  id: uuid,
  /** Which mutation this reverses. Provenance, and it makes the log readable. */
  undoOf: uuid,
  rows: CapturedRows,
});

/* ────────────────────────────────────────────────────────────────────────────
 *  The closed set
 * ──────────────────────────────────────────────────────────────────────────*/

export const Mutation = z.discriminatedUnion('type', [
  TableCreate, TableUpdate, TableDelete,
  FieldCreate, FieldUpdate, FieldDelete,
  RecordCreate, RecordUpdate, RecordDelete,
  LinkAdd, LinkRemove,
  CanvasCreate, CanvasUpdate, CanvasDelete,
  PlacementAdd, PlacementMove, PlacementUpdate, PlacementRemove,
  AnnotationCreate, AnnotationUpdate, AnnotationDelete,
  ViewCreate, ViewUpdate, ViewDelete,
  SectionCreate, SectionUpdate, SectionDelete,
  Restore,
]);

export type Mutation = z.infer<typeof Mutation>;
export type MutationType = Mutation['type'];

/**
 * Mutations that destroy rows, and therefore need capturing before they run.
 * Kept beside the contract so adding a destructive mutation without capture is
 * a visible omission rather than a silent one.
 */
export const DESTRUCTIVE_MUTATIONS: ReadonlySet<string> = new Set([
  'table.delete', 'field.delete', 'record.delete',
  'link.remove', 'placement.remove',
  'annotation.delete', 'view.delete', 'section.delete',
]);

/**
 * Mutations only an 'admin' may apply. Everything else needs 'editor'.
 *
 * `restore` is NOT here even though it can recreate tables and fields, because
 * whether it needs admin depends on what it carries. That is checked at apply
 * time against the payload — see applyOne.
 */
export const SCHEMA_MUTATIONS: ReadonlySet<string> = new Set([
  'table.create', 'table.update', 'table.delete',
  'field.create', 'field.update', 'field.delete',
  // How the app is laid out for everyone is an admin's call, like the schema.
  'section.create', 'section.update', 'section.delete',
]);

/* ────────────────────────────────────────────────────────────────────────────
 *  Transport envelope
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * A batch is applied in ONE Postgres transaction: all or nothing. That means a
 * client can express "create the record and place it on the canvas" as two
 * mutations without inventing a compound operation, and without the risk of a
 * record existing with no placement because the second call failed.
 */
export const MutationRequest = z.strictObject({
  /** Lets a client recognise and skip the broadcast echo of its own writes. */
  clientId: uuid,
  mutations: z
    .array(
      z.strictObject({
        /** Idempotency key. Replaying a batch after a flaky connection or an
         *  offline queue drain is safe: already-applied ids are skipped. */
        id: uuid,
        mutation: Mutation,
      }),
    )
    .min(1)
    .max(500),
});

export type MutationRequest = z.infer<typeof MutationRequest>;

export const MutationResponse = z.object({
  /** Highest server sequence number after this batch. Clients store it and
   *  reconnect with `?since=`, which is the whole catch-up protocol. */
  seq: z.number().int(),
  applied: z.array(uuid),
  skipped: z.array(uuid),
  serverTime: z.string(),
});

export type MutationResponse = z.infer<typeof MutationResponse>;
