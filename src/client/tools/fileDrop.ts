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
 *                table is SKIPPED and named (with the record to open); a unit
 *                dropped ONTO a record is compared with it and updates it only by
 *                the rules at `runFileDrop` — nothing invisible (Oct 18).
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
import { fieldsOf, linkKey, primaryKeys, recordsOf } from '../state';
import { validateValue } from '../../contract/values';
import { analyzerOf, fingerprintStep, intoManifest, isHashStep, isManual, resolveMap, stepApplies, type Recipe, type Step, type TablesTools } from '../../contract/tools';
import { FINGERPRINT, compareAlgorithm, compareManifests } from '../../contract/fingerprint';
import { Manifest } from '../../contract/shapes';
import { runHash } from './hashJobs';
import { ALIASES_KEY, lookup, rawSpelling, resolveRow, type VocabRow } from '../../contract/vocab';
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
 * The canonical outputs: each is looked up in a vocabulary (contract/vocab.ts) from
 * the RAW outputs the analyzer reported — here, not in Rust, so the lookup table
 * exists once. The `extension` the container lookup reads is the unit's.
 */
const CANONICAL: ReadonlyArray<{ key: string; name: string; vocabulary: string; raw: Record<string, string> }> = [
  { key: 'codec',           name: 'Codec',       vocabulary: 'video_codec',     raw: { codec: 'video_codec', profile: 'codec_profile' } },
  { key: 'audio_codec',     name: 'Audio codec', vocabulary: 'audio_codec',     raw: { codec: 'audio_codec_raw' } },
  { key: 'container',       name: 'Container',   vocabulary: 'container',       raw: { format: 'container_raw', brand: 'major_brand', extension: 'extension', op: 'mxf_op' } },
  { key: 'color_primaries', name: 'Primaries',   vocabulary: 'color_primaries', raw: { primaries: 'color_primaries_raw' } },
  { key: 'color_transfer',  name: 'Transfer',    vocabulary: 'color_transfer',  raw: { transfer: 'color_transfer_raw' } },
  { key: 'color_matrix',    name: 'Matrix',      vocabulary: 'color_matrix',    raw: { matrix: 'color_matrix_raw' } },
];

/**
 * Outputs an analyzer reports RAW, normalised through the contract's vocabularies.
 * An unknown raw value yields no canonical output; the raw value stays, and the
 * caller reports it (`unknown`, keyed by the canonical output so only a table that
 * WANTED the canonical name hears about it). `raws` keeps, per canonical output,
 * the raw values the lookup read — what a vocabulary TABLE's aliases are matched
 * against (`routeLinks`), and the spelling a notice tells the person to add.
 */
export function withVocabulary(analyzer: string, outputs: Record<string, unknown>, unit?: { extension?: string }): { outputs: Record<string, unknown>; unknown: Array<{ key: string; message: string }>; raws: Record<string, string[]> } {
  const out = { ...outputs };
  const unknown: Array<{ key: string; message: string }> = [];
  const raws: Record<string, string[]> = {};
  if (analyzer !== 'ffprobe') return { outputs: out, unknown, raws };
  for (const c of CANONICAL) {
    const raw: Record<string, string | undefined> = {};
    for (const [k, from] of Object.entries(c.raw)) {
      const v = from === 'extension' ? unit?.extension : out[from];
      if (typeof v === 'string' && v !== '') raw[k] = v;
    }
    // Nothing raw to look up (an audio-only file has no primaries): nothing to say.
    const primary = Object.keys(c.raw)[0];
    if (raw[primary] === undefined) continue;
    raws[c.key] = Object.keys(c.raw).map((k) => raw[k]).filter((v): v is string => v !== undefined);
    const hit = lookup(c.vocabulary, raw);
    if (hit) out[c.key] = hit.name;
    else unknown.push({ key: c.key, message: `${c.name}: ${Object.entries(raw).map(([k, v]) => `${k} ${v}`).join(' / ')} is not in the ${c.vocabulary} vocabulary (contract/vocab.ts)` });
  }
  return { outputs: out, unknown, raws };
}

/* ── vocabulary outputs into LINK fields ───────────────────────────────────── */

/** A vocabulary table's rows as the resolver reads them: `rowsOf(tableId)`. */
export type RowsOf = (tableId: string) => VocabRow[];

