/**
 * File drop — the first desktop tool. It RUNS THE TABLE'S RECIPE (contract/tools.ts):
 * an ordered list of steps, each an analyzer, what it runs on, and where its
 * outputs go. Three stages, all ordinary mutations tagged `via: "file_drop"`:
 *
 *   1. CLASSIFY  the shell says what physically arrived (units: file / bundle /
 *                sequence / channel_set, with a media class). Nothing written yet.
 *   2. CREATE    at once, in ONE synchronous run — one Ctrl+Z for a drop of 45
 *                files. The IMMEDIATE steps (filesystem, sequence, imf — everything
 *                the classifier already knows) are applied here, with the context
 *                links `createRecord` adds (scope, board defaults) and, on a canvas,
 *                the placements. A unit whose `path` already IS a record of this
 *                table updates that record instead; so does a unit dropped ONTO a
 *                card of this table (a placeholder made before the file existed).
 *   3. ANALYZE   afterwards, per unit, per remaining step that applies to it
 *                (ffprobe, a hash…) in recipe order — each its own `record.update`,
 *                queued `undoable: false` so Ctrl+Z on the drop takes the results
 *                with it instead of peeling them off one at a time.
 *
 * What is written is only what a step's map names, and only values
 * `validateValue` accepts: a select output whose value is not one of the field's
 * choices is skipped and reported, never written, never turned into a schema
 * change.
 *
 * The pure parts (`immediateOutputs`, `mappedData`) are what test/filedrop.ts pins
 * down; the shell is faked there.
 */

import type { Store, MutateOptions } from '../store';
import type { FieldRow, RecordRow } from '../state';
export type { Step };
import { fieldsOf, recordsOf } from '../state';
import { validateValue } from '../../contract/values';
import { analyzerOf, resolveMap, stepApplies, type Recipe, type Step, type TablesTools } from '../../contract/tools';
import { lookupCodec } from '../../contract/vocab';
import { invoke, jobs, notice } from '../desktop';
import { confirmDialog, askFull } from '../dialogs';

/** What src-tauri/src/tools/classify.rs returns per unit. */
export interface Unit {
  kind: 'file' | 'bundle' | 'sequence' | 'channel_set';
  path: string; name: string; extension: string; media: string;
  manifest: Record<string, unknown>;
  file_count: number; total_size: number; modified: string;
  probe_target: string | null; members: string[];
  bundle_type: string | null; cpl_title: string | null;
}

export const VIA: MutateOptions = { via: 'file_drop' };
const FOLLOW_UP: MutateOptions = { via: 'file_drop', undoable: false };
/** Steps the classifier has already answered: applied at creation, no shell call. */
const IMMEDIATE = new Set(['filesystem', 'sequence', 'imf']);
/** Above this many units, ask before creating. The shell caps at 500 regardless. */
export const ASK_ABOVE = 50;

/* ── pure: outputs and mapping ────────────────────────────────────────────── */

/** An IMMEDIATE analyzer's outputs for a unit — everything the classifier already knows. */
export function immediateOutputs(analyzer: string, u: Unit): Record<string, unknown> {
  switch (analyzer) {
    case 'filesystem':
      return { path: u.path, name: u.name, kind: u.kind, manifest: u.manifest, file_count: u.file_count,
               total_size: u.total_size, extension: u.extension, modified: u.modified, media: u.media };
    case 'sequence': {
      if (u.kind !== 'sequence') return {};
      const m = u.manifest as { first: number; last: number; count: number; gaps: [number, number][] };
      return { first_frame: m.first, last_frame: m.last, frame_count: m.count, gaps: m.gaps.reduce((n, [a, b]) => n + (b - a + 1), 0) };
    }
    case 'imf': {
      if (u.kind !== 'bundle') return {};
      const o: Record<string, unknown> = {};
      if (u.bundle_type) o.bundle_type = u.bundle_type;
      if (u.cpl_title) o.cpl_title = u.cpl_title;
      return o;
    }
    default: return {};
  }
}

/**
 * Outputs an analyzer reports RAW, normalised through the contract's vocabularies
 * (contract/vocab.ts) — here, not in Rust, so the lookup table exists once. An
 * unknown pair yields no `codec`; the raw pair stays, and the caller reports it.
 */
