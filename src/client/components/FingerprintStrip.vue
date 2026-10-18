<!--
  The fingerprint strip, in the sidebar footer — the owner's home for things about
  the WHOLE app, and outside the content area, so nothing on the canvas or in the
  grid moves when it appears. Desktop app only; nothing at all in a browser.

    idle, nothing missing     (not drawn)
    idle, N missing           "12 files have no fingerprint"  [Run]
    hashing                   a thin bar, "Fingerprinting 3 / 12 · S01E01.mov 41%"
                              click → the list: each job and its state, × to cancel,
                              Retry for what failed, Clear for what is done

  The headline is ONE line whether a drop's fingerprint, a compare, or a manual
  md5 is what is running: every hash goes through the same line (hashJobs.ts).
-->
<template>
  <div v-if="desktop && (hashing || missing.length || failedFingerprints.size)" class="fp" :class="{ open }">
    <button class="fp-head" :title="hashing ? 'What the hash line is doing — click for the list' : 'Records with a file and no fingerprint yet'" @click="open = !open">
      <template v-if="hashing">
        <span class="fp-bar"><span class="fp-fill" :style="{ width: pct + '%' }" /></span>
        <span class="fp-text">{{ headline }}</span>
      </template>
      <template v-else-if="missing.length">
        <span class="fp-text">{{ missing.length }} file{{ missing.length === 1 ? ' has' : 's have' }} no fingerprint</span>
        <span class="fp-run" role="button" title="Read each file once (xxh3) and keep its fingerprint in the record — one native dialog asks first" @click.stop="run">Run</span>
      </template>
      <template v-else>
        <span class="fp-text">{{ failedFingerprints.size }} could not be fingerprinted</span>
        <span class="fp-run" role="button" title="Put them back in the count and try again" @click.stop="retry">Retry</span>
      </template>
    </button>
    <div v-if="open && (hashJobs.length || failedFingerprints.size)" class="fp-list">
      <div v-for="j in listed" :key="j.id" class="fp-job" :class="j.state">
        <span class="fp-name" :title="j.error ?? j.name">{{ j.name }}</span>
        <span class="fp-state">{{ stateOf(j) }}</span>
        <button v-if="j.state === 'queued' || j.state === 'running'" class="fp-x" title="Cancel" @click="cancelHash(j.id)">×</button>
      </div>
      <div class="fp-foot">
        <button v-if="hashing" class="fp-small" @click="cancelAllHashes()">Cancel all</button>
        <button v-if="hashJobs.some((j) => j.state === 'done' || j.state === 'failed' || j.state === 'cancelled')" class="fp-small" @click="clearFinishedHashes()">Clear</button>
        <button v-if="failedFingerprints.size" class="fp-small" @click="retry">Retry {{ failedFingerprints.size }} failed</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import { isDesktop } from '../desktop';
import { cancelAllHashes, cancelHash, clearFinishedHashes, hashJobs, type HashJob } from '../tools/hashJobs';
import { failedFingerprints, fingerprintRun, missingFingerprints, runFingerprints } from '../tools/fingerprints';
import { formatBytes } from '../../contract/shapes';

const props = defineProps<{ store: Store }>();
const desktop = isDesktop();
const open = ref(false);

const missing = computed(() => (desktop ? missingFingerprints(props.store) : []));
const live = computed(() => hashJobs.filter((j) => j.state === 'queued' || j.state === 'running'));
/** The running one first, then the line, then what finished (newest last). */
const order: Record<HashJob['state'], number> = { running: 0, queued: 1, failed: 2, cancelled: 3, done: 4 };
const listed = computed(() => [...hashJobs].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id));
const hashing = computed(() => live.value.length > 0 || fingerprintRun.active);
const running = computed(() => hashJobs.find((j) => j.state === 'running') ?? null);
const pct = computed(() => { const j = running.value; return j && j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0; });
const headline = computed(() => {
  const j = running.value;
  const n = live.value.length;
  const file = j ? `${j.name}${j.total > 0 ? ` ${pct.value}%` : ''}` : 'waiting…';
  if (fingerprintRun.active) return `Fingerprinting ${Math.min(fingerprintRun.done + 1, fingerprintRun.total)} / ${fingerprintRun.total} · ${file}`;
  return `${j?.label ?? 'Hashing'}${n > 1 ? ` (${n})` : ''} · ${file}`;
});
const stateOf = (j: HashJob) => j.state === 'running' ? `${j.total ? `${formatBytes(j.done)} of ${formatBytes(j.total)}` : 'reading…'}` : j.state === 'queued' ? 'queued' : j.state === 'done' ? 'done' : j.state === 'cancelled' ? 'cancelled' : 'failed';

function run() { void runFingerprints(props.store, missing.value); }
function retry() { failedFingerprints.clear(); }
</script>

<style scoped>
.fp { border-top: 1px solid var(--border-main); font-size: 11px; }
.fp-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 10px; background: none; border: none; color: var(--text-muted); font: inherit; text-align: left; cursor: pointer; }
.fp-head:hover { background: var(--bg-surface-hover); color: var(--text-main); }
.fp-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-bar { flex: none; width: 34px; height: 4px; border-radius: 2px; background: var(--border-main); overflow: hidden; }
.fp-fill { display: block; height: 100%; background: var(--accent); transition: width 0.25s linear; }
.fp-run { flex: none; padding: 1px 8px; border-radius: 9px; border: 1px solid var(--accent); color: var(--accent); }
.fp-run:hover { background: var(--accent); color: #fff; }
.fp-list { padding: 2px 10px 6px; border-top: 1px dashed var(--border-main); max-height: 160px; overflow-y: auto; }
.fp-job { display: flex; align-items: center; gap: 6px; padding: 1px 0; color: var(--text-muted); }
.fp-job.running { color: var(--text-main); }
.fp-job.failed { color: var(--warning); }
.fp-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-state { flex: none; font-variant-numeric: tabular-nums; }
.fp-x { flex: none; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; }
.fp-x:hover { color: var(--danger); }
.fp-foot { display: flex; gap: 6px; padding-top: 4px; }
.fp-small { font: inherit; font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border-main); background: var(--controls-bg); color: var(--text-muted); cursor: pointer; }
.fp-small:hover { color: var(--text-main); }
</style>