export interface RoutedLinks {
  /** The outputs with the link-routed keys TAKEN OUT (a link is not a value). */
  outputs: Record<string, unknown>;
  /** One link per resolved vocabulary output: the field, and the row to link. */
  links: Array<{ fieldId: string; toRecord: string; name: string }>;
  /** What found no row — one line each, naming what to add. Keyed by the output. */
  unresolved: Array<{ key: string; message: string }>;
}

/**
 * The canonical outputs that this recipe step maps to LINK fields, resolved to
 * rows of the fields' target tables (contract/vocab.ts `resolveRow`): by the
 * canonical name, else by an alias on a row — which is how the table teaches the
 * drop a spelling the code does not know. Pure: the rows come from `rowsOf`.
 * `tableNameOf` only names tables in the messages.
 */
export function routeLinks(outputs: Record<string, unknown>, raws: Record<string, string[]>, map: Map<string, string>, fields: FieldRow[], rowsOf: RowsOf, tableNameOf: (id: string) => string = (id) => id): RoutedLinks {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out = { ...outputs };
  const links: RoutedLinks['links'] = [];
  const unresolved: RoutedLinks['unresolved'] = [];
  for (const c of CANONICAL) {
    const key = map.get(c.key);
    const field = key === undefined ? undefined : byKey.get(key);
    if (!field || field.type !== 'link') continue;
    const canonical = typeof out[c.key] === 'string' ? (out[c.key] as string) : undefined;
    delete out[c.key];
    const raw = raws[c.key];
    if (!raw) continue;                         // nothing was read for it (an audio-only file has no codec): nothing to say
    const target = String(field.options?.target_table_id ?? '');
    const row = resolveRow(rowsOf(target), canonical, raw);
    if (row) { links.push({ fieldId: field.id, toRecord: row.id, name: row.name }); continue; }
    const table = tableNameOf(target);
    unresolved.push({ key: c.key, message: canonical !== undefined
      ? `${field.name}: ${table} has no row named “${canonical}” — add one, or give a row the alias “${canonical}”`
      : `${field.name}: ${rawSpelling(raw)} is not in the built-in ${c.vocabulary} list, and no ${table} row has it as an alias — add a row with the alias “${rawSpelling(raw)}”` });
  }
  return { outputs: out, links, unresolved };
}

