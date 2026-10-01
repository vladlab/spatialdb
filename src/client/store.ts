/**
 * ============================================================================
 *  The client store. Phase 1's checkpoint.
 * ============================================================================
 *
 *  The whole write path, in order:
 *
 *    1. the client generates the UUID and applies the mutation to local state
 *       IMMEDIATELY — the UI never waits on the network
 *    2. the mutation goes onto a pending queue with an idempotency key
 *    3. the queue flushes on a ~100ms debounce to POST /api/mutate
 *    4. on a failure that may pass (5xx, the network), the batch goes back on the
 *       queue and is retried; the idempotency keys make that safe
 *    5. on a REFUSAL (4xx), the one action the server refused is given up — not
 *       the whole batch — the rest is sent again, and the screen is reloaded from
 *       the server so it stops showing what was never saved (`rejected`, `resync`)
 *
 *  And the read path is the same apply function, fed from the stream. That
 *  symmetry is the thing being proved here. Once it holds, an offline queue is
 *  this array persisted to disk and drained on reconnect — additive, not a
 *  rewrite.
 *
 *  ── TWO SUBTLETIES WORTH THE COMMENT ──────────────────────────────────────
 *
 *  A. THE STREAM WATERMARK NEVER COMES FROM THE MUTATE RESPONSE.
 *
 *  API.md used to say "on success, record `seq`", and that advice is wrong in a
 *  way that only bites when it matters. `seq` in a mutate response is the log
 *  head after your batch — which can be HIGHER than events you have not yet
 *  received. If your batch takes seqs 10 and 12 while another client takes 11,
 *  the response says 12. Adopt that as your watermark while your stream happens
 *  to be down, and you reconnect with `?since=12` and never see 11.
 *
 *  So: the watermark advances ONLY from stream events, which arrive in seq
 *  order, and from snapshot reads that report their own position. The response
 *  `seq` is diagnostic only — `serverHead` below, shown in the UI, used for
 *  nothing.
 *
 *  B. TAKE THE WATERMARK BEFORE FETCHING, NOT AFTER.
 *
 *  Hydration reads the log head FIRST, then fetches data. That deliberately
 *  produces an OVERLAP: catch-up will replay events already reflected in the
 *  fetched rows. Overlap is free, because apply is idempotent. Reading the head
 *  afterwards would instead risk a GAP, and a gap is silent, permanent
 *  divergence. When a self-dating snapshot is available (`scene.seq`, taken
 *  inside the same transaction as the data) neither happens and we use that
 *  instead.
 */

import { reactive, ref, computed } from 'vue';
import type { Mutation } from '../contract/mutations.js';
import { StreamEvent } from '../contract/events.js';
import {
  applyMutation, clearState, emptyState, ingestCanvases, ingestPage,
  ingestSchema, ingestScene, linkKey, touchedBy, type RecordRow, type SectionRow, type State,
} from './state.js';

/** A server's answer to a batch it did not apply (server/failures.ts). */
interface Refusal { error?: string; detail?: unknown; failed?: string }

import { inverseOf, type Inverse } from './history.js';

/** The signed-in user, as the server describes them. */
export interface Me { id: string; email: string; name: string; role: 'admin' | 'editor' | 'viewer' }

export interface AssetMeta {
  id: string; sha256: string; mime: string; bytes: number;
  width: number | null; height: number | null; name: string;
}

export interface TableLoad { state: 'loading' | 'loaded' | 'failed'; rows: number }

/** Contract cap is 500 per request; stay under it. */
const MAX_BATCH = 400;
const FLUSH_DEBOUNCE_MS = 100;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 10_000;

export interface PendingEntry {
  id: string;
  mutation: Mutation;
  /** Provenance tag for the batch this rides in (MutationRequest.via). Not sent per entry. */
  via?: string;
  /**
   * Which ACTION this belongs to: everything mutated in one synchronous run shares a
   * number — a card made and placed, 45 dropped files, a pair row and its two links.
   * It is the unit the server's all-or-nothing batch exists to protect, so it is the
   * unit given up when the server refuses one of its mutations. Not sent.
   */
  run: number;
}

export interface MutateOptions {
  /** The tool writing this (contract/tools.ts `Via`). Batches carry ONE tag, so a
   *  flush stops where the tag changes rather than mixing tool writes with hand edits. */
  via?: string;
  /**
   * False for a tool's FOLLOW-UP writes: the ffprobe facts and the hash that arrive
   * after a file drop. They must not become Ctrl+Z steps of their own, or undoing
   * the drop would first peel off the last probe result. Ctrl+Z on the drop itself
   * deletes the records it created, probe results and all. Default true.
   */
  undoable?: boolean;
}

export type StreamState = 'offline' | 'connecting' | 'connected' | 'reconnecting' | 'resyncing';

export interface StoreOptions {
  baseUrl?: string;
  clientId?: string;
  /** Injectable so tests can drive time; defaults to real timers. */
  debounceMs?: number;
}