export function withVocabulary(analyzer: string, outputs: Record<string, unknown>): { outputs: Record<string, unknown>; unknown: string[] } {
  const out = { ...outputs };
  const unknown: string[] = [];
  if (analyzer === 'ffprobe' && typeof out.video_codec === 'string') {
    const hit = lookupCodec(out.video_codec, typeof out.codec_profile === 'string' ? out.codec_profile : undefined);
    if (hit) out.codec = hit.name;
    else unknown.push(`Codec: ${out.video_codec}${out.codec_profile ? ' / ' + String(out.codec_profile) : ''} is not in the vocabulary (contract/vocab.ts)`);
  }
  return { outputs: out, unknown };
}

/**
 * Outputs → the `data` a record.create/update takes, through the table's mapping.
 * Unmapped outputs are dropped silently (the table has no column for them); a
 * mapped value the field would refuse is dropped and NAMED, so the person learns
 * their select is missing a choice rather than finding a blank cell.
 */
export function mappedData(outputs: Record<string, unknown>, map: Map<string, string>, fields: FieldRow[]): { data: Record<string, unknown>; skipped: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const data: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [out, value] of Object.entries(outputs)) {
    const key = map.get(out);
    if (key === undefined || value === undefined || value === null) continue;
    const field = byKey.get(key);
    if (!field) continue;
    const problem = validateValue(field as never, value);
    if (problem) skipped.push(`${field.name}: ${problem}`); else data[key] = value;
  }
  return { data, skipped };
}

/* ── the run ──────────────────────────────────────────────────────────────── */

export interface DropTarget {
  /** The grid: files go into this table. */
  tableId?: string;
  /** The canvas: files become cards here; `onto` is the card under the pointer, if any. */
  canvas?: { id: string; clientX: number; clientY: number; onto: { recordId: string; tableId: string } | null;
             place: (records: RecordRow[], clientX: number, clientY: number, options: MutateOptions) => void };
}

export interface DropContext {
  store: Store;
  createRecord: (tableId: string, data: Record<string, unknown>, id: string, context: { defaults?: Array<{ tableId: string; recordId: string }> }, options: MutateOptions) => string;
  /** The canvas's active defaults (the bar), when dropping there. */
  defaults?: Array<{ tableId: string; recordId: string }>;
}

const enabledTables = (store: Store) => [...store.state.tables.values()]
  .filter((t) => (t.tools as Partial<TablesTools> | undefined)?.file_drop && (!t.kind || t.kind === 'records'))
  .sort((a, b) => a.position - b.position);

/** Which table takes this drop, or null (with the reason already shown). */
async function chooseTable(store: Store, target: DropTarget): Promise<string | null> {
  const enabled = enabledTables(store);
  if (target.tableId) {
    if (enabled.some((t) => t.id === target.tableId)) return target.tableId;
    notice(`File drop is not enabled on this table — turn it on under ⚙ Table settings → Desktop tools`, 'warn');
    return null;
  }
  if (target.canvas?.onto) {
    if (enabled.some((t) => t.id === target.canvas!.onto!.tableId)) return target.canvas.onto.tableId;
    notice(`File drop is not enabled on that card's table`, 'warn');
    return null;
  }
  if (!enabled.length) { notice(`No table has File drop enabled yet — ⚙ Table settings → Desktop tools on the table the files belong in`, 'warn'); return null; }
  if (enabled.length === 1) return enabled[0].id;
  const r = await askFull({ title: 'Which table?', noText: true, okText: 'Add',
    select: { label: 'Files become records of', options: enabled.map((t) => ({ value: t.id, label: t.name })), initial: enabled[0].id } });
  return r?.choice ?? null;
}