/** The link fields a recipe's vocabulary outputs are mapped to — whose target tables a drop must have loaded. */
export function vocabularyLinkFields(recipe: Recipe, fields: FieldRow[]): FieldRow[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const keys = new Set(CANONICAL.map((c) => c.key));
  const out: FieldRow[] = [];
  for (const step of recipe.steps) for (const [k, id] of Object.entries(step.map)) {
    const f = byId.get(id);
    if (keys.has(k) && f?.type === 'link' && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Load the vocabulary tables a recipe links into, so their rows are there to resolve against. */
async function loadVocabularyTables(store: Store, recipe: Recipe, fields: FieldRow[]) {
  for (const f of vocabularyLinkFields(recipe, fields)) {
    const target = String(f.options?.target_table_id ?? '');
    if (store.state.tables.has(target)) await store.loadTable(target);
  }
}

/** A table's rows as `resolveRow` reads them: the primary text and the Aliases column (key `aliases`), when there is one. */
export function vocabRowsOf(store: Store): RowsOf {
  const primary = primaryKeys(store.state);
  return (tableId) => {
    const nameKey = primary.get(tableId);
    const aliasKey = fieldsOf(store.state, tableId).find((f) => f.key === ALIASES_KEY && (f.type === 'text' || f.type === 'long_text'))?.key;
    return recordsOf(store.state, tableId).map((r) => ({ id: r.id, name: nameKey ? String(r.data[nameKey] ?? '') : '', aliases: aliasKey ? r.data[aliasKey] : undefined }));
  };
}

/**
 * Write a resolved link the way a drop writes a select value: the ONE row, replacing
 * whatever the field held (a re-drop corrects, it does not accumulate). Same
 * synchronous run as the values, so the same batch and the same undo.
 */
function writeLinks(store: Store, recordId: string, links: RoutedLinks['links'], options: MutateOptions) {
  for (const l of links) {
    for (const x of store.state.links.values()) {
      if (x.field_id === l.fieldId && x.from_record === recordId && x.to_record !== l.toRecord) store.mutate({ type: 'link.remove', fieldId: l.fieldId, fromRecord: recordId, toRecord: x.to_record }, options);
    }
    if (!store.state.links.has(linkKey(l.fieldId, recordId, l.toRecord))) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: l.fieldId, fromRecord: recordId, toRecord: l.toRecord }, options);
  }
}

/**
 * A hash step's outputs, placed: a single file's `hash` is also written into its
 * manifest's `hashes` map under its algorithm (`{ kind: 'file', size, hashes: { xxh3 } }`);
 * a set's `member_hashes` go beside the members of the manifest — the record's
 * CURRENT one when it has it, else the unit's fresh one. An md5 run after an xxh3
 * sits BESIDE it (contract/fingerprint.ts: the xxh3 is what the app compares, the
 * md5 is what a client verifies); the older single `hash` slot is left as it was.
 * The manifest is written through the field the FILESYSTEM step maps, since the
 * hash step has no manifest output of its own. Pure.
 */
export function withHashes(outputs: Record<string, unknown>, unit: Unit, current: unknown): Record<string, unknown> {
  const out = { ...outputs };
  const members = out.member_hashes as Array<{ path: string; hash: string }> | undefined;
  delete out.member_hashes;
  const base = (current && typeof current === 'object' ? current : unit.manifest) as Record<string, unknown>;
  const add = (thing: Record<string, unknown>, hash: string) => ({ ...thing, hashes: { ...(thing.hashes as Record<string, string> | undefined), [hash.split(':')[0]]: hash } });
  if (typeof out.hash === 'string' && base.kind === 'file') out.manifest = add(base, out.hash);
  else if (members?.length && Array.isArray(base.members)) {
    const byPath = new Map(members.map((m) => [m.path, m.hash]));
    out.manifest = { ...base, members: (base.members as Array<Record<string, unknown>>).map((m) => (byPath.has(String(m.path)) ? add(m, byPath.get(String(m.path))!) : m)) };
  }
  return out;
}
/** A hash step's map, plus — when the step writes into the manifest — the filesystem step's manifest field. */
const hashMap = (step: Step, map: Map<string, string>, manifestKey: string | undefined) => (intoManifest(step) && manifestKey ? new Map([...map, ['manifest', manifestKey]]) : map);

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
  for (const [out, raw] of Object.entries(outputs)) {
    const key = map.get(out);
    if (key === undefined || raw === undefined || raw === null) continue;
    const field = byKey.get(key);
    if (!field) continue;
    // A tag read off a file can carry NULs (a C string's padding); the database
    // cannot store one (contract/values.ts). They mean nothing: taken out, not refused.
    const value = typeof raw === 'string' && raw.includes('\u0000') ? raw.replace(/\u0000/g, '') : raw;
    if (value === '' && raw !== '') continue;
    const problem = validateValue(field as never, value);
    if (problem) skipped.push(`${field.name}: ${problem}`); else data[key] = value;
  }
  return { data, skipped };
}

/* ── the run ──────────────────────────────────────────────────────────────── */

export interface DropTarget {
  /** The grid: files go into this table; `onto` is the row under the pointer, if any. */
  tableId?: string;
  /** The canvas: files become cards here; `onto` is the card under the pointer, if any. */
  canvas?: { id: string; clientX: number; clientY: number;
             place: (records: RecordRow[], clientX: number, clientY: number, options: MutateOptions) => void };
  /** The record under the pointer — a card, a grid row — when the drop was ONTO one. */
  onto?: { recordId: string; tableId: string } | null;
}

export interface DropContext {
  store: Store;
  createRecord: (tableId: string, data: Record<string, unknown>, id: string, context: { defaults?: Array<{ tableId: string; recordId: string }> }, options: MutateOptions) => string;
  /** The canvas's active defaults (the bar), when dropping there. */
  defaults?: Array<{ tableId: string; recordId: string }>;
  /** Open a record in the tray — what every conflict offers, without leaving the view. */
  openRecord?: (recordId: string) => void;
  /** What to call a record in a dialog or notice. */
  labelOf?: (recordId: string) => string;
}

/** What a drop came to: `refused` names a record that flashed the drop away (too many files onto one record). */
export interface DropOutcome { refused?: string }

