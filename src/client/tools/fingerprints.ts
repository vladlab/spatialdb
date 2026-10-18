/**
 * The fingerprint run: every record that has a file and no fingerprint yet.
 *
 * There is NO queue stored anywhere. "What still wants a fingerprint" is a query
 * over the records the client has loaded (contract/fingerprint.ts
 * `needsFingerprint`), so it is right after a crash, a force-quit, a drop whose
 * follow-ups never finished, and a record typed in by hand with a path — by
 * definition, not by bookkeeping. The footer strip (FingerprintStrip.vue) shows
 * the count and a Run button; nothing starts on its own, since a colleague
 * opening the app on a laptop must not start reading the NAS.
 *
 * Reading files nobody dropped this session is rule 3 of the shell (lib.rs): a
 * NATIVE dialog has to allow them — `allow_paths` asks for the whole batch in
 * one. Then each file goes through the hash line (hashJobs.ts), one at a time,
 * and its fingerprint is written into the record's manifest the way a drop's
 * would be (`withHashes`), not undoable: a fingerprint is bookkeeping, not a
 * change anyone made.
 */

import { reactive } from 'vue';
import type { Store } from '../store';
import type { RecordRow } from '../state';
import { fieldsOf } from '../state';
import { Manifest } from '../../contract/shapes';
import { FINGERPRINT, needsFingerprint } from '../../contract/fingerprint';
import { fingerprintStep, resolveMap, type TablesTools } from '../../contract/tools';
import { invoke, isDesktop, jobs, notice } from '../desktop';
import { runHash } from './hashJobs';
import { mappedData, withHashes, type Unit } from './fileDrop';

export interface Candidate { record: RecordRow; tableId: string; path: string; name: string; total: number }

/** Records that failed this session: left out of the count until Retry puts them back. */
export const failedFingerprints = reactive(new Set<string>());

/**
 * Every loaded record of a File-drop table that has a path and no fingerprint:
 * its manifest wants one (`needsFingerprint`), or it has no manifest at all (a
 * record made by hand — classifying its path will give it one). A sequence
 * never counts. Tables not loaded in this client are not seen — the count is
 * of what is on screen's side of things, not the whole database.
 */
export function missingFingerprints(store: Store): Candidate[] {
  const out: Candidate[] = [];
  for (const t of store.state.tables.values()) {
    const recipe = (t.tools as Partial<TablesTools> | undefined)?.file_drop;
    if (!recipe || (t.kind && t.kind !== 'records')) continue;
    const fields = fieldsOf(store.state, t.id);
    const fs = recipe.steps.find((s) => s.analyzer === 'filesystem');
    if (!fs) continue;
    const map = resolveMap(fs, fields);
    const pathKey = map.get('path'), manifestKey = map.get('manifest'), nameKey = map.get('name'), sizeKey = map.get('total_size');
    if (!pathKey || !manifestKey) continue;   // nowhere to keep a fingerprint
    for (const r of store.state.records.values()) {
      if (r.table_id !== t.id || failedFingerprints.has(r.id)) continue;
      const path = r.data[pathKey];
      if (typeof path !== 'string' || !path) continue;
      const raw = r.data[manifestKey];
      const m = raw === undefined || raw === null ? null : Manifest.safeParse(raw).data ?? null;
      if (raw !== undefined && raw !== null && !m) continue;        // an invalid manifest is a different problem
      if (m ? !needsFingerprint(m) : false) continue;
      const name = typeof r.data[nameKey ?? ''] === 'string' && r.data[nameKey ?? ''] ? String(r.data[nameKey ?? '']) : path.split('/').pop() ?? path;
      out.push({ record: r, tableId: t.id, path, name, total: Number(r.data[sizeKey ?? ''] ?? 0) || 0 });
    }
  }
  return out;
}

export const fingerprintRun = reactive({ active: false, total: 0, done: 0, failed: 0 });

/**
 * Fingerprint these candidates: one native dialog to allow the paths, then one
 * hash at a time. Returns when every one has been tried. A second call while
 * one runs is ignored — the strip disables its button meanwhile.
 */
export async function runFingerprints(store: Store, candidates: Candidate[]): Promise<void> {
  if (!isDesktop() || fingerprintRun.active || !candidates.length) return;
  fingerprintRun.active = true; fingerprintRun.total = candidates.length; fingerprintRun.done = 0; fingerprintRun.failed = 0;
  try {
    let allowed = true;
    try { allowed = await invoke<boolean>('allow_paths', { paths: candidates.map((c) => c.path), why: 'fingerprint them (xxh3)' }); }
    catch (e) { notice(`fingerprints: ${String(e)}`, 'error'); return; }
    if (!allowed) { notice('Fingerprints: not run — you did not allow the files to be read', 'warn'); return; }
    for (const c of candidates) {
      if (!store.state.records.has(c.record.id)) { fingerprintRun.done++; continue; }
      const table = store.state.tables.get(c.tableId);
      const recipe = (table?.tools as Partial<TablesTools> | undefined)?.file_drop;
      if (!recipe) { fingerprintRun.done++; continue; }
      const fields = fieldsOf(store.state, c.tableId);
      const fs = recipe.steps.find((s) => s.analyzer === 'filesystem');
      const manifestKey = fs ? resolveMap(fs, fields).get('manifest') : undefined;
      const step = fingerprintStep(recipe);
      const map = new Map(resolveMap(step, fields));
      if (manifestKey) map.set('manifest', manifestKey);
      jobs.set(c.record.id, { label: `Hash (${FINGERPRINT})`, manual: false });
      try {
        const r = await runHash({ kind: 'path', path: c.path, analyzer: `hash-${FINGERPRINT}` }, { recordId: c.record.id, name: c.name, total: c.total }) as { unit: Unit; outputs: Record<string, unknown> };
        const current = store.state.records.get(c.record.id);
        if (!current) continue;
        const placed = withHashes(r.outputs, r.unit, manifestKey ? current.data[manifestKey] : undefined);
        const { data, skipped } = mappedData(placed, map, fields);
        if (Object.keys(data).length) store.mutate({ type: 'record.update', id: c.record.id, set: data, unset: [] }, { via: 'file_drop', undoable: false });
        for (const sk of skipped) notice(`${c.name}: not written — ${sk}`, 'warn');
        if (!Object.keys(data).length) { failedFingerprints.add(c.record.id); fingerprintRun.failed++; notice(`${c.name}: fingerprinted, but the table has nowhere to keep it`, 'warn'); }
      } catch (e) {
        const msg = String(e);
        if (/cancelled/.test(msg)) break;   // the person stopped the run: leave the rest for next time
        failedFingerprints.add(c.record.id); fingerprintRun.failed++;
        notice(`${c.name}: no fingerprint — ${msg}`, 'warn', [{ id: c.record.id, label: c.name }]);
      } finally {
        jobs.delete(c.record.id);
        fingerprintRun.done++;
      }
    }
  } finally {
    fingerprintRun.active = false;
  }
}
