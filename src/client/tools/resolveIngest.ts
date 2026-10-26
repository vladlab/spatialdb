/**
 * The Resolve timeline tool, the page's half (RESOLVE-BRIEF.md R4–R5).
 *
 * "Ingest info from Resolve…" on a grid row, a canvas card or a kanban card:
 *
 *   1. the desktop shell lists the open project's timelines (`resolve_timelines`);
 *   2. a dialog asks which one — the current timeline preselected. Always shown:
 *      the owner wanted the confirmation, "we can remove it if it's annoying";
 *   3. the shell reads that timeline (`resolve_read`) into contract/tools.ts outputs;
 *   4. THIS BUILD (R2/R3) stops there and shows what was read, output by output,
 *      with the field each one is mapped to — nothing is written yet. Writing it
 *      (the overwrite check, the batch, the path links) is R4, built once the
 *      reading has been seen to be right against a real Resolve.
 *
 * Only in the desktop app, only on a table with the tool switched on, one record
 * at a time. Nothing executable reaches the shell: the page sends a timeline NAME
 * picked from the list the shell itself returned.
 */
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { invoke, isDesktop, jobs, notice } from '../desktop';
import { askFull, confirmDialog } from '../dialogs';
import { analyzerOf, type Recipe, type TablesTools } from '../../contract/tools';
import { layoutFromTimeline, summarise, TimelineAudio } from '../../contract/shapes';

export interface ResolveProject { version: string; project: string; timelines: string[]; current: string | null }
export interface ResolveRead { outputs: Record<string, unknown>; problems: string[]; raw: Record<string, unknown> }

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

/**
 * What was read, as the lines of the readout: each output in the analyzer's own
 * order, its value, and where the recipe sends it. Pure — tested in test/resolve.ts.
 */
export function readout(read: ResolveRead, recipe: Recipe, fields: Array<{ id: string; name: string }>): string {
  const a = analyzerOf('resolve')!;
  const map = recipe.steps[0]?.map ?? {};
  const nameOf = new Map(fields.map((f) => [f.id, f.name]));
  const where = (key: string) => (map[key] ? `→ ${nameOf.get(map[key]) ?? 'a missing field'}` : '(not mapped)');
  const lines: string[] = [];
  const o = read.outputs;
  const tracks = TimelineAudio.safeParse(o.audio_tracks);
  for (const out of a.outputs) {
    let value: string;
    if (out.key === 'audio_tracks') value = tracks.success ? summarise('timeline_audio', tracks.data) : (o.audio_tracks === undefined ? '—' : 'not a valid track list');
    else if (out.key === 'audio_layout') value = tracks.success ? summarise('audio_layout', layoutFromTimeline(tracks.data).layout, true) : '—';
    else if (out.key === 'audio_files') {
      const paths = tracks.success ? [...new Set(tracks.data.tracks.flatMap((t) => t.clips.flatMap((c) => (c.path ? [c.path] : []))))] : [];
      value = paths.length ? `${paths.length} file path${paths.length === 1 ? '' : 's'}` : '—';
    }
    else value = o[out.key] === undefined ? '—' : String(o[out.key]);
    lines.push(`${out.name}: ${value}   ${where(out.key)}`);
  }
  if (tracks.success && tracks.data.tracks.length) {
    lines.push('', 'Audio tracks:');
    for (const t of [...tracks.data.tracks].sort((x, y) => x.index - y.index)) {
      lines.push(`  ${t.name || `A${t.index}`} · ${t.format}${t.clips.length ? '' : ' · no clips'}`);
      for (const c of t.clips) lines.push(`      ${c.name}  ${c.start} – ${c.end}  (${c.frames} fr)${c.path ? `\n        ${c.path}` : '  · no file'}`);
    }
    for (const p of layoutFromTimeline(tracks.data).problems) lines.push(`⚠ ${p}`);
  }
  if (read.raw && Object.keys(read.raw).length) {
    lines.push('', `As Resolve said it: start frame ${String(read.raw.start_frame)}, end frame ${String(read.raw.end_frame)}, rate "${String(read.raw.rate)}", drop "${String(read.raw.drop)}"`);
  }
  for (const p of read.problems) lines.push(`⚠ ${p}`);
  lines.push('', 'Nothing was written: this build only reads. Writing onto the record comes next.');
  return lines.join('\n');
}

export async function ingestFromResolve(store: Store, recordId: string, label: string): Promise<void> {
  const record = store.state.records.get(recordId);
  const recipe = record ? recipeOf(store, record.table_id) : undefined;
  if (!record || !recipe) { notice('The Resolve tool is not switched on for this table', 'warn'); return; }

  let project: ResolveProject;
  jobs.set(recordId, { label: 'Resolve', manual: true });
  try { project = await invoke<ResolveProject>('resolve_timelines'); }
  catch (e) { notice(`Resolve — ${String(e)}`, 'error'); return; }
  finally { jobs.delete(recordId); }
  if (!project.timelines.length) { notice(`Resolve: project “${project.project}” has no timelines`, 'warn'); return; }

  const initial = project.current && project.timelines.includes(project.current) ? project.current : project.timelines[0];
  const pick = await askFull({
    title: 'Ingest info from Resolve',
    body: `Onto “${label || 'untitled'}”\nfrom project “${project.project}” · Resolve ${project.version}`,
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

  await confirmDialog({ title: `Read from Resolve: “${timeline}”`, body: readout(read, recipe, fieldsOf(store.state, record.table_id)), okText: 'Close', noCancel: true });
}