const enabledTables = (store: Store) => [...store.state.tables.values()]
  .filter((t) => (t.tools as Partial<TablesTools> | undefined)?.file_drop && (!t.kind || t.kind === 'records'))
  .sort((a, b) => a.position - b.position);

/** Which table takes this drop, or null (with the reason already shown). */
async function chooseTable(store: Store, target: DropTarget): Promise<string | null> {
  const enabled = enabledTables(store);
  if (target.onto) {
    if (enabled.some((t) => t.id === target.onto!.tableId)) return target.onto.tableId;
    notice(`File drop is not enabled on that record's table`, 'warn');
    return null;
  }
  if (target.tableId) {
    if (enabled.some((t) => t.id === target.tableId)) return target.tableId;
    notice(`File drop is not enabled on this table — turn it on under ⚙ Table settings → Desktop tools`, 'warn');
    return null;
  }
  if (!enabled.length) { notice(`No table has File drop enabled yet — ⚙ Table settings → Desktop tools on the table the files belong in`, 'warn'); return null; }
  if (enabled.length === 1) return enabled[0].id;
  const r = await askFull({ title: 'Which table?', noText: true, okText: 'Add',
    select: { label: 'Files become records of', options: enabled.map((t) => ({ value: t.id, label: t.name })), initial: enabled[0].id } });
  return r?.choice ?? null;
}

/** A unit's name and path on two lines, for a dialog. */
const describeUnit = (name: string, path: string) => `  ${name}\n  ${path}`;

/**
 * The rules of a drop (the owner, Oct 18 — no path history, nothing invisible):
 *
 *   ON EMPTY SPACE (the grid, the canvas between cards): a file whose path is
 *   already a record of the table is NOT touched — it is skipped and the person
 *   is told, with the record to open. Everything else becomes a new record.
 *
 *   ONTO A RECORD (one file only; more flash the card and do nothing): the file is
 *   compared with what the record describes (contract/fingerprint.ts). Same
 *   bytes, same path → nothing to do. Same bytes, another path → the path (and
 *   name) are updated, silently: that is a rename or a move, and the fingerprint
 *   proves it. Anything else — the sizes differ, the fingerprints differ, the
 *   record has nothing to compare with — asks: "Replace file info?", showing both
 *   names and paths; Replace clears every field the recipe writes and runs it
 *   again; Cancel does nothing. A path already held by ANOTHER record is refused
 *   with that record to open, so two records never claim one file.
 *
 *   The compare needs the dropped file hashed under the record's algorithm
 *   (its fingerprint, normally). Sizes are checked first, which settles most
 *   "differs" without a read; the hash, when needed, is a PRIORITY job
 *   (hashJobs.ts) — someone is waiting on a dialog.
 */
