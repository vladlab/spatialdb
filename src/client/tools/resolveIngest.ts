/**
 * The Resolve timeline tool, the page's half (RESOLVE-BRIEF.md R4–R5).
 *
 * "Ingest info from Resolve…" on a grid row, a canvas card or a kanban card:
 *
 *   1. the desktop shell lists the open project's timelines (`resolve_timelines`);
 *   2. a dialog asks which one — the current timeline preselected. Always shown:
 *      the owner wanted the confirmation, "we can remove it if it's annoying";
 *   3. the shell reads that timeline (`resolve_read`) into contract/tools.ts outputs;
 *   4. the outputs are mapped through the table's recipe: the values
 *      (`mappedData`, as a drop does), the audio layout DERIVED from the tracks
 *      (`layoutFromTimeline`), and the clips' files LINKED by exact path into the
 *      recipe's link field — the owner's general Inputs. Links are only ever ADDED
 *      (contract/resolveLinks.ts explains why: the tool does not own that field);
 *   5. the OVERWRITE check: every mapped field that already holds a different
 *      value is listed in one dialog — Overwrite / Cancel, all or nothing, like the
 *      drop's Replace / Cancel. Cancel writes nothing, links included. An empty
 *      record just imports;
 *   6. one batch: the `record.update` and the `link.add`s, tagged `via: 'resolve'`,
 *      one Ctrl+Z. Then the notices: what was done, what was skipped, which clip
 *      paths have no File record (never created).
 *
 * Only in the desktop app, only on a table with the tool switched on, one record
 * at a time. Nothing executable reaches the shell: the page sends a timeline NAME
 * picked from the list the shell itself returned.
 */
import type { Store, MutateOptions } from '../store';
import { fieldsOf, linkKey, recordsOf, type FieldRow } from '../state';
import { invoke, isDesktop, jobs, notice } from '../desktop';
import { askFull, confirmDialog } from '../dialogs';
import { resolveMap, type Recipe, type TablesTools } from '../../contract/tools';
import { layoutFromTimeline, summarise, shapeOf, TimelineAudio, formatNumberField } from '../../contract/shapes';
import { conflicts, timelinePaths, type Conflict } from '../../contract/resolveLinks';
import { mappedData } from './fileDrop';

export interface ResolveProject { version: string; project: string; timelines: string[]; current: string | null }
export interface ResolveRead { outputs: Record<string, unknown>; problems: string[]; raw: Record<string, unknown> }

export const VIA: MutateOptions = { via: 'resolve' };

const recipeOf = (store: Store, tableId: string): Recipe | undefined => {
  const t = store.state.tables.get(tableId);
  if (t?.kind && t.kind !== 'records') return undefined;
  return (t?.tools as Partial<TablesTools> | undefined)?.resolve;
};

/** Whether the menu item belongs on this record: the desktop app, and the tool on for its table. */
export function resolveOffered(store: Store, recordId: string): boolean {
  if (!isDesktop()) return false;
  const r = store.state.records.get(recordId);
  return !!r && !!recipeOf(store, r.table_id);
}

/* ── pure: what an ingest would do ─────────────────────────────────────────── */

export interface LinkPlan {
  field: FieldRow;
  /** Files to link that are not linked yet: [record id, path]. */
  add: Array<{ id: string; path: string }>;
  /** Already linked: left alone. */
  kept: number;
  /** Clip paths with no File record. */
  missing: string[];
  /** Why nothing could be matched at all, when so. */
  problem?: string;
}

/**
 * The link output, resolved: which records of the field's target table the clip
 * paths name, EXACTLY. `pathOf` reads a target record's path column — undefined
 * when the target table has none (then nothing matches and the plan says why).
 * `single_target`: one match is taken and the rest reported as missing-by-rule.
 */
export function planLinks(field: FieldRow, paths: string[], targets: Array<{ id: string; path: unknown }>, linked: string[], pathColumn: boolean, tableName: string): LinkPlan {
  if (!pathColumn) return { field, add: [], kept: 0, missing: [], problem: `${field.name}: ${tableName} has no path column for the tool to match on (its File drop recipe maps no Path)` };
  const byPath = new Map<string, string>();
  for (const t of targets) if (typeof t.path === 'string' && t.path && !byPath.has(t.path)) byPath.set(t.path, t.id);
  const add: LinkPlan['add'] = [], missing: string[] = [];
  let kept = 0;
  for (const p of paths) {
    const id = byPath.get(p);
    if (!id) { missing.push(p); continue; }
    if (linked.includes(id)) { kept++; continue; }
    if (!add.some((a) => a.id === id)) add.push({ id, path: p });
  }
  if (field.options?.single === true && add.length + kept > 1) {
    const extra = add.splice(kept ? 0 : 1);
    for (const e of extra) missing.push(`${e.path} (the field links one record; it already has one)`);
  }
  return { field, add, kept, missing };
}

/** The outputs the page derives before mapping: the layout from the tracks. Pure. */
export function withDerived(outputs: Record<string, unknown>): { outputs: Record<string, unknown>; problems: string[] } {
  const out = { ...outputs };
  const problems: string[] = [];
  const t = TimelineAudio.safeParse(out.audio_tracks);
  if (t.success) {
    const d = layoutFromTimeline(t.data);
    out.audio_layout = d.layout;
    problems.push(...d.problems);
  }
  delete out.audio_files;   // a link, not a value: planned separately
  return { outputs: out, problems };
}