export async function runFileDrop(ctx: DropContext, paths: string[], target: DropTarget): Promise<void> {
  const { store } = ctx;
  const tableId = await chooseTable(store, target);
  if (!tableId) return;
  const table = store.state.tables.get(tableId)!;
  const recipe: Recipe = (table.tools as TablesTools).file_drop!;
  const fields = fieldsOf(store.state, tableId);
  const steps = recipe.steps.map((step) => ({ step, map: resolveMap(step, fields) }));
  const pathKey = steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('path');
  if (!pathKey) { notice(`File drop on ${table.name}: its Path output is mapped to a field that no longer exists`, 'error'); return; }
  const applying = (u: Unit) => steps.filter(({ step, map }) => map.size && stepApplies(step, u));

  let units: Unit[];
  try { units = await invoke<Unit[]>('classify', { paths }); }
  catch (e) { notice(`file drop: ${String(e)}`, 'error'); return; }
  if (!units.length) { notice('nothing droppable in that (empty folder?)', 'warn'); return; }

  // Matching: the same absolute path already in this table → update, not duplicate.
  await store.loadTable(tableId);
  const byPath = new Map<string, RecordRow>();
  for (const r of recordsOf(store.state, tableId)) { const p = r.data[pathKey]; if (typeof p === 'string') byPath.set(p, r); }
  const onto = target.canvas?.onto && target.canvas.onto.tableId === tableId ? target.canvas.onto.recordId : null;

  const creates = units.filter((u) => !byPath.has(u.path) && !(onto && units.length === 1));
  if (creates.length > ASK_ABOVE) {
    const ok = await confirmDialog({ title: `Create ${creates.length} records?`, body: `${units.length} items were dropped (${creates.length} new). One Ctrl+Z undoes them all.`, okText: `Create ${creates.length}` });
    if (!ok) return;
  }

  // ── stage 2: one synchronous run from here to the end of the loop ──
  const made: RecordRow[] = [];
  const touched: Array<{ id: string; unit: Unit }> = [];
  const allSkipped: string[] = [];
  let updated = 0;
  for (const u of units) {
    const data: Record<string, unknown> = {};
    for (const { step, map } of applying(u)) {
      if (!IMMEDIATE.has(step.analyzer)) continue;
      const m = mappedData(immediateOutputs(step.analyzer, u), map, fields);
      Object.assign(data, m.data); allSkipped.push(...m.skipped);
    }
    const existing = onto && units.length === 1 ? store.state.records.get(onto) : byPath.get(u.path);
    if (existing) {
      store.mutate({ type: 'record.update', id: existing.id, set: data, unset: [] }, VIA);
      touched.push({ id: existing.id, unit: u });
      updated++;
    } else {
      const id = crypto.randomUUID();
      ctx.createRecord(tableId, data, id, { defaults: ctx.defaults }, VIA);
      const row = store.state.records.get(id);
      if (row) made.push(row);
      touched.push({ id, unit: u });
    }
  }
  if (target.canvas && made.length) target.canvas.place(made, target.canvas.clientX, target.canvas.clientY, VIA);
  // ── end of the undo step ──

  const what = `${made.length} new${updated ? `, ${updated} updated` : ''}`;
  notice(`File drop → ${table.name}: ${what}`);
  for (const s of new Set(allSkipped)) notice(`not written — ${s}`, 'warn');

  // ── stage 3: the analyzers that run a program or read the bytes, in recipe
  //    order, each its own small update, not undoable ──
  for (const { id, unit } of touched) {
    for (const { step, map } of applying(unit)) {
      if (IMMEDIATE.has(step.analyzer)) continue;
      if (!store.state.records.has(id)) break;   // undone meanwhile: stop, write nothing
      const a = analyzerOf(step.analyzer);
      jobs.set(id, a?.program ?? a?.name ?? step.analyzer);
      try {
        const raw = await invoke<{ outputs: Record<string, unknown> }>('analyze', { unit, analyzer: step.analyzer });
        const { outputs, unknown } = withVocabulary(step.analyzer, raw.outputs);
        const { data, skipped } = mappedData(outputs, map, fields);
        if (Object.keys(data).length && store.state.records.has(id)) store.mutate({ type: 'record.update', id, set: data, unset: [] }, FOLLOW_UP);
        for (const sk of skipped) notice(`${unit.name}: not written — ${sk}`, 'warn');
        // Only worth saying when the table wanted the canonical name.
        if (map.has('codec')) for (const u of unknown) notice(`${unit.name}: not written — ${u}`, 'warn');
      } catch (e) { notice(`${unit.name}: ${a?.name ?? step.analyzer} — ${String(e)}`, 'error'); }
      jobs.delete(id);
    }
  }
}
