/**
 * Hash jobs: ONE at a time, with progress, cancellable.
 *
 * Every hash the desktop runs goes through here, and every one is asked for BY
 * HAND — an md5, xxh3 or sha256 from a record (the owner, Nov 23: nothing hashes
 * on its own; a drop reads no file). One line, so that two reads of 100 GB files
 * never thrash the same NAS at once, and so that one strip in the sidebar footer
 * (HashStrip.vue) can show all of it.
 *
 * The shell (src-tauri/src/lib.rs) does the reading: `analyze` / `analyze_path`
 * with a `job` id emit `hash-progress` events under it, and `hash_cancel(job)`
 * stops one between two chunks. Here is only the line, the bookkeeping, and the
 * list a footer draws. Nothing persists: a hash that did not finish was not
 * written, and is asked for again from the record.
 */

import { reactive } from 'vue';
import { invoke, isDesktop, listenEvent } from '../desktop';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface HashJob {
  id: number;
  /** The record the hash is for — the footer's open pill; null for a bare compare. */
  recordId: string | null;
  /** What to call it in the strip: the file's name. */
  name: string;
  /** "Hash (xxh3)", "Hash (md5)". */
  label: string;
  state: JobState;
  done: number;
  total: number;
  error?: string;
  priority: boolean;
}

/** Everything queued, running, or finished this session (finished ones trimmed to the last few). */
export const hashJobs = reactive<HashJob[]>([]);
const KEEP_FINISHED = 6;

type Request =
  | { kind: 'unit'; unit: unknown; analyzer: string }
  /** `expect`: the size / date / file count the record holds — the shell refuses before reading when the file no longer has them. */
  | { kind: 'path'; path: string; analyzer: string; expect?: { files: number | null; bytes: number; modified: number | null } };

interface Pending { job: HashJob; req: Request; resolve: (v: unknown) => void; reject: (e: unknown) => void }
const line: Pending[] = [];
let running: Pending | null = null;
let nextId = 1;
let listening = false;

function listen() {
  if (listening || !isDesktop()) return;
  listening = true;
  void listenEvent<{ job: number; done: number; total: number }>('hash-progress', (p) => {
    const j = hashJobs.find((x) => x.id === p.job);
    if (j && j.state === 'running') { j.done = p.done; if (p.total) j.total = p.total; }
  });
}

/**
 * Queue a hash and get its outputs (`{ hash }` or `{ member_hashes }`, as the
 * shell's `analyze` returns them). `total` is the bytes to read, for the bar
 * before the first progress event arrives.
 */
export function runHash(req: Request, meta: { recordId: string | null; name: string; total: number; priority?: boolean }): Promise<Record<string, unknown>> {
  listen();
  const raw: HashJob = { id: nextId++, recordId: meta.recordId, name: meta.name, label: `Hash (${req.analyzer.replace('hash-', '')})`,
                         state: 'queued', done: 0, total: meta.total, priority: !!meta.priority };
  hashJobs.push(raw);
  // The REACTIVE object, not the raw one: the line sets `state` on it as the job
  // runs, and a write to the raw object would never reach the footer strip — it
  // would go on showing a finished hash as running.
  const job = hashJobs[hashJobs.length - 1];
  return new Promise((resolve, reject) => {
    const p: Pending = { job, req, resolve: resolve as (v: unknown) => void, reject };
    if (job.priority) line.unshift(p); else line.push(p);
    void pump();
  });
}

/** Cancel a job: queued → dropped from the line; running → the shell stops it. */
export async function cancelHash(id: number) {
  const i = line.findIndex((p) => p.job.id === id);
  if (i >= 0) {
    const [p] = line.splice(i, 1);
    p.job.state = 'cancelled';
    p.reject(new Error('cancelled'));
    trim();
    return;
  }
  if (running?.job.id === id) { try { await invoke('hash_cancel', { job: id }); } catch { /* finished meanwhile */ } }
}

/** Cancel everything queued (the running one finishes or is cancelled too when `all`). */
export async function cancelAllHashes() {
  for (const p of line.splice(0)) { p.job.state = 'cancelled'; p.reject(new Error('cancelled')); }
  if (running) await cancelHash(running.job.id);
  trim();
}

function trim() {
  const finished = hashJobs.filter((j) => j.state === 'done' || j.state === 'failed' || j.state === 'cancelled');
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) hashJobs.splice(hashJobs.indexOf(j), 1);
}

async function pump() {
  if (running) return;
  const p = line.shift();
  if (!p) return;
  running = p;
  p.job.state = 'running';
  try {
    const r = p.req.kind === 'unit'
      ? await invoke<{ outputs: Record<string, unknown> }>('analyze', { unit: p.req.unit, analyzer: p.req.analyzer, job: p.job.id })
      : await invoke<{ unit: unknown; outputs: Record<string, unknown> }>('analyze_path', { path: p.req.path, analyzer: p.req.analyzer, job: p.job.id, ...(p.req.expect ? { expect: p.req.expect } : {}) });
    p.job.state = 'done'; p.job.done = p.job.total;
    p.resolve(r);
  } catch (e) {
    const msg = String(e);
    p.job.state = /cancelled/.test(msg) ? 'cancelled' : 'failed';
    if (p.job.state === 'failed') p.job.error = msg;
    p.reject(e);
  } finally {
    running = null;
    trim();
    void pump();
  }
}

/** The one running now, for the strip's headline. */
export const runningHash = () => running?.job ?? null;
/** How many are waiting behind it. */
export const queuedHashes = () => line.length;
/** Forget the finished entries (the strip's "clear"). */
export function clearFinishedHashes() {
  for (const j of [...hashJobs]) if (j.state === 'done' || j.state === 'failed' || j.state === 'cancelled') hashJobs.splice(hashJobs.indexOf(j), 1);
}