export function createStore(opts: StoreOptions = {}) {
  const baseUrl = opts.baseUrl ?? '';
  const clientId = opts.clientId ?? crypto.randomUUID();
  const debounceMs = opts.debounceMs ?? FLUSH_DEBOUNCE_MS;

  const state = reactive(emptyState()) as State;

  /** Highest seq applied from the stream. The `?since=` value on reconnect. */
  const lastSeq = ref(0);
  /** Log head as last reported by a mutate response. Diagnostic only — see (A). */
  const serverHead = ref(0);

  const pending = ref<PendingEntry[]>([]);
  const inflight = ref<PendingEntry[]>([]);
  const streamState = ref<StreamState>('offline');
  const errors = ref<string[]>([]);
  const eventLog = ref<string[]>([]);

  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = RETRY_BASE_MS;
  let streamAbort: AbortController | undefined;
  let stopped = false;
  let resyncing: Promise<void> | undefined;
  /**
   * True while a disconnect we asked for is in flight (resync, or a test/dev
   * reconnect). Without it, deliberate aborts land in `errors` alongside real
   * faults — and an error log that cries wolf is worth nothing, which is exactly
   * what it is for here: it is the signal that the three guards are holding.
   */
  let intentionalAbort = false;

  /**
   * Ids referenced by not-yet-confirmed mutations. The UI fades these so it is
   * visible which rows the server has not acknowledged. Derived rather than
   * stored as a flag on the row, so a confirmation cannot leave a stale mark
   * behind on a row that was meanwhile deleted.
   */
  const unconfirmed = computed(() => {
    const ids = new Set<string>();
    for (const entry of [...inflight.value, ...pending.value]) {
      const m = entry.mutation as any;
      if (typeof m.id === 'string') ids.add(m.id);
      if (typeof m.recordId === 'string') ids.add(m.recordId);
      if (Array.isArray(m.moves)) for (const mv of m.moves) ids.add(mv.recordId);
    }
    return ids;
  });

  function note(line: string) {
    eventLog.value.unshift(line);
    if (eventLog.value.length > 80) eventLog.value.length = 80;
  }

  function fail(line: string) {
    errors.value.unshift(line);
    if (errors.value.length > 40) errors.value.length = 40;
  }

  /**
   * ONE banner line for a failing flush, rewritten on each retry — not a new line
   * per attempt. A server that answers 500 to the same batch seven times is one
   * problem, and seven stacked lines bury whatever else the banner has to say.
   * Cleared when a flush finally succeeds.
   */
  let retryLine = '';
  function failRetrying(attempt: number, delayMs: number, why: string) {
    const line = `Saving is failing (attempt ${attempt}, next try in ${Math.round(delayMs / 100) / 10}s) — `
      + `${pending.value.length} change(s) are queued, not lost: ${why}`;
    const i = retryLine ? errors.value.indexOf(retryLine) : -1;
    if (i === -1) errors.value.unshift(line); else errors.value.splice(i, 1, line);
    retryLine = line;
  }
  function clearRetrying() {
    const i = retryLine ? errors.value.indexOf(retryLine) : -1;
    if (i !== -1) errors.value.splice(i, 1);
    retryLine = '';
    attempts = 0;
  }
  let attempts = 0;

  /* ── writes ──────────────────────────────────────────────────────────────*/

  /**
   * The only way to write. Applies locally first, then queues.
   *
   * Note the order: local apply happens before the queue push, and neither waits
   * on the network. If the flush ultimately fails we retry rather than roll back
   * — last-write-wins throughout, and an idempotency key makes retrying free.
   */
  /** Bumped by every local mutation; lets an async read notice it has been overtaken. */
  let localChanges = 0;
  /**
   * Your own mutations that the STREAM has not yet confirmed, oldest first — from the
   * moment they are applied optimistically until their echo comes back. Independent
   * of `pending`/`inflight`, which track the HTTP request, not the log.
   *
   * It exists for one job: REBASING. Every event from the stream is applied in log
   * order, and then everything in this list is re-applied on top — because each of
   * them will land in the log AFTER the event just applied, so on the server they
   * win. Without this, a colleague's write that committed just before yours but
   * reached you just after would overwrite your value on screen; your own echo —
   * the one event that would have put it right — used to be skipped, and you looked
   * at THEIR value, over a database holding YOURS, until you reloaded.
   * (test/store.ts B8. Every mutation is idempotent by design, which is what makes
   * re-applying safe.)
   */
  const unechoed: Array<{ id: string; mutation: Mutation }> = [];
  const forget = (ids: Iterable<string>) => {
    const gone = new Set(ids);
    for (let i = unechoed.length - 1; i >= 0; i--) if (gone.has(unechoed[i].id)) unechoed.splice(i, 1);
  };

  /** The current action's number — see PendingEntry.run. Closes on a microtask, like an undo step. */
  let runNo = 0, runOpen = false;
  function currentRun(): number {
    if (!runOpen) {
      runNo++;
      runOpen = true;
      queueMicrotask(() => { runOpen = false; });
    }
    return runNo;
  }

  function mutate(mutation: Mutation, options: MutateOptions = {}) {
    localChanges++;
    const id = crypto.randomUUID();
    const run = currentRun();
    // BEFORE applying: the inverse is read off the state this is about to change.
    if (mutation.type !== 'restore' && options.undoable !== false) record(inverseOf(state, mutation, id));
    // A new record's SYSTEM FIELDS, as this client knows them: created now, by whoever
    // is signed in. Put on the mutation itself (not in the pure apply, which must give
    // the same state however many times it runs); the server strips these keys.
    if (mutation.type === 'record.create') {
      const d = mutation.data as Record<string, unknown>;
      if (d._created_at === undefined) d._created_at = new Date().toISOString();
      if (d._created_by === undefined) d._created_by = me.value?.name ?? me.value?.email ?? '';
    }
    applyMutation(state, mutation);
    touch(mutation, Infinity);   // see loadTable: a page must not revert this
    pending.value.push(options.via ? { id, mutation, run, via: options.via } : { id, mutation, run });
    unechoed.push({ id, mutation });
    if (unechoed.length > 5000) unechoed.splice(0, unechoed.length - 5000);   // a stream that never echoes must not become a leak
    scheduleFlush();
  }

  /* ── Ctrl+Z ──────────────────────────────────────────────────────────────

     See history.ts for what an inverse is. This is the bookkeeping: inverses are
     grouped into STEPS, and a step is everything mutated in one synchronous run.
     Creating a card is a record.create plus a placement.add; dragging six cards
     is one placement.move; "make primary" is several field.updates. Each of those
     is one thing to the person, so each is one Ctrl+Z. The group closes on a
     microtask — i.e. as soon as the handler that made the changes returns.

     While an undo is being applied the inverses IT generates go to the redo
     stack instead (and vice versa), which is all redo is. Any fresh change clears
     redo: there is no branching history here. */

  type Step = Inverse[];
  const undoStack: Step[] = [], redoStack: Step[] = [];
  /** The action (PendingEntry.run) each step was recorded in — so a refused action leaves no Ctrl+Z behind. */
  const stepRun = new WeakMap<Step, number>();
  function dropSteps(runs: ReadonlySet<number>) {
    for (const stack of [undoStack, redoStack]) {
      for (let i = stack.length - 1; i >= 0; i--) if (runs.has(stepRun.get(stack[i]) ?? -1)) stack.splice(i, 1);
    }
    sync();
  }
  const canUndo = ref(false), canRedo = ref(false);
  let open: Step | null = null;
  let mode: 'do' | 'undo' | 'redo' = 'do';
  const HISTORY_MAX = 200;

  function record(inv: Inverse | null) {
    if (!inv) return;
    if (!open) {
      const step: Step = open = [];
      stepRun.set(step, currentRun());
      const target = mode === 'undo' ? redoStack : undoStack;
      if (mode === 'do') redoStack.length = 0;
      target.push(step);
      if (target.length > HISTORY_MAX) target.shift();
      queueMicrotask(() => { if (open === step) open = null; sync(); });
    }
    open.push(inv);
    sync();
  }
  function sync() { canUndo.value = undoStack.length > 0; canRedo.value = redoStack.length > 0; }

  async function replay(from: Step[], as: 'undo' | 'redo'): Promise<boolean> {
    const step = from.pop();
    sync();
    if (!step) return false;
    open = null;
    mode = as;
    try {
      // Newest first: a step's changes are unwound in the reverse of the order
      // they were made (unplace-then-delete is restored delete-then-place).
      for (const inv of [...step].reverse()) {
        if (inv.kind === 'mutations') {
          for (const m of inv.mutations) mutate(m);
        } else {
          // A delete. The server restores it — but only once it HAS the delete.
          await settled();
          await undo(inv.ofMutationId);
        }
      }
      return true;
    } catch {
      return false;          // `undo` already put the reason in the banner
    } finally {
      mode = 'do';
      open = null;
      sync();
    }
  }
  const undoLast = () => replay(undoStack, 'undo');
  const redoLast = () => replay(redoStack, 'redo');

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void flush(), debounceMs);
  }

  async function flush(): Promise<void> {
    // One request at a time. Concurrent flushes would let a later batch commit
    // before an earlier one, and the mutation log is the audit trail — its order
    // should reflect what actually happened.
    if (inflight.value.length || !pending.value.length) return;

    // A batch carries one `via`: take entries up to the first change of tag.
    const via = pending.value[0].via;
    let n = 0;
    while (n < pending.value.length && n < MAX_BATCH && pending.value[n].via === via) n++;
    const batch = pending.value.splice(0, n);
    inflight.value = batch;

    try {
      const res = await fetch(`${baseUrl}/api/mutate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Entries are sent as { id, mutation } only: the envelope is strict, and the
        // tag belongs to the request, not to each mutation.
        body: JSON.stringify({ clientId, ...(via ? { via } : {}), mutations: batch.map(({ id, mutation }) => ({ id, mutation })) }),
      });

      if (!res.ok) {
        const text = await res.text();
        let body: Refusal = {};
        try { body = JSON.parse(text) as Refusal; } catch { /* not JSON: a proxy's error page */ }
        // 4xx means the server rejected the CONTENT. Retrying cannot help and
        // would spin forever, so the refused action is given up, loudly — see
        // `rejected`. 5xx and network faults are transient and go back on the queue.
        // …EXCEPT 401. "You are not signed in" says nothing about the content: the
        // session expired, or was revoked, while edits were waiting. Dropping them
        // would silently lose work to a login timeout. They go back on the queue,
        // the login screen comes up, and signing in sends them.
        if (res.status === 401) {
          pending.value.unshift(...batch);
          inflight.value = [];
          signedOut();
          return;
        }
        if (res.status >= 400 && res.status < 500) { rejected(batch, res.status, body, text); return; }
        // A 500 that NAMES a mutation is the server's own code failing on it (a
        // TypeError in apply, a query that cannot run). That is not going to pass:
        // the third identical failure in a row is treated as a refusal, so one
        // mutation that crashes the server cannot hold every later edit hostage.
        // (A database that is down answers 503 and names nothing — retried forever,
        // as it should be.)
        if (res.status === 500 && typeof body.failed === 'string') {
          crash = crash.id === body.failed ? { id: crash.id, n: crash.n + 1 } : { id: body.failed, n: 1 };
          if (crash.n >= CRASH_LIMIT) { rejected(batch, res.status, body, text); return; }
        }
        throw new Error(`${res.status} ${text.slice(0, 400)}`);
      }

      const out = await res.json();
      serverHead.value = Number(out.seq) || serverHead.value;   // diagnostic only — see (A)
      inflight.value = [];
      retryDelay = RETRY_BASE_MS;
      crash = { id: '', n: 0 };
      clearRetrying();
      note(`flushed ${out.applied.length} applied, ${out.skipped.length} skipped`);

      if (pending.value.length) scheduleFlush();
    } catch (e) {
      // Back on the front of the queue, in order. Replay is safe: each entry
      // still carries the same idempotency key, so anything the server did
      // manage to commit will come back as `skipped`.
      pending.value.unshift(...inflight.value);
      inflight.value = [];
      failRetrying(++attempts, retryDelay, readable(e));
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      flushTimer = setTimeout(() => void flush(), delay);
    }
  }

  /** Consecutive 500s that named the same mutation. */
  let crash = { id: '', n: 0 };
  const CRASH_LIMIT = 3;

  /**
   * The server REFUSED this batch, and will refuse it every time.
   *
   * A batch is all-or-nothing on the server, so nothing in it was applied. What is
   * given up here is not the batch, though — it is the one ACTION the refused
   * mutation belongs to (`run`): the rest were only its neighbours in a 100 ms
   * window, or in a backlog after the network came back, and go straight back on
   * the queue. It used to be the whole batch: one edit to a record a colleague had
   * just deleted took up to 399 unrelated changes with it.
   *
   * And the SCREEN is put right. Every one of these mutations was applied locally
   * the moment it was made; dropping them from the queue left them on screen —
   * a record that was typed, visible, and not in the database, until a reload.
   * `resync` reloads what this client holds from the server and puts the unsent
   * changes back on top, so what is shown is what is saved plus what is still
   * being saved, and nothing else.
   *
   * If a kept change DEPENDED on the refused one (an edit to the record whose
   * creation was refused) it is refused in its own turn on the next flush, and
   * goes the same way. Each round gives up at least one action, so it ends.
   */
  function rejected(batch: PendingEntry[], status: number, body: Refusal, text: string) {
    const bad = typeof body.failed === 'string' ? batch.find((q) => q.id === body.failed) : undefined;
    const goes = (q: PendingEntry) => !bad || q.run === bad.run;
    const dropped = batch.filter(goes);
    const kept = batch.filter((q) => !goes(q));
    if (bad) {
      // The rest of the same action may still be waiting BEHIND this batch: a batch
      // ends at 400 entries, and where the tool tag changes.
      dropped.push(...pending.value.filter(goes));
      pending.value = pending.value.filter((q) => !goes(q));
    }
    inflight.value = [];
    pending.value.unshift(...kept);
    forget(dropped.map((q) => q.id));         // refused: they will never be in the log, so never re-apply them
    dropSteps(new Set(dropped.map((q) => q.run)));
    crash = { id: '', n: 0 };
    retryDelay = RETRY_BASE_MS;
    clearRetrying();

    const first = Array.isArray(body.detail) ? body.detail[0] as { path?: unknown[]; message?: string } | undefined : undefined;
    const why = [
      body.error,
      first ? `${(first.path ?? []).join('.')}: ${first.message ?? ''}` : '',
      status >= 500 && typeof body.detail === 'string' ? body.detail : '',
    ].filter(Boolean).join(' — ') || text.slice(0, 200) || `HTTP ${status}`;
    const kinds = [...new Set(dropped.map((q) => q.mutation.type))].join(', ');
    fail(`rejected (${status}) — ${why}. Dropped ${dropped.length} change(s) (${kinds})`
      + (kept.length ? `; ${kept.length} other queued change(s) are being sent again` : '')
      + '. The screen now shows what the server has.');

    void resync();
    if (pending.value.length) scheduleFlush();
  }

  /** `Error: 503 {"error":"…"}` → the sentence inside, when there is one. */
  function readable(e: unknown): string {
    const text = String((e as Error)?.message ?? e);
    const json = text.slice(text.indexOf('{'));
    try {
      const o = JSON.parse(json);
      return [o.error, o.detail].filter(Boolean).join(' — ') || text;
    } catch { return text; }
  }

  /* ── assets ─────────────────────────────────────────────────────────────

     Not a mutation and not queued: the file goes up NOW, and the caller gets an
     id to put in a value. That means it needs the server — an image pasted while
     offline fails here, loudly, rather than being held as a blob in a queue that
     was designed for kilobyte-sized objects. */
  /**
   * Bring in the LINKS among the cards on a canvas — and nothing else.
   *
   * Used after placing a record that came from outside the canvas (palette, docked
   * grid): it arrived without its links, so its arrows would be missing. The first
   * version simply re-ran `loadScene`, and that was a bug: a scene is a snapshot of
   * placements and records too, and ingesting one that was read BEFORE your latest
   * change puts that change back. Drop three cards, press Ctrl+Z at once, and the
   * scene that was already in flight resurrected them. Same family as the stale
   * table page (see ingestPage), in a place it had not been guarded.
   *
   * So: only links are taken — that is all this was ever for — and the whole
   * answer is thrown away if anything changed locally while it was in flight,
   * then asked for again once the queue is quiet.
   */
  async function loadSceneLinks(canvasId: string, attempt = 0): Promise<void> {
    await settled();
    const stamp = localChanges;
    const scene = await get(`/api/canvases/${canvasId}/scene`);
    if (stamp !== localChanges || pending.value.length || inflight.value.length) {
      if (attempt < 3) return loadSceneLinks(canvasId, attempt + 1);
      return;
    }
    for (const l of scene.links ?? []) {
      const key = linkKey(l.field_id, l.from_record, l.to_record);
      if (!state.links.has(key)) state.links.set(key, l);
    }
  }

  /* ── search ─────────────────────────────────────────────────────────────

     The palette's search. A plain read: nothing is ingested, because a hit may be
     in a table this client has never opened and most hits are never chosen. The
     ONE that is chosen gets `adopt`ed — put into local state so a card can render
     it — immediately before the placement that refers to it. */
  async function search(q: string, tableIds: string[] = [], scopeParams = ''): Promise<{ results: Array<{ record: RecordRow; label: string; inScope?: boolean }>; fuzzy: boolean }> {
    return get(`/api/search?q=${encodeURIComponent(q)}&tables=${tableIds.join(',')}&limit=40${scopeParams}`);
  }
  /** Make records known locally WITHOUT overwriting anything already held (it may be newer). */
  function adopt(records: RecordRow[]) {
    for (const r of records) if (!state.records.has(r.id)) state.records.set(r.id, r);
  }

  async function uploadAsset(file: Blob, name = ''): Promise<AssetMeta> {
    const res = await fetch(`${baseUrl}/api/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: file });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const why = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      fail(`upload of ${name || 'file'} failed: ${why}`);
      throw new Error(why);
    }
    const meta = (await res.json()) as AssetMeta;
    assetMeta.set(meta.id, meta);
    return meta;
  }
  const assetUrl = (id: string) => `${baseUrl}/api/assets/${id}`;

  /**
   * Names, types and sizes of assets — NOT part of any value (a value holds ids),
   * so they are fetched on demand and kept. Safe to cache for the life of the tab:
   * an asset's metadata never changes (it is content-addressed).
   */
  const assetMeta = reactive(new Map<string, AssetMeta>());
  const metaAsked = new Set<string>();
  async function ensureAssetMeta(ids: string[]) {
    await Promise.all(ids.filter((id) => !assetMeta.has(id) && !metaAsked.has(id)).map(async (id) => {
      metaAsked.add(id);
      try { assetMeta.set(id, await get(`/api/assets/${id}/meta`)); }
      catch { metaAsked.delete(id); }        // asked again next time; shown as "…" meanwhile
    }));
  }

  /** Await a quiet queue. Tests need it; a "saving…" indicator could use it. */
  async function settled(timeoutMs = 10_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!pending.value.length && !inflight.value.length) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  }

  /* ── reads ───────────────────────────────────────────────────────────────*/

  async function get(path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    if (res.status === 401) signedOut();
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }

  /* ── who you are ─────────────────────────────────────────────────────────
     The server decides (server/auth.ts); this only knows the answer. `auth` is
     what App.vue switches on: the shell, or the login screen.

       unknown   have not asked yet
       in        signed in — `me` is set
       out       not signed in (never were, signed out, or the session ended)
       setup     nobody CAN sign in yet: the first admin is made at a terminal */
  const me = ref<Me | null>(null);
  const auth = ref<'unknown' | 'in' | 'out' | 'setup'>('unknown');
  const authDisabled = ref(false);

  function signedOut() {
    if (auth.value === 'out') return;
    me.value = null;
    auth.value = 'out';
    stop();                       // no stream without a session; pending edits are KEPT
  }

  /** Ask the server who we are. Returns true when signed in. */
  async function whoAmI(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      const body = await res.json().catch(() => ({})) as { user?: Me | null; setup?: boolean; authDisabled?: boolean };
      me.value = body.user ?? null;
      authDisabled.value = body.authDisabled === true;
      auth.value = body.user ? 'in' : body.setup ? 'setup' : 'out';
    } catch { auth.value = 'out'; }
    return auth.value === 'in';
  }

  async function login(email: string, password: string): Promise<string | null> {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = await res.json().catch(() => ({})) as { user?: Me; error?: string };
    if (!res.ok || !body.user) return body.error ?? `could not sign in (${res.status})`;
    me.value = body.user;
    auth.value = 'in';
    return null;
  }

  async function logout() {
    await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' }).catch(() => {});
    signedOut();
  }

  /** JSON in, JSON out, for the account and user-admin endpoints. Returns an error string or the body. */
  async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) signedOut();
    return res.ok ? { ok: true, data: data as T } : { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
  }

  /**
   * Load schema and canvas list, and set the watermark.
   *
   * Head first, then data — see (B). The resulting overlap is absorbed by
   * idempotent apply; the alternative ordering risks a silent gap.
   */
  async function hydrate() {
    const head = Number((await get('/api/head')).seq) || 0;
    ingestSchema(state, await get('/api/schema'));
    ingestCanvases(state, await get('/api/canvases'));
    for (const sec of (await get('/api/sections')) as SectionRow[]) state.sections.set(sec.id, sec);
    lastSeq.value = head;
  }

  /** The tray: records not on a given canvas. A server read — the client only
   *  ever holds a subset of the database, so this cannot be a local filter. */
  async function unplaced(canvasId: string, limit = 100, offset = 0) {
    const page = await get(
      `/api/canvases/${canvasId}/unplaced?limit=${limit}&offset=${offset}`);
    // Deliberately NOT ingested into state: these records are not on the canvas,
    // and putting them in the same map the canvas renders from would mean every
    // tray fetch grew the working set.
    return page as { records: unknown[]; hasMore: boolean };
  }

  /** Labels for records the client has not loaded — the far end of a link. */
  const farLabels = reactive(new Map<string, string>());

  /* ── whole-table loading ─────────────────────────────────────────────────

     The grid sorts and filters on the client (see contract/views.ts for why),
     which only means anything if the client holds the WHOLE table. So a table is
     walked to the end with the keyset cursor, a page at a time.

     `touched` is the staleness guard described above `ingestPage` in state.ts.
     It is only maintained while a walk is in flight — outside one there is no
     page for it to protect against — and cleared when the last walk finishes. */

  const touched = new Map<string, number>();
  let walks = 0;

  function touch(m: Mutation, seq: number) {
    if (!walks) return;
    for (const key of touchedBy(m)) {
      touched.set(key, Math.max(touched.get(key) ?? -1, seq));
    }
  }

  /** Reactive, so the grid can show "loading 12,500…" and know when sort is trustworthy. */
  const tableLoads = reactive(new Map<string, TableLoad>());
  const walking = new Map<string, { load: TableLoad; walk: Promise<void> }>();

  function loadTable(tableId: string, opts: { pageSize?: number; force?: boolean } = {}) {
    if (!opts.force && tableLoads.get(tableId)?.state === 'loaded') return Promise.resolve();
    // One walk per table at a time: the grid and a link picker can both ask for
    // the same table in the same tick.
    // …but only a walk that is still THIS table's load. One whose entry a resync
    // replaced is on its way out (it stops at its next page) — returning it here
    // left the table unloaded for good: the caller awaited a walk that had given up.
    const existing = walking.get(tableId);
    if (existing && tableLoads.get(tableId) === existing.load) return existing.walk;

    const load: TableLoad = reactive({ state: 'loading', rows: 0 });
    tableLoads.set(tableId, load);
    const walk = (async () => {
      const pageSize = opts.pageSize ?? 500;
      // Writes already queued when the walk starts are as unknown to the server
      // as ones made during it, and would be reverted by a page the same way.
      if (!walks) touched.clear();
      walks++;
      for (const q of [...inflight.value, ...pending.value]) {
        for (const key of touchedBy(q.mutation)) touched.set(key, Infinity);
      }
      try {
        let after: string | null = null;
        do {
          const page: any = await get(
            `/api/tables/${tableId}/records?limit=${pageSize}` +
            (after ? `&after=${encodeURIComponent(after)}` : ''));
          // A resync wiped state mid-walk. Ingesting the rest would leave a table
          // marked loaded that is missing its first pages; stop, and let whoever
          // watches tableLoads start again.
          if (tableLoads.get(tableId) !== load) return;
          load.rows += ingestPage(state, page, touched);
          for (const [id, label] of Object.entries(page.labels ?? {})) {
            farLabels.set(id, label as string);
          }
          after = page.nextCursor ?? null;
        } while (after);
        load.state = 'loaded';
      } catch (e) {
        load.state = 'failed';
        fail(`loading table ${tableId}: ${e}`);
      } finally {
        if (walking.get(tableId)?.load === load) walking.delete(tableId);
        if (--walks === 0) touched.clear();
      }
    })();
    walking.set(tableId, { load, walk });
    return walk;
  }

  /**
   * Load a canvas. Uses the scene's own `seq` as the watermark — a consistent
   * snapshot that reports its own log position, so there is neither a gap nor an
   * overlap to reason about. This is the exact path, and phase 2 lives on it.
   */
  /** Canvases whose scene this client holds — what a resync must fetch again. */
  const scenesLoaded = new Set<string>();

  async function loadScene(canvasId: string) {
    // A canvas we created ourselves a moment ago is not on the server yet: its
    // canvas.create is still queued or in flight (writes flush on a debounce).
    // Asking for its scene is a guaranteed 404, and the throw aborted CanvasView's
    // onMounted — so every freshly made canvas silently skipped fitting the view
    // and taking keyboard focus (Space, F, Delete, Ctrl+A dead until you clicked
    // it). No banner; it just half-worked.
    // There is nothing to load: everything on it so far, we put there.
    // (A board is a record now — sql/010 — so "created a moment ago" is an unsent
    // record.create with this id.)
    const unsent = [...pending.value, ...inflight.value]
      .some((q) => q.mutation.type === 'record.create' && q.mutation.id === canvasId);
    if (unsent) return null;
    const scene = await get(`/api/canvases/${canvasId}/scene`);
    ingestScene(state, scene);
    scenesLoaded.add(canvasId);
    lastSeq.value = Math.max(lastSeq.value, Number(scene.seq) || 0);
    return scene;
  }

  /* ── the stream ──────────────────────────────────────────────────────────*/

  /**
   * ONE apply path for live events and replayed history.
   *
   * Guard 1: the watermark — an event at or below it has been applied. Guard 2:
   * every mutation is idempotent, so applying one twice (our own echo; a replay)
   * is harmless. Then the rebase — see `unechoed`.
   */
  function onEvent(event: StreamEvent) {
    if (event.kind === 'resync') {
      note(event.reason === 'ahead-of-head'
        // Normal after a restore from backup: the log head moved backwards, so
        // our watermark describes a future that no longer exists.
        ? `resync: watermark ${event.since} is ahead of head ${event.head} (restored backup?)`
        : `resync: since=${event.since} is too far behind head=${event.head}`);
      void resync();
      return;
    }

    if (event.seq <= lastSeq.value) return;                 // guard 1: already applied

    // Applied in LOG ORDER — our own echoes included. An echo is usually a no-op
    // (we applied it optimistically already), but not when someone else's event
    // arrived in between and overwrote the same value: then the echo is what
    // restores the true, later state. Idempotent either way (guard 2).
    const own = event.clientId === clientId;
    if (own) forget([event.id]);
    try {
      applyMutation(state, event.mutation);
      if (!own) touch(event.mutation, event.seq);
      // …then REBASE: whatever of ours the log has not confirmed yet goes back on top,
      // in order. It will commit after this event, so it must win here too.
      for (const q of unechoed) applyMutation(state, q.mutation);
    } catch (e) {
      // Advance the watermark regardless. A mutation this client cannot apply
      // is a bug to fix, not a reason to wedge the stream re-delivering it
      // forever on every reconnect.
      fail(`apply failed for seq ${event.seq} (${event.type}): ${e}`);
    }
    if (!own) note(`${event.replay ? '[replay] ' : ''}${event.type} seq=${event.seq}`);

    lastSeq.value = event.seq;
  }

  /**
   * Reconnection is managed by hand rather than left to `EventSource`.
   *
   * EventSource retries the URL it was constructed with, so it would reconnect
   * with the ORIGINAL `?since=` forever — replaying the same history on every
   * drop and, once the log outgrows the catch-up limit, triggering a resync loop.
   * The `since` has to be the CURRENT watermark, which means owning the retry.
   *
   * fetch + ReadableStream rather than EventSource also means this same store
   * runs unchanged in Node (which is how it is tested) and in Tauri.
   */
  async function runStream() {
    while (!stopped) {
      // Not while a resync is reading: it takes its watermark first and swaps the
      // state in at the end, and events applied in between would be wiped by the swap.
      if (resyncing) await resyncing;
      if (stopped) break;
      streamState.value = streamState.value === 'offline' ? 'connecting' : 'reconnecting';
      streamAbort = new AbortController();
      try {
        const res = await fetch(`${baseUrl}/api/stream?since=${lastSeq.value}`, {
          signal: streamAbort.signal,
          headers: { Accept: 'text/event-stream' },
        });
        if (res.status === 401) { signedOut(); return; }
        if (!res.ok || !res.body) throw new Error(`stream -> ${res.status}`);

        streamState.value = 'connected';
        retryDelay = RETRY_BASE_MS;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let split: number;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            if (!frame.startsWith('data: ')) continue;   // `: ping` keepalive
            try {
              // Parsed through the contract. An off-contract event fails here,
              // in one place, rather than becoming corrupt state somewhere else.
              onEvent(StreamEvent.parse(JSON.parse(frame.slice(6))));
            } catch (e) {
              fail(`bad stream frame: ${e}`);
            }
          }
        }
      } catch (e) {
        if (stopped) break;
        if (intentionalAbort) note('stream closed on request');
        else fail(`stream dropped: ${e}`);
      }
      intentionalAbort = false;

      if (stopped) break;
      streamState.value = 'reconnecting';
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    }
    streamState.value = 'offline';
  }

  /**
   * Reload what this client holds from the server — because the stream cannot be
   * replayed (too far behind, or ahead of a restored database), or because the
   * server refused something that is still on screen (`rejected`).
   *
   * READ FIRST, THEN SWAP. Everything is fetched while the screen stays exactly as
   * it is, and the old state is replaced by the new in one synchronous step. The
   * first version cleared the state and THEN fetched — and for those few hundred
   * milliseconds the app had no tables and no canvases, which three things acted
   * on: the "keep the pickers pointing at something real" watchers moved you to the
   * first table and the first canvas; the open canvas, which only loads its scene
   * when it is opened, stayed empty; and the record tray lost its record and had no
   * way to ask for it again. A resync was correct and looked like a crash.
   *
   * WHAT IS RELOADED is what was held: the schema, boards and sections; every table
   * that was loaded or loading (so a grid, a link picker, a report and the tray all
   * find their records where they were); every canvas scene that had been opened.
   *
   * THE WATERMARK is the log head, read BEFORE any of the data — rule (B) at the top
   * of this file. The stream is held closed meanwhile (`runStream` waits) and resumes
   * from there; whatever committed during the reads is replayed on top, idempotently.
   *
   * UNSENT WRITES ARE KEPT, in the queue and on the screen: once the fresh state is
   * in, they are applied to it again, exactly as they are after any stream event.
   * Their idempotency keys make it safe if some had already reached the server.
   *
   * If a read fails (the server is away), nothing is swapped: a stale screen is
   * better than an empty one, and the stream's next reconnect will ask again.
   */
  async function resync(): Promise<void> {
    if (resyncing) return resyncing;
    resyncing = (async () => {
      streamState.value = 'resyncing';
      intentionalAbort = true;
      streamAbort?.abort();
      try {
        /* ── read ── */
        const head = Number((await get('/api/head')).seq) || 0;
        const schema = await get('/api/schema') as Array<{ id: string }>;
        const boards = await get('/api/canvases');
        const sections = await get('/api/sections') as SectionRow[];
        const exists = new Set(schema.map((t) => t.id));
        const pagesOf = new Map<string, any[]>();
        for (const tableId of [...tableLoads.keys()]) {
          if (!exists.has(tableId)) continue;                 // the table itself is gone
          const pages: any[] = [];
          let after: string | null = null;
          do {
            const page: any = await get(`/api/tables/${tableId}/records?limit=500` + (after ? `&after=${encodeURIComponent(after)}` : ''));
            pages.push(page);
            after = page.nextCursor ?? null;
          } while (after);
          pagesOf.set(tableId, pages);
        }
        const scenes: any[] = [];
        for (const canvasId of [...scenesLoaded]) {
          const res = await fetch(`${baseUrl}/api/canvases/${canvasId}/scene`);
          if (res.status === 401) { signedOut(); throw new Error('signed out'); }
          if (res.status === 404) { scenesLoaded.delete(canvasId); continue; }   // the board was deleted
          if (!res.ok) throw new Error(`GET scene ${canvasId} -> ${res.status}`);
          scenes.push(await res.json());
        }

        /* ── swap: synchronous from here to the end of the block ── */
        // The snapshot contains everything the server has accepted; only what is
        // still UNSENT remains ours to re-apply.
        const unsent = new Set([...pending.value, ...inflight.value].map((q) => q.id));
        forget(unechoed.filter((q) => !unsent.has(q.id)).map((q) => q.id));
        // Records an unsent change refers to that no table or scene above will bring
        // back — one found by the palette and about to be placed, say. Held over.
        const heldOver: RecordRow[] = [];
        for (const q of unechoed) {
          const m = q.mutation as { id?: string; recordId?: string; fromRecord?: string; toRecord?: string; moves?: Array<{ recordId: string }> };
          for (const id of [m.id, m.recordId, m.fromRecord, m.toRecord, ...(m.moves ?? []).map((mv) => mv.recordId)]) {
            const r = typeof id === 'string' ? state.records.get(id) : undefined;
            if (r) heldOver.push(r);
          }
        }

        clearState(state);
        tableLoads.clear();
        farLabels.clear();
        ingestSchema(state, schema as never);
        ingestCanvases(state, boards);
        for (const sec of sections) state.sections.set(sec.id, sec);
        const none = new Map<string, number>();
        for (const [tableId, pages] of pagesOf) {
          const load: TableLoad = reactive({ state: 'loaded', rows: 0 });
          for (const page of pages) {
            load.rows += ingestPage(state, page, none);
            for (const [id, label] of Object.entries(page.labels ?? {})) farLabels.set(id, label as string);
          }
          // A walk that was in flight for this table sees a load that is not its own
          // and stops (loadTable); this one is complete.
          tableLoads.set(tableId, load);
        }
        for (const scene of scenes) ingestScene(state, scene);
        adopt(heldOver);
        for (const q of unechoed) {
          try { applyMutation(state, q.mutation); } catch { /* it will be refused, or echoed, in its own time */ }
        }
        lastSeq.value = head;
        localChanges++;                   // a read that was in flight across the swap is stale
        note(`resynced, watermark now ${lastSeq.value}`);
      } catch (e) {
        fail(`resync failed: ${e}`);
      } finally {
        resyncing = undefined;
      }
    })();
    return resyncing;
  }

  /* ── undo ───────────────────────────────────────────────────────────────*/

  /** What is there to undo. Read-only; does not touch local state. */
  async function undoable(limit = 50) {
    return get(`/api/undoable?limit=${limit}`) as Promise<Array<{
      seq: number; id: string; type: string; applied_at: string;
      actor_name: string | null; counts: Record<string, number>;
      total: number; truncated: boolean; undone_by: string | null; via?: string | null;
    }>>;
  }

  /**
   * Undo a destructive mutation.
   *
   * Two steps, both through existing surfaces: READ the capture, then WRITE a
   * `restore` mutation like any other write. There is no `POST /api/undo` on
   * purpose — a dedicated endpoint would mutate outside the mutation boundary,
   * and undo would then not stream to peers, not replay on reconnect, and not
   * work offline.
   *
   * Because it goes through `mutate()`, the undo appears on screen instantly,
   * is queued and retried like anything else, and other clients see it arrive.
   */
  async function undo(mutationId: string) {
    const res = await fetch(`${baseUrl}/api/mutations/${mutationId}/undo`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const why = (body as any).error ?? `HTTP ${res.status}`;
      fail(`cannot undo ${mutationId.slice(0, 8)}: ${why}`);
      throw new Error(String(why));
    }
    const capture = await res.json();
    mutate({
      type: 'restore',
      id: crypto.randomUUID(),
      undoOf: mutationId,
      rows: capture.rows,
    });
    note(`undo of ${capture.type} (${capture.total} rows) queued`);
    return capture as { type: string; total: number; counts: Record<string, number> };
  }

  function start() {
    stopped = false;
    void runStream();
    // Edits can be waiting from BEFORE this start: a session that ended mid-work
    // keeps them queued (see the 401 branch in flush) and stops the store; signing
    // in again starts it. Nothing else would send them — a flush is only ever
    // scheduled by a new mutation.
    if (pending.value.length) scheduleFlush();
  }

  function stop() {
    stopped = true;
    clearTimeout(flushTimer);
    streamAbort?.abort();
    streamState.value = 'offline';
  }

  /** Drop the connection without stopping, so a reconnect can be exercised. */
  function dropConnection() {
    intentionalAbort = true;
    streamAbort?.abort();
  }

  return {
    clientId,
    state,
    lastSeq,
    serverHead,
    pending,
    inflight,
    unconfirmed,
    farLabels,
    streamState,
    errors,
    eventLog,

    mutate,
    flush,
    settled,

    hydrate,
    undoLast, redoLast, canUndo, canRedo,
    me, auth, authDisabled, whoAmI, login, logout, call,
    unechoedCount: () => unechoed.length,
    /** Changes made here that the server has not accepted yet — what closing the tab now would lose. */
    unsaved: () => pending.value.length + inflight.value.length,
    uploadAsset, assetUrl, assetMeta, ensureAssetMeta, search, adopt, loadSceneLinks,
    loadTable,
    tableLoads,
    loadScene,
    unplaced,

    undoable,
    undo,

    start,
    stop,
    dropConnection,
    resync,
    onEvent,
  };
}

export type Store = ReturnType<typeof createStore>;