export async function runFileDrop(ctx: DropContext, paths: string[], target: DropTarget): Promise<DropOutcome> {
  const { store } = ctx;
  const tableId = await chooseTable(store, target);
  if (!tableId) return {};
  const table = store.state.tables.get(tableId)!;
  const recipe: Recipe = (table.tools as TablesTools).file_drop!;
  const fields = fieldsOf(store.state, tableId);
  const steps = recipe.steps.map((step) => ({ step, map: resolveMap(step, fields) }));
  const pathKey = steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('path');
  if (!pathKey) { notice(`File drop on ${table.name}: its Path output is mapped to a field that no longer exists`, 'error'); return {}; }
  const manifestKey = steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('manifest');
  // The fingerprint runs at every drop whether or not the recipe has the step (contract/tools.ts).
  if (!steps.some((s) => s.step.analyzer === `hash-${FINGERPRINT}` && !isManual(s.step))) { const step = fingerprintStep(recipe); steps.push({ step, map: resolveMap(step, fields) }); }
  // A MANUAL step (an md5) is the record's to ask for (`runManualStep`), not the drop's.
  // A step with nothing to write is skipped — a hash step writing into the manifest has something.
  const writes = (step: Step, map: Map<string, string>) => map.size > 0 || (intoManifest(step) && !!manifestKey);
  const applying = (u: Unit) => steps.filter(({ step, map }) => writes(step, map) && !isManual(step) && stepApplies(step, u));
  const labelOf = ctx.labelOf ?? ((id: string) => String(store.state.records.get(id)?.data[pathKey] ?? id));

  let units: Unit[];
  try { units = await invoke<Unit[]>('classify', { paths }); }
  catch (e) { notice(`file drop: ${String(e)}`, 'error'); return {}; }
  if (!units.length) { notice('nothing droppable in that (empty folder?)', 'warn'); return {}; }

  await store.loadTable(tableId);
  // The vocabulary tables the recipe links into (Containers, Codecs…): their rows
  // are what the canonical names are resolved against, so they have to be here.
  await loadVocabularyTables(store, recipe, fields);
  const rowsOf = vocabRowsOf(store);
  const tableNameOf = (id: string) => store.state.tables.get(id)?.name ?? 'the target table';
  const byPath = new Map<string, RecordRow>();
  for (const r of recordsOf(store.state, tableId)) { const p = r.data[pathKey]; if (typeof p === 'string') byPath.set(p, r); }

  /* ── onto a record ── */
  const onto = target.onto && target.onto.tableId === tableId ? store.state.records.get(target.onto.recordId) : undefined;
  if (onto) {
    if (units.length !== 1) { notice(`Only one file can replace a record — ${units.length} were dropped onto ${labelOf(onto.id)}`, 'warn'); return { refused: onto.id }; }
    const u = units[0];
    const holder = byPath.get(u.path);
    if (holder && holder.id !== onto.id) {
      notice(`${u.name} is already the file of another ${table.name} record — a path belongs to one record`, 'warn', [{ id: holder.id, label: labelOf(holder.id) }]);
      return {};
    }
    const recorded = manifestKey ? (Manifest.safeParse(onto.data[manifestKey]).data ?? null) : null;
    let dropped = Manifest.safeParse(u.manifest).data ?? null;
    let verdict = compareManifests(recorded, dropped);
    const algo = compareAlgorithm(recorded);
    if (verdict === null && recorded && dropped && algo && dropped.kind !== 'sequence' && dropped.kind === recorded.kind) {
      // Sizes agree and the record carries a hash: read the dropped file under that
      // algorithm. Someone is waiting, so this job goes to the front of the line.
      jobs.set(onto.id, { label: `comparing (${algo})`, manual: false });
      try {
        const r = await runHash({ kind: 'unit', unit: u, analyzer: `hash-${algo}` }, { recordId: onto.id, name: u.name, total: u.total_size, priority: true });
        dropped = Manifest.safeParse(withHashes(r.outputs as Record<string, unknown>, u, u.manifest).manifest).data ?? dropped;
        verdict = compareManifests(recorded, dropped);
      } catch (e) { notice(`${u.name}: could not be compared — ${String(e)}`, 'warn'); }
      finally { jobs.delete(onto.id); }
    }
    const current = String(onto.data[pathKey] ?? '');
    if (verdict?.same) {
      if (current === u.path) { notice(`${u.name}: nothing to update — it is the file this record describes (same ${verdict.by})`); return {}; }
      // A rename or a move, proven: the path and name follow; the manifest keeps its hashes; no recipe.
      const fs = steps.find((s) => s.step.analyzer === 'filesystem')!;
      const m = mappedData(immediateOutputs('filesystem', u), fs.map, fields);
      delete m.data[manifestKey ?? '\0'];
      store.mutate({ type: 'record.update', id: onto.id, set: m.data, unset: [] }, VIA);
      notice(`${labelOf(onto.id)}: path updated to ${u.path} (same file by ${verdict.by})`);
      return {};
    }
    const why = verdict ? (verdict.by === 'size' ? 'Their sizes differ.' : `Their ${verdict.by} fingerprints differ.`)
      : !recorded ? 'The record has no manifest to compare with.'
      : !algo ? 'The record has no fingerprint to compare with.'
      : recorded.kind !== dropped?.kind ? `The record is a ${recorded.kind.replace('_', ' ')}, the drop a ${dropped?.kind.replace('_', ' ') ?? 'file'}.`
      : 'They could not be compared.';
    const ok = await confirmDialog({ title: 'Replace file info?', okText: 'Replace', danger: true,
      body: `This record describes:\n${describeUnit(String(onto.data[steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('name') ?? ''] ?? labelOf(onto.id)), current || '(no path)')}\n\nYou dropped:\n${describeUnit(u.name, u.path)}\n\n${why}\n\nReplace fills in the fields the drop recipe writes and keeps everything else — status, notes, links.` });
    if (!ok) return {};
    if (!store.state.records.has(onto.id)) return {};
    // ── one synchronous run: clear what the recipe owns, write what is known now ──
    const data: Record<string, unknown> = {};
    const allSkipped: string[] = [];
    for (const { step, map } of applying(u)) {
      if (!IMMEDIATE.has(step.analyzer)) continue;
      const m = mappedData(immediateOutputs(step.analyzer, u), map, fields);
      Object.assign(data, m.data); allSkipped.push(...m.skipped);
    }
    const owned = new Set<string>();
    for (const { map } of steps) for (const key of map.values()) owned.add(key);
    const unset = [...owned].filter((k) => !(k in data) && onto.data[k] !== undefined);
    store.mutate({ type: 'record.update', id: onto.id, set: data, unset }, VIA);
    for (const f of vocabularyLinkFields(recipe, fields)) {
      for (const x of store.state.links.values()) if (x.field_id === f.id && x.from_record === onto.id) store.mutate({ type: 'link.remove', fieldId: f.id, fromRecord: onto.id, toRecord: x.to_record }, VIA);
    }
    // ── end of the undo step ──
    notice(`${u.name}: file info replaced on ${labelOf(onto.id)}`);
    for (const sk of new Set(allSkipped)) notice(`not written — ${sk}`, 'warn');
    await followUp(store, [{ id: onto.id, unit: u }], applying, fields, rowsOf, tableNameOf, manifestKey);
    return {};
  }

  /* ── on empty space ── */
  const existing = units.filter((u) => byPath.has(u.path));
  const creates = units.filter((u) => !byPath.has(u.path));
  if (existing.length && !creates.length && units.length === 1) {
    const r = byPath.get(existing[0].path)!;
    const open = await confirmDialog({ title: `Already in ${table.name}`, okText: 'Open', cancelText: 'Close',
      body: `${existing[0].name} is already a record of ${table.name}:\n  ${labelOf(r.id)}\n  ${existing[0].path}\n\nTo update that record with this file, drop the file onto it.` });
    if (open) ctx.openRecord?.(r.id);
    return {};
  }
  if (creates.length > ASK_ABOVE) {
    const ok = await confirmDialog({ title: `Create ${creates.length} records?`, body: `${units.length} items were dropped (${creates.length} new). One Ctrl+Z undoes them all.`, okText: `Create ${creates.length}` });
    if (!ok) return {};
  }

  // ── stage 2: one synchronous run from here to the end of the loop ──
  const made: RecordRow[] = [];
  const touched: Array<{ id: string; unit: Unit }> = [];
  const allSkipped: string[] = [];
  for (const u of creates) {
    const data: Record<string, unknown> = {};
    for (const { step, map } of applying(u)) {
      if (!IMMEDIATE.has(step.analyzer)) continue;
      const m = mappedData(immediateOutputs(step.analyzer, u), map, fields);
      Object.assign(data, m.data); allSkipped.push(...m.skipped);
    }
    const id = crypto.randomUUID();
    ctx.createRecord(tableId, data, id, { defaults: ctx.defaults }, VIA);
    const row = store.state.records.get(id);
    if (row) made.push(row);
    touched.push({ id, unit: u });
  }
  if (target.canvas && made.length) target.canvas.place(made, target.canvas.clientX, target.canvas.clientY, VIA);
  // ── end of the undo step ──

  if (made.length) notice(`File drop → ${table.name}: ${made.length} new`);
  if (existing.length) {
    notice(`${existing.length === 1 ? `${existing[0].name} is` : `${existing.length} files are`} already in ${table.name} — not added again. To update a record with its file, drop the file onto it.`, 'warn',
      existing.map((u) => ({ id: byPath.get(u.path)!.id, label: labelOf(byPath.get(u.path)!.id) })));
  }
  for (const s of new Set(allSkipped)) notice(`not written — ${s}`, 'warn');
  await followUp(store, touched, applying, fields, rowsOf, tableNameOf, manifestKey);
  return {};
}

