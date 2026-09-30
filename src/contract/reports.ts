/**
 * ============================================================================
 *  Reports (REPORTS-BRIEF.md) — the twelfth shared contract file.
 * ============================================================================
 *
 *  A report is a WALK, not a query. Its definition is a tree of LEVELS: from every
 *  record at the parent level, follow these link fields (forward or backlink) into
 *  that table, keep the records matching these filters, show these fields, sort
 *  them so, and compute these rollups over my children. The expected list lives in
 *  the parent's link, so a level with no records is still a node — a deliverable
 *  with no files is SHOWN, which is what plain grouping cannot do.
 *
 *  Three layers, kept apart (brief §2):
 *    definition  — `ReportDef`, validated on both sides (`reportDefError`)
 *    result      — `runReport`, pure, computed on the client over loaded tables
 *    renderings  — consumers of the result: the outline, `flattenReport` → CSV,
 *                  print, JSON. None of them is known here.
 *
 *  Filters and sort are the grid's, verbatim (`FilterEntry`, `SortEntry` from
 *  views.ts, applied through `applyView`), so a report and a grid never disagree
 *  about what "status = accepted" means.
 *
 *  THROUGH A JUNCTION (junction.ts). Where two tables are connected by a junction
 *  — Files ⇄ Deliverables through "Delivery" — there is no link field between them
 *  to follow; the relation lives in the pair rows. A `via` may therefore name the
 *  JUNCTION COLUMN on the parent's table (the backlink that mirrors the junction's
 *  endpoint — the same field the grid, the canvas and the comparison treat as the
 *  relation): the walk goes through the pair rows and lands on the OTHER END, in
 *  one level, so Work › Deliverables › Files keeps its shape and the Files level
 *  can still be pinned to the Work. Such a level may show and filter the PAIR's
 *  own fields (`pair`: its status, its notes), and a rollup over it may test or
 *  read them — "accepted" is a count of files whose pair says so. Descending into
 *  the junction TABLE (via its endpoint link) still works, for a report about the
 *  pairs themselves.
 */

import { z } from 'zod';
import { applyView, FilterEntry, SortEntry, type LinkLabels, type ViewField, type ViewRecord } from './views.js';
import { richTextToPlain } from './richtext.js';
import { shapeOf, summarise } from './shapes.js';
import { junctionOf, otherEnd, type JunctionConfig } from './junction.js';

/* ── the definition ───────────────────────────────────────────────────────── */

const uuid = z.guid();
const levelId = z.string().min(1).max(64);

export const ROLLUP_OPS = ['count', 'countWhere', 'sum', 'min', 'max', 'list'] as const;
export type RollupOp = (typeof ROLLUP_OPS)[number];
export const ROLLUP_LABELS: Record<RollupOp, string> = {
  count: 'count', countWhere: 'count where', sum: 'sum of', min: 'earliest / smallest', max: 'latest / largest', list: 'list of',
};

/**
 * `countWhere` may test the CHILD's fields (and, for a child reached through a
 * junction, the PAIR's fields — "files whose Delivery status is Accepted"), or one
 * of the child's own ROLLUPS ("deliverables whose file-count > 0").
 */