/** One line of the overwrite dialog: the field, what it holds, what it would hold. */
export function conflictLine(c: Conflict, field: FieldRow): string {
  const show = (v: unknown) => {
    if (field.type === 'structured') return summarise(shapeOf(field), v) || '(empty)';
    return formatNumberField(field, v) ?? (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  };
  return `${c.name} · ${show(c.old)} → ${show(c.next)}`;
}

/* ── the run ───────────────────────────────────────────────────────────────── */

export async function ingestFromResolve(store: Store, recordId: string, label: string): Promise<void> {
  const record = store.state.records.get(recordId);
  const recipe = record ? recipeOf(store, record.table_id) : undefined;
  if (!record || !recipe) { notice('The Resolve tool is not switched on for this table', 'warn'); return; }
  const name = label || 'untitled';

  let project: ResolveProject;
  jobs.set(recordId, { label: 'Resolve', manual: true });
  try { project = await invoke<ResolveProject>('resolve_timelines'); }
  catch (e) { notice(`Resolve — ${String(e)}`, 'error'); return; }
  finally { jobs.delete(recordId); }
  if (!project.timelines.length) { notice(`Resolve: project “${project.project}” has no timelines`, 'warn'); return; }

  const initial = project.current && project.timelines.includes(project.current) ? project.current : project.timelines[0];
  const pick = await askFull({
    title: 'Ingest info from Resolve',
    body: `Onto “${name}”\nfrom project “${project.project}” · Resolve ${project.version}`,
    noText: true,
    select: { label: 'Timeline', options: project.timelines.map((t) => ({ value: t, label: t === project.current ? `${t} (current)` : t })), initial },
    okText: 'Read',
  });
  if (!pick) return;
  const timeline = pick.choice || initial;

  let read: ResolveRead;
  jobs.set(recordId, { label: 'Resolve', manual: true });
  try { read = await invoke<ResolveRead>('resolve_read', { timeline }); }
  catch (e) { notice(`Resolve — ${String(e)}`, 'error'); return; }
  finally { jobs.delete(recordId); }
  for (const p of read.problems) notice(`${timeline}: ${p}`, 'warn');

  // ── map
  const fields = fieldsOf(store.state, record.table_id);
  const step = recipe.steps[0];
  const map = resolveMap(step, fields);
  const derived = withDerived(read.outputs);
  for (const p of derived.problems) notice(`${timeline}: ${p}`, 'warn');
  const { data, skipped } = mappedData(derived.outputs, map, fields);

  // ── the links: into the recipe's link field, by exact path, added only
  let plan: LinkPlan | null = null;
  const linkKeyName = map.get('audio_files');
  const linkField = linkKeyName ? fields.find((f) => f.key === linkKeyName && f.type === 'link') : undefined;
  if (linkField) {
    const target = String(linkField.options?.target_table_id ?? '');
    if (store.state.tables.has(target)) await store.loadTable(target);
    const pathKey = pathKeyOf(store, target);
    const linked = [...store.state.links.values()].filter((l) => l.field_id === linkField.id && l.from_record === recordId).map((l) => l.to_record);
    plan = planLinks(linkField, timelinePaths(read.outputs.audio_tracks), recordsOf(store.state, target).map((r) => ({ id: r.id, path: pathKey ? r.data[pathKey] : undefined })), linked, !!pathKey, store.state.tables.get(target)?.name ?? 'the target table');
  }

  // ── the overwrite check: ask FIRST, then write (dialogs.ts)
  const current = store.state.records.get(recordId);
  if (!current) return;
  const cs = conflicts(current.data, data, fields);
  if (cs.length) {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const ok = await confirmDialog({
      title: `Overwrite ${cs.length} field${cs.length === 1 ? '' : 's'} on “${name}”?`,
      body: `From timeline “${timeline}”:\n\n${cs.map((c) => conflictLine(c, byId.get(c.fieldId)!)).join('\n')}\n\nEverything else read is written too. Cancel writes nothing.`,
      okText: 'Overwrite', danger: true,
    });
    if (!ok) { notice(`${name}: nothing written`); return; }
  }

  // ── one batch
  if (!store.state.records.has(recordId)) return;
  const wrote = Object.keys(data).length;
  if (wrote) store.mutate({ type: 'record.update', id: recordId, set: data, unset: [] }, VIA);
  let added = 0;
  if (plan && linkField) {
    for (const a of plan.add) {
      if (!store.state.links.has(linkKey(linkField.id, recordId, a.id))) { store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: linkField.id, fromRecord: recordId, toRecord: a.id }, VIA); added++; }
    }
  }
  const parts = [`${wrote} field${wrote === 1 ? '' : 's'}`];
  if (plan) parts.push(`${added} file${added === 1 ? '' : 's'} linked${plan.kept ? ` (${plan.kept} already)` : ''}`);
  if (wrote || added) notice(`${name}: Resolve done — ${parts.join(', ')}`);
  else notice(`${name}: Resolve read “${timeline}”, but nothing was mapped to this table's fields — see Table settings → Desktop tools`, 'warn');
  for (const sk of skipped) notice(`${name}: not written — ${sk}`, 'warn');
  if (plan?.problem) notice(`${name}: ${plan.problem}`, 'warn');
  for (const m of plan?.missing ?? []) notice(`${name}: not linked — no record of ${store.state.tables.get(String(linkField!.options?.target_table_id ?? ''))?.name ?? 'the target table'} at ${m}`, 'warn');
}

/** The field KEY a table's File drop recipe writes `filesystem.path` to, if any (as fileDrop.ts's `pathKeyOf`, without its import cycle). */
function pathKeyOf(store: Store, tableId: string): string | undefined {
  const recipe = (store.state.tables.get(tableId)?.tools as Partial<TablesTools> | undefined)?.file_drop;
  const fs = recipe?.steps.find((s) => s.analyzer === 'filesystem');
  return fs ? resolveMap(fs, fieldsOf(store.state, tableId)).get('path') : undefined;
}