/**
 * Stage 3: the analyzers that run a program or read the bytes, in recipe order,
 * each its own small update, not undoable. A hash goes through the hash line
 * (hashJobs.ts): one at a time, with progress, cancellable.
 */
async function followUp(store: Store, touched: Array<{ id: string; unit: Unit }>, applying: (u: Unit) => Array<{ step: Step; map: Map<string, string> }>,
                        fields: FieldRow[], rowsOf: RowsOf, tableNameOf: (id: string) => string, manifestKey: string | undefined) {
  for (const { id, unit } of touched) {
    for (const { step, map } of applying(unit)) {
      if (IMMEDIATE.has(step.analyzer)) continue;
      if (!store.state.records.has(id)) break;   // undone meanwhile: stop, write nothing
      const a = analyzerOf(step.analyzer);
      const hashing = isHashStep(step);
      jobs.set(id, { label: a?.program ?? a?.name ?? step.analyzer, manual: false });
      try {
        const raw = hashing
          ? await runHash({ kind: 'unit', unit, analyzer: step.analyzer }, { recordId: id, name: unit.name, total: unit.total_size })
          : await invoke<{ outputs: Record<string, unknown> }>('analyze', { unit, analyzer: step.analyzer });
        const { outputs, unknown, raws } = withVocabulary(step.analyzer, raw.outputs as Record<string, unknown>, unit);
        const routed = routeLinks(outputs, raws, map, fields, rowsOf, tableNameOf);
        const placed = hashing ? withHashes(routed.outputs, unit, manifestKey ? store.state.records.get(id)?.data[manifestKey] : undefined) : routed.outputs;
        const { data, skipped } = mappedData(placed, hashing ? hashMap(step, map, manifestKey) : map, fields);
        if (store.state.records.has(id)) {
          if (Object.keys(data).length) store.mutate({ type: 'record.update', id, set: data, unset: [] }, FOLLOW_UP);
          writeLinks(store, id, routed.links, FOLLOW_UP);
        }
        for (const sk of skipped) notice(`${unit.name}: not written — ${sk}`, 'warn');
        for (const u of routed.unresolved) notice(`${unit.name}: not linked — ${u.message}`, 'warn');
        // Only worth saying when the table wanted the canonical name — and a link
        // field has already had its say above (an alias may even have resolved it).
        const linked = new Set(routed.links.map((l) => l.fieldId)), said = new Set(routed.unresolved.map((u) => u.key));
        for (const u of unknown) if (map.has(u.key) && !said.has(u.key) && !linked.has(fields.find((f) => f.key === map.get(u.key))?.id ?? '')) notice(`${unit.name}: not written — ${u.message}`, 'warn');
      } catch (e) {
        if (!/cancelled/.test(String(e))) notice(`${unit.name}: ${a?.name ?? step.analyzer} — ${String(e)}`, 'error');
      }
      jobs.delete(id);
    }
  }
}