const RollupWhere = z.union([
  z.array(FilterEntry).max(32),
  z.strictObject({ rollup: z.string().min(1), op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']), value: z.number() }),
]);

export const Rollup = z.strictObject({
  id: levelId,
  label: z.string().max(120),
  op: z.enum(ROLLUP_OPS),
  /** A direct child level's id. */
  over: levelId,
  /** sum / min / max / list: a field of the child level's table — or, for a level reached through a junction, of the pair. */
  fieldId: uuid.optional(),
  where: RollupWhere.optional(),
});
export type Rollup = z.infer<typeof Rollup>;

export const Via = z.strictObject({
  /**
   * A link field on the parent's table (forward) or on the child's table (backlink);
   * or a JUNCTION COLUMN on the parent's table — through the pair rows, to the other end.
   */
  fieldId: uuid,
  /** Shown on every record reached through this link: "bid", "added". */
  role: z.string().max(60).optional(),
});
/**
 * What a level reached THROUGH A JUNCTION shows and keeps of the pair row that
 * joins each record to its parent: fields of the junction table (the status, the
 * notes), and filters on them ("only Accepted"). Explicit, like `fields`.
 */
export const Pair = z.strictObject({
  fields: z.array(uuid).max(50).default([]),
  filters: z.array(FilterEntry).max(32).default([]),
});
export const Pin = z.strictObject({
  /** A link field joining the child's table and the ancestor's table, either way round. */
  fieldId: uuid,
  /** An ancestor level's id — by id, so inserting a level never re-targets a pin. */
  levelId,
});

/**
 * Depth is bounded because the definition is a tree the editor draws and a person
 * reads; eight is past anything sane and keeps a recursive schema finite.
 */
export const MAX_DEPTH = 8;

const LevelBase = z.strictObject({
  id: levelId,
  /** EXPLICIT columns. A report is a document: a field added later must not appear uninvited. */
  fields: z.array(uuid).max(200).default([]),
  filters: z.array(FilterEntry).max(32).default([]),
  sort: z.array(SortEntry).max(8).default([]),
  rollups: z.array(Rollup).max(32).default([]),
});

export type Descent = z.infer<typeof LevelBase> & {
  via: z.infer<typeof Via>[];
  pins?: z.infer<typeof Pin>[];
  pair?: z.infer<typeof Pair>;
  children: Descent[];
};
export const Descent: z.ZodType<Descent> = LevelBase.extend({
  via: z.array(Via).min(1).max(8),
  pins: z.array(Pin).max(8).optional(),
  pair: Pair.optional(),
  children: z.lazy(() => z.array(Descent).max(16)),
}) as unknown as z.ZodType<Descent>;

export const RootLevel = LevelBase.extend({
  table: uuid,
  children: z.array(Descent).max(16).default([]),
});
export type RootLevel = z.infer<typeof RootLevel>;

export const ReportDef = z.strictObject({ v: z.literal(1), root: RootLevel });
export type ReportDef = z.infer<typeof ReportDef>;

export const EMPTY_REPORT = (table: string): ReportDef =>
  ({ v: 1, root: { id: 'root', table, fields: [], filters: [], sort: [], rollups: [], children: [] } });

/* ── what the validator and the walk need to know ─────────────────────────── */

export interface ReportField extends ViewField { name: string; table_id: string }
/** `kind` and `junction` are what tell a junction column from an ordinary backlink. */
export interface ReportTable { id: string; name: string; kind?: string | null; junction?: unknown }

/** The schema as the validator, the walk and the editor ask it: a field by id, and which junction an endpoint link belongs to. */
export interface ReportSchema {
  field: (id: string) => ReportField | undefined;
  /** For a junction's endpoint link field (its `a` or `b`): the junction table, its config, and which end. */
  endpoint: (fieldId: string) => { table: string; cfg: JunctionConfig; side: 'a' | 'b' } | undefined;
}
export function reportSchema(fields: Iterable<ReportField>, tables: Iterable<ReportTable>): ReportSchema {
  const byId = new Map<string, ReportField>(); for (const f of fields) byId.set(f.id, f);
  const ends = new Map<string, { table: string; cfg: JunctionConfig; side: 'a' | 'b' }>();
  for (const t of tables) {
    const cfg = junctionOf(t);
    if (!cfg) continue;
    ends.set(cfg.a, { table: t.id, cfg, side: 'a' }); ends.set(cfg.b, { table: t.id, cfg, side: 'b' });
  }
  return { field: (id) => byId.get(id), endpoint: (id) => ends.get(id) };
}

/**
 * Which table a descent lands in, and which way each `via` runs.
 *   a LINK field on the parent            → forward, into its target
 *   a LINK field targeting the parent     → backlink, into its owner
 *   a JUNCTION COLUMN on the parent       → junction: through the pair rows (those
 *       linking the parent through `near`), to what each links through `far`
 * Every `via` of one descent must land in the same table.
 */
export type ViaDir =
  | { fieldId: string; role?: string; dir: 'forward' | 'backlink'; table: string }
  | { fieldId: string; role?: string; dir: 'junction'; table: string; junction: string; near: string; far: string };

export function resolveVia(parentTable: string, via: { fieldId: string; role?: string }, schema: ReportSchema): ViaDir | string {
  const field = schema.field(via.fieldId);
  if (!field) return `link field ${via.fieldId} does not exist`;
  if (field.type === 'backlink') {
    const near = String(field.options?.source_field_id ?? '');
    const end = schema.endpoint(near);
    if (!end) return `'${field.name}' is a backlink — pick the link field it mirrors instead`;
    if (field.table_id !== parentTable) return `'${field.name}' does not connect to the parent level's table`;
    const far = end.cfg[otherEnd(end.side)];
    const table = String(schema.field(far)?.options?.target_table_id ?? '');
    if (!table) return `'${field.name}': the junction's other end is missing`;
    return { fieldId: via.fieldId, role: via.role, dir: 'junction', table, junction: end.table, near, far };
  }
  if (field.type !== 'link') return `'${field.name}' is not a link field`;
  const target = String(field.options?.target_table_id ?? '');
  if (field.table_id === parentTable) return { fieldId: via.fieldId, role: via.role, dir: 'forward', table: target };
  if (target === parentTable) return { fieldId: via.fieldId, role: via.role, dir: 'backlink', table: field.table_id };
  return `'${field.name}' does not connect to the parent level's table`;
}

/**
 * The junction table whose pair rows a descent can show: every one of its links
 * goes through the SAME junction. Null otherwise — a level reached by a plain link
 * has no pair, and one reached through two different junctions has no single one.
 */
export function pairTableOf(parentTable: string, via: { fieldId: string }[], schema: ReportSchema): string | null {
  let table: string | null = null;
  for (const v of via) {
    const d = resolveVia(parentTable, v, schema);
    if (typeof d === 'string') continue;
    if (d.dir !== 'junction' || (table && table !== d.junction)) return null;
    table = d.junction;
  }
  return table;
}

/**
 * Why a definition is unacceptable, or null. Read-time is lenient (a deleted field
 * is ignored, as views do); write-time is strict, so a mistake is caught while the
 * person who made it is looking at the editor.
 */
export function reportDefError(raw: unknown, fields: Iterable<ReportField>, tables: Iterable<ReportTable>): string | null {
  const r = ReportDef.safeParse(raw);
  if (!r.success) { const i = r.error.issues[0]; return `report: ${i.path.join('.')}${i.path.length ? ': ' : ''}${i.message}`; }
  const allFields = [...fields], allTables = [...tables];
  const byId = new Map<string, ReportField>(); for (const f of allFields) byId.set(f.id, f);
  const tableIds = new Set<string>(); for (const t of allTables) tableIds.add(t.id);
  const schema = reportSchema(allFields, allTables);
  const seen = new Set<string>();
  const { root } = r.data;
  if (!tableIds.has(root.table)) return `report: root table ${root.table} does not exist`;

  const checkLevel = (level: RootLevel | Descent, table: string, ancestors: { id: string; table: string }[], path: string): string | null => {
    if (seen.has(level.id)) return `${path}: level id '${level.id}' is used twice`;
    seen.add(level.id);
    if (ancestors.length >= MAX_DEPTH) return `${path}: deeper than ${MAX_DEPTH} levels`;
    for (const id of level.fields) {
      const f = byId.get(id);
      if (!f) return `${path}: field ${id} does not exist`;
      if (f.table_id !== table) return `${path}: '${f.name}' is not a field of this level's table`;
    }
    for (const e of [...level.filters, ...level.sort]) {
      const f = byId.get(e.fieldId);
      if (!f) return `${path}: filter/sort field ${e.fieldId} does not exist`;
      if (f.table_id !== table) return `${path}: filter/sort field '${f.name}' is not a field of this level's table`;
    }
    const childTables = new Map<string, string>();
    const childPairs = new Map<string, string>();   // child level id → its junction table, when it has ONE
    for (const c of level.children) {
      const cpath = `${path} › ${c.id}`;
      let landing: string | null = null;
      for (const v of c.via) {
        const d = resolveVia(table, v, schema);
        if (typeof d === 'string') return `${cpath}: ${d}`;
        if (landing && landing !== d.table) return `${cpath}: its links land in different tables`;
        landing = d.table;
      }
      childTables.set(c.id, landing!);
      const pairTable = pairTableOf(table, c.via, schema);
      if (pairTable) childPairs.set(c.id, pairTable);
      if (c.pair && (c.pair.fields.length || c.pair.filters.length)) {
        if (!pairTable) return `${cpath}: pair fields need every link of this level to go through one junction`;
        for (const id of [...c.pair.fields, ...c.pair.filters.map((e) => e.fieldId)]) {
          const f = byId.get(id);
          if (!f) return `${cpath}: pair field ${id} does not exist`;
          if (f.table_id !== pairTable) return `${cpath}: pair field '${f.name}' is not a field of the junction this level goes through`;
        }
      }
      for (const p of c.pins ?? []) {
        const anc = [...ancestors, { id: level.id, table }].find((a) => a.id === p.levelId);
        if (!anc) return `${cpath}: pin names '${p.levelId}', which is not an ancestor`;
        const f = byId.get(p.fieldId);
        if (!f || f.type !== 'link') return `${cpath}: pin field ${p.fieldId} is not a link field`;
        const t = String(f.options?.target_table_id ?? '');
        const joins = (f.table_id === landing && t === anc.table) || (f.table_id === anc.table && t === landing);
        if (!joins) return `${cpath}: pin '${f.name}' does not join this level's table to '${p.levelId}'`;
      }
    }
    for (const ru of level.rollups) {
      const rpath = `${path} rollup '${ru.id}'`;
      const over = childTables.get(ru.over);
      const child = level.children.find((c) => c.id === ru.over)!;
      if (!over) return `${rpath}: 'over' must name a direct child level`;
      // A child reached through a junction lends its PAIR's fields to the rollup too.
      const ofChild = (f: ReportField | undefined) => !!f && (f.table_id === over || f.table_id === childPairs.get(ru.over));
      if (ru.op === 'sum' || ru.op === 'min' || ru.op === 'max' || ru.op === 'list') {
        const f = ru.fieldId ? byId.get(ru.fieldId) : undefined;
        if (!f || !ofChild(f)) return `${rpath}: needs a field of the '${ru.over}' level's table`;
        if (ru.op === 'sum' && f.type !== 'number') return `${rpath}: sum needs a number field`;
        if ((ru.op === 'min' || ru.op === 'max') && f.type !== 'number' && f.type !== 'date') return `${rpath}: ${ru.op} needs a number or date field`;
      }
      if (ru.op === 'countWhere' && ru.where === undefined) return `${rpath}: count where needs a condition`;
      if (ru.where && !Array.isArray(ru.where)) {
        const w = ru.where;
        if (!child.rollups.some((x) => x.id === w.rollup)) return `${rpath}: '${w.rollup}' is not a rollup of the '${ru.over}' level`;
      } else if (ru.where) {
        for (const e of ru.where) { if (!ofChild(byId.get(e.fieldId))) return `${rpath}: condition field is not of the '${ru.over}' level's table`; }
      }
    }
    for (const c of level.children) {
      const err = checkLevel(c, childTables.get(c.id)!, [...ancestors, { id: level.id, table }], `${path} › ${c.id}`);
      if (err) return err;
    }
    return null;
  };
  return checkLevel(root, root.table, [], `report: ${root.id}`);
}

/* ── the result ───────────────────────────────────────────────────────────── */

export interface ReportCell { fieldId: string; text: string }
export interface ReportRollupValue { id: string; label: string; value: number | string | null }
export interface ReportNode {
  levelId: string;
  record: { id: string; tableId: string; label: string };
  /** Which `via` links reached this record — "bid", "added" — in definition order, once each. */
  roles: string[];
  /**
   * Reached through a junction: the PAIR row joining this record to its parent,
   * and the level's `pair.fields` read from it. Absent on any other level.
   */
  pair?: { id: string; tableId: string; cells: ReportCell[] };
  cells: ReportCell[];
  rollups: ReportRollupValue[];
  /** One section per child level, in definition order; a section may be empty. */
  children: ReportSection[];
}
/** `pairTableId`: the junction this level was reached through, when it is ONE. */
export interface ReportSection { levelId: string; tableId: string; pairTableId?: string; nodes: ReportNode[] }

export interface ReportContext {
  fields: ReportField[];
  tables: ReportTable[];
  recordsOf: (tableId: string) => ViewRecord[];
  /** Records this record links TO through a link field — the forward direction. */
  linksFrom: (recordId: string, fieldId: string) => string[];
  /** Records linking TO this record through a link field — the backlink direction. */
  linksTo: (recordId: string, fieldId: string) => string[];
  labelOf: (recordId: string) => string;
  /** Text for link / lookup / backlink fields, as the grid gets it. */
  links?: LinkLabels;
  /** Scope filters the ROOT only (brief §3): descendants are reached by links. */
  inScope?: (record: ViewRecord) => boolean;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** The text of one cell — the same reading the grid sorts and searches on. */
export function cellText(f: ViewField, r: ViewRecord, links: LinkLabels): string {
  if (f.type === 'link' || f.type === 'lookup' || f.type === 'backlink') return links(r.id, f.id).join(', ');
  const v = r.data[f.key];
  if (f.type === 'rich_text') return richTextToPlain(v);
  if (f.type === 'structured') return summarise(shapeOf(f), v);
  if (f.type === 'checkbox') return v === true ? 'yes' : 'no';
  if (f.type === 'attachment') return Array.isArray(v) ? `${v.length} file${v.length === 1 ? '' : 's'}` : '';
  if (isEmpty(v)) return '';
  return Array.isArray(v) ? v.map(String).join(', ') : String(v);
}

/**
 * The walk. Pure: same inputs, same tree. Rules pinned by test/reports.ts:
 * a record reached through two `via` links at one level appears ONCE with both
 * roles; pins apply to every via; an empty level is still a section; rollups are
 * evaluated bottom-up; a record already on the path above is not walked again;
 * a `via`, `pin` or field naming something deleted is skipped, never an error.
 * Through a junction: the level's records are the OTHER ENDS of the parent's pair
 * rows; a pair filter drops the records no pair of which passes; pins apply to the
 * records as anywhere; a node carries the (first passing) pair row and its cells.
 */
export function runReport(def: ReportDef, ctx: ReportContext): ReportSection {
  const byId = new Map(ctx.fields.map((f) => [f.id, f]));
  const schema = reportSchema(ctx.fields, ctx.tables);
  const links: LinkLabels = ctx.links ?? (() => []);
  const byRecord = new Map<string, ViewRecord>();
  const recordOf = (tableId: string, id: string) => {
    let r = byRecord.get(id);
    if (!r) { for (const x of ctx.recordsOf(tableId)) byRecord.set(x.id, x); r = byRecord.get(id); }
    return r;
  };

  const shape = (level: RootLevel | Descent, recs: ViewRecord[]): ViewRecord[] =>
    applyView(recs, ctx.fields, { sort: level.sort, filters: level.filters, hidden: [] }, links);
  /** Which of these records pass these filters — the grid's own reading of them. */
  const passing = (recs: ViewRecord[], filters: z.infer<typeof FilterEntry>[]): Set<string> =>
    new Set(applyView(recs, ctx.fields, { sort: [], filters, hidden: [] }, links).map((r) => r.id));

  /** The pair rows of one level: its junction table, and each record's chosen row. */
  type Pairs = { table: string; of: Map<string, string>; fields: string[] };

  const build = (
    level: RootLevel | Descent, tableId: string, recs: ViewRecord[], roles: Map<string, string[]>,
    ancestors: { id: string; record: ViewRecord }[], pairs?: Pairs,
  ): ReportNode[] => {
    return shape(level, recs).map((r) => {
      const path = [...ancestors, { id: level.id, record: r }];
      const children = level.children.map((c) => walkDescent(c, tableId, r, path));
      const node: ReportNode = {
        levelId: level.id,
        record: { id: r.id, tableId, label: ctx.labelOf(r.id) },
        roles: roles.get(r.id) ?? [],
        cells: level.fields.flatMap((id) => { const f = byId.get(id); return f ? [{ fieldId: id, text: cellText(f, r, links) }] : []; }),
        rollups: [],
        children,
      };
      const rowId = pairs?.of.get(r.id);
      const row = rowId ? recordOf(pairs!.table, rowId) : undefined;
      if (row) node.pair = { id: row.id, tableId: pairs!.table, cells: pairs!.fields.flatMap((id) => { const f = byId.get(id); return f ? [{ fieldId: id, text: cellText(f, row, links) }] : []; }) };
      node.rollups = level.rollups.map((ru) => rollupValue(ru, node));
      return node;
    });
  };

  const walkDescent = (
    c: Descent, parentTable: string, parent: ViewRecord, path: { id: string; record: ViewRecord }[],
  ): ReportSection => {
    const roles = new Map<string, string[]>();
    let tableId: string | null = null;
    const ids: string[] = [];
    const rowsOf = new Map<string, string[]>();            // record → the pair rows that reach it
    for (const v of c.via) {
      const d = resolveVia(parentTable, v, schema);
      if (typeof d === 'string') continue;                 // a deleted or re-pointed link: skipped, as views skip
      if (tableId && tableId !== d.table) continue;
      tableId = d.table;
      let found: readonly string[];
      if (d.dir === 'junction') {
        // Through the pair rows: those linking the parent through `near`, each to its other end.
        const far: string[] = [];
        for (const row of ctx.linksTo(parent.id, d.near)) {
          const id = ctx.linksFrom(row, d.far)[0];
          if (!id) continue;
          far.push(id);
          const rows = rowsOf.get(id); if (rows) rows.push(row); else rowsOf.set(id, [row]);
        }
        found = far;
      } else found = d.dir === 'forward' ? ctx.linksFrom(parent.id, d.fieldId) : ctx.linksTo(parent.id, d.fieldId);
      for (const id of found) {
        if (!roles.has(id)) { roles.set(id, []); ids.push(id); }
        if (v.role && !roles.get(id)!.includes(v.role)) roles.get(id)!.push(v.role);
      }
    }
    if (!tableId) return { levelId: c.id, tableId: '', nodes: [] };
    const pairTable = pairTableOf(parentTable, c.via, schema);
    const onPath = new Set(path.map((p) => p.record.id));
    let recs = ids.filter((id) => !onPath.has(id)).map((id) => recordOf(tableId!, id)).filter((r): r is ViewRecord => !!r);
    for (const p of c.pins ?? []) {
      const anc = path.find((a) => a.id === p.levelId);
      const f = byId.get(p.fieldId);
      if (!anc || !f) continue;
      recs = f.table_id === tableId
        ? recs.filter((r) => ctx.linksFrom(r.id, f.id).includes(anc.record.id))
        : recs.filter((r) => ctx.linksFrom(anc.record.id, f.id).includes(r.id));
    }
    if (!pairTable) return { levelId: c.id, tableId, nodes: build(c, tableId, recs, roles, path) };
    // The pair of each record: its first row, or — under a pair filter — its first
    // row that passes; a record none of whose rows pass is not at this level.
    const pairs: Pairs = { table: pairTable, of: new Map(), fields: c.pair?.fields ?? [] };
    const filters = (c.pair?.filters ?? []).filter((e) => byId.get(e.fieldId)?.table_id === pairTable);
    const rowRecs = recs.flatMap((r) => rowsOf.get(r.id) ?? []).map((id) => recordOf(pairTable, id)).filter((r): r is ViewRecord => !!r);
    const ok = filters.length ? passing(rowRecs, filters) : null;
    recs = recs.filter((r) => {
      const row = (rowsOf.get(r.id) ?? []).find((id) => !ok || ok.has(id));
      if (row) pairs.of.set(r.id, row);
      return !!row || !ok;
    });
    return { levelId: c.id, tableId, pairTableId: pairTable, nodes: build(c, tableId, recs, roles, path, pairs) };
  };

  const rollupValue = (ru: Rollup, node: ReportNode): ReportRollupValue => {
    const section = node.children.find((s) => s.levelId === ru.over);
    const out = (value: number | string | null) => ({ id: ru.id, label: ru.label, value });
    if (!section) return out(null);
    let nodes = section.nodes;
    /** The record a field of this rollup is read from: the child, or — for a pair field — the child's pair row. */
    const isPair = (fieldId: string) => !!section.pairTableId && byId.get(fieldId)?.table_id === section.pairTableId;
    const pairRec = (n: ReportNode) => (n.pair ? recordOf(n.pair.tableId, n.pair.id) : undefined);
    if (ru.where) {
      if (Array.isArray(ru.where)) {
        const onPair = ru.where.filter((e) => isPair(e.fieldId)), onChild = ru.where.filter((e) => !isPair(e.fieldId));
        const keep = passing(nodes.map((n) => recordOf(section.tableId, n.record.id)!), onChild);
        nodes = nodes.filter((n) => keep.has(n.record.id));
        if (onPair.length) {
          const keepRows = passing(nodes.map(pairRec).filter((r): r is ViewRecord => !!r), onPair);
          nodes = nodes.filter((n) => !!n.pair && keepRows.has(n.pair.id));
        }
      } else {
        const w = ru.where;
        nodes = nodes.filter((n) => {
          const v = n.rollups.find((x) => x.id === w.rollup)?.value;
          if (typeof v !== 'number') return false;
          return w.op === 'gt' ? v > w.value : w.op === 'gte' ? v >= w.value : w.op === 'lt' ? v < w.value : w.op === 'lte' ? v <= w.value : v === w.value;
        });
      }
    }
    if (ru.op === 'count' || ru.op === 'countWhere') return out(nodes.length);
    const f = ru.fieldId ? byId.get(ru.fieldId) : undefined;
    if (!f) return out(null);
    const values = nodes.map((n) => (isPair(f.id) ? pairRec(n) : recordOf(section.tableId, n.record.id))).filter((r): r is ViewRecord => !!r)
      .map((r) => f.type === 'number' ? r.data[f.key] : cellText(f, r, links)).filter((v) => !isEmpty(v));
    if (ru.op === 'list') return out([...new Set(values.map(String))].join(', '));
    if (!values.length) return out(null);
    if (ru.op === 'sum') return out(values.reduce<number>((a, v) => a + Number(v), 0));
    const nums = f.type === 'number' ? values.map(Number) : null;
    if (ru.op === 'min') return out(nums ? Math.min(...nums) : [...values.map(String)].sort()[0]);
    return out(nums ? Math.max(...nums) : [...values.map(String)].sort().at(-1)!);
  };

  const rootRecs = ctx.recordsOf(def.root.table).filter((r) => (ctx.inScope ? ctx.inScope(r) : true));
  return { levelId: def.root.id, tableId: def.root.table, nodes: build(def.root, def.root.table, rootRecs, new Map(), []) };
}

/* ── flattening: the tree as rows, for CSV and spreadsheets ───────────────── */

export interface FlatTable { columns: string[]; rows: string[][] }

/**
 * One row per LEAF: a node with no children in any of its sections (a deliverable
 * with no files is a leaf, and gets a row with empty file columns — the absence is
 * the information). Ancestor columns repeat on every row, which is what a
 * spreadsheet wants. Columns per level: the record's label, its role if any level
 * declares roles, its pair fields (named by the junction: "Files: Delivery Status"),
 * its fields by name, its rollups by label.
 */
export function flattenReport(def: ReportDef, result: ReportSection, ctx: Pick<ReportContext, 'fields' | 'tables'>): FlatTable {
  const fieldName = new Map(ctx.fields.map((f) => [f.id, f.name]));
  const fieldTable = new Map(ctx.fields.map((f) => [f.id, f.table_id]));
  const tableName = new Map(ctx.tables.map((t) => [t.id, t.name]));
  type Col = { levelId: string; key: string; title: string };
  const cols: Col[] = [];
  const levelOrder: string[] = [];
  const collect = (level: RootLevel | Descent, tableId: string, hasRole: boolean) => {
    const t = tableName.get(tableId) ?? level.id;
    levelOrder.push(level.id);
    cols.push({ levelId: level.id, key: 'label', title: t });
    if (hasRole) cols.push({ levelId: level.id, key: 'role', title: `${t}: role` });
    for (const id of ('pair' in level ? level.pair?.fields : undefined) ?? []) {
      cols.push({ levelId: level.id, key: `p:${id}`, title: `${t}: ${tableName.get(fieldTable.get(id) ?? '') ?? 'pair'} ${fieldName.get(id) ?? id}` });
    }
    for (const id of level.fields) cols.push({ levelId: level.id, key: `f:${id}`, title: `${t}: ${fieldName.get(id) ?? id}` });
    for (const ru of level.rollups) cols.push({ levelId: level.id, key: `r:${ru.id}`, title: `${t}: ${ru.label || ru.id}` });
    for (const c of level.children) {
      const landing = sectionTable(result, c.id);
      collect(c, landing, c.via.some((v) => !!v.role));
    }
  };
  collect(def.root, def.root.table, false);

  const rows: string[][] = [];
  const emit = (node: ReportNode, above: Map<string, Record<string, string>>) => {
    const mine: Record<string, string> = { label: node.record.label, role: node.roles.join(', ') };
    for (const c of node.cells) mine[`f:${c.fieldId}`] = c.text;
    for (const c of node.pair?.cells ?? []) mine[`p:${c.fieldId}`] = c.text;
    for (const r of node.rollups) mine[`r:${r.id}`] = r.value === null ? '' : String(r.value);
    const here = new Map(above); here.set(node.levelId, mine);
    const leaves = node.children.flatMap((s) => s.nodes);
    if (!leaves.length) { rows.push(cols.map((c) => here.get(c.levelId)?.[c.key] ?? '')); return; }
    for (const child of leaves) emit(child, here);
  };
  for (const n of result.nodes) emit(n, new Map());
  return { columns: cols.map((c) => c.title), rows };
}

/** The table a level's sections landed in, found from any node that has one (empty sections still carry it). */
function sectionTable(section: ReportSection, levelId: string): string {
  const stack: ReportSection[] = [section];
  while (stack.length) {
    const s = stack.pop()!;
    if (s.levelId === levelId) return s.tableId;
    for (const n of s.nodes) stack.push(...n.children);
  }
  return '';
}

/** A grid view as rows: the toolbar's Export CSV. One level, no walk. */
export function flattenGrid(records: ViewRecord[], fields: ViewField[], visible: string[], links: LinkLabels = () => [], labelOf?: (id: string) => string): FlatTable {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const shown = visible.map((id) => byId.get(id)).filter((f): f is ViewField => !!f);
  const named = shown as (ViewField & { name?: string })[];
  return {
    columns: [...(labelOf ? ['Record'] : []), ...named.map((f) => f.name ?? f.key)],
    rows: records.map((r) => [...(labelOf ? [labelOf(r.id)] : []), ...shown.map((f) => cellText(f, r, links))]),
  };
}

/** RFC 4180: quote when needed, double the quotes, CRLF line ends, UTF-8 BOM so Excel reads accents. */
export function toCsv(t: FlatTable): string {
  const cell = (s: string) => /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return '\uFEFF' + [t.columns, ...t.rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