/* ── a manual step, from the record ──────────────────────────────────────── */

const recipeOf = (store: Store, tableId: string): Recipe | undefined => (store.state.tables.get(tableId)?.tools as Partial<TablesTools> | undefined)?.file_drop;
/** The KEY of the field the filesystem step maps an output to (`path`, `manifest`), or undefined. */
function filesystemKey(store: Store, tableId: string, output: string): string | undefined {
  const fs = recipeOf(store, tableId)?.steps.find((s) => s.analyzer === 'filesystem');
  return fs ? resolveMap(fs, fieldsOf(store.state, tableId)).get(output) : undefined;
}
export const pathKeyOf = (store: Store, tableId: string) => filesystemKey(store, tableId, 'path');

/** The recipe's manual steps on this table — what the record offers to run. */
export function manualSteps(store: Store, tableId: string): Array<{ index: number; step: Step; name: string }> {
  const recipe = recipeOf(store, tableId);
  if (!recipe) return [];
  const manifestKey = filesystemKey(store, tableId, 'manifest');
  return recipe.steps.flatMap((step, index) => (isManual(step) && (Object.keys(step.map).length || (intoManifest(step) && manifestKey)) ? [{ index, step, name: analyzerOf(step.analyzer)?.name ?? step.analyzer }] : []));
}

/**
 * Where the ▶ buttons live in the record tray: the Manifest field the recipe maps
 * (a hash lands there), else the field the first manual step's Hash maps to.
 */
export function manualHomeField(store: Store, tableId: string): string | null {
  const fields = fieldsOf(store.state, tableId);
  const manifestKey = filesystemKey(store, tableId, 'manifest');
  const byKey = fields.find((f) => f.key === manifestKey);
  if (byKey) return byKey.id;
  for (const m of manualSteps(store, tableId)) { const id = m.step.map.hash; if (id && fields.some((f) => f.id === id)) return id; }
  return null;
}

/**
 * Run ONE manual step of the table's recipe on one record, from its path — the
 * ▶ beside the path in the record tray. The shell classifies the path afresh and
 * runs the analyzer (`analyze_path`; for a file not dropped this session it asks
 * the person in a native dialog first). One undoable `record.update`: a hash asked
 * for by hand is a deliberate change, not a drop's follow-up.
 */
export async function runManualStep(store: Store, recordId: string, stepIndex: number): Promise<void> {
  const record = store.state.records.get(recordId);
  if (!record) return;
  const table = store.state.tables.get(record.table_id);
  const recipe = (table?.tools as Partial<TablesTools> | undefined)?.file_drop;
  const step = recipe?.steps[stepIndex];
  if (!table || !recipe || !step) { notice('That step is no longer in the recipe', 'warn'); return; }
  const fields = fieldsOf(store.state, record.table_id);
  const steps = recipe.steps.map((st) => ({ step: st, map: resolveMap(st, fields) }));
  const pathKey = steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('path');
  const manifestKey = steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('manifest');
  const path = pathKey ? record.data[pathKey] : undefined;
  if (typeof path !== 'string' || !path) { notice('This record has no path to run it on', 'warn'); return; }
  const map = resolveMap(step, fields);
  const a = analyzerOf(step.analyzer);
  const label = a?.name ?? step.analyzer;
  jobs.set(recordId, { label: a?.program ?? label, manual: true });
  try {
    await loadVocabularyTables(store, { steps: [step] }, fields);
    const r = isHashStep(step)
      ? await runHash({ kind: 'path', path, analyzer: step.analyzer }, { recordId, name: path.split('/').pop() ?? path, total: Number(record.data[steps.find((s) => s.step.analyzer === 'filesystem')?.map.get('total_size') ?? ''] ?? 0) || 0 }) as { unit: Unit; outputs: Record<string, unknown> }
      : await invoke<{ unit: Unit; outputs: Record<string, unknown> }>('analyze_path', { path, analyzer: step.analyzer });
    if (!stepApplies(step, r.unit)) { notice(`${r.unit.name}: ${label} does not run on ${r.unit.media} ${r.unit.kind.replace('_', ' ')}s (the step's "runs on")`, 'warn'); return; }
    const { outputs, unknown, raws } = withVocabulary(step.analyzer, r.outputs, r.unit);
    const routed = routeLinks(outputs, raws, map, fields, vocabRowsOf(store), (id) => store.state.tables.get(id)?.name ?? 'the target table');
    const hashing = isHashStep(step);
    const placed = hashing ? withHashes(routed.outputs, r.unit, manifestKey ? record.data[manifestKey] : undefined) : routed.outputs;
    const { data, skipped } = mappedData(placed, hashing ? hashMap(step, map, manifestKey) : map, fields);
    if ((Object.keys(data).length || routed.links.length) && store.state.records.has(recordId)) {
      if (Object.keys(data).length) store.mutate({ type: 'record.update', id: recordId, set: data, unset: [] }, VIA);
      writeLinks(store, recordId, routed.links, VIA);
      notice(`${r.unit.name}: ${label} done`);
    }
    else if (!skipped.length && !routed.unresolved.length) notice(`${r.unit.name}: ${label} produced nothing for this table's fields`, 'warn');
    for (const sk of skipped) notice(`${r.unit.name}: not written — ${sk}`, 'warn');
    for (const u of routed.unresolved) notice(`${r.unit.name}: not linked — ${u.message}`, 'warn');
    const said = new Set(routed.unresolved.map((u) => u.key)), linked = new Set(routed.links.map((l) => l.fieldId));
    for (const u of unknown) if (map.has(u.key) && !said.has(u.key) && !linked.has(fields.find((f) => f.key === map.get(u.key))?.id ?? '')) notice(`${r.unit.name}: not written — ${u.message}`, 'warn');
  } catch (e) { if (!/cancelled/.test(String(e))) notice(`${label} — ${String(e)}`, 'error'); }
  finally { jobs.delete(recordId); }
}
