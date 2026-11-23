<!--
  The hash strip, in the sidebar footer — the owner's home for things about the
  WHOLE app, and outside the content area, so nothing on the canvas or in the grid
  moves when it appears. Desktop app only; nothing at all in a browser.

    idle       (not drawn)
    hashing    a thin bar, "Hash (md5) · S01E01.mov 41%"
               click → the list: each job and its state, × to cancel, Clear for
               what is done

  Nothing here starts a hash. Every one is asked for by hand from a record (▶ on
  its Manifest) — the owner, Nov 23: reading a large file off the NAS is ten
  minutes, so the app never does it on its own. This is only where the reading
  shows, since the person has usually moved on to another record by then.
-->
<template>
  <div v-if="desktop && hashing" class="fp" :class="{ open }">
    <button class="fp-head" title="What the hash line is doing — click for the list" @click="open = !open">
      <span class="fp-bar"><span class="fp-fill" :style="{ width: pct + '%' }" /></span>
      <span class="fp-text">{{ headline }}</span>
    </button>
    <div v-if="open && hashJobs.length" class="fp-list">
      <div v-for="j in listed" :key="j.id" class="fp-job" :class="j.state">
        <span class="fp-name" :title="j.error ?? j.name">{{ j.name }}</span>
        <span class="fp-state">{{ stateOf(j) }}</span>
        <button v-if="j.state === 'queued' || j.state === 'running'" class="fp-x" title="Cancel" @click="cancelHash(j.id)">×</button>
      </div>
      <div class="fp-foot">
        <button class="fp-small" @click="cancelAllHashes()">Cancel all</button>
        <button v-if="hashJobs.some((j) => j.state === 'done' || j.state === 'failed' || j.state === 'cancelled')" class="fp-small" @click="clearFinishedHashes()">Clear</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { isDesktop } from '../desktop';
import { cancelAllHashes, cancelHash, clearFinishedHashes, hashJobs, type HashJob } from '../tools/hashJobs';
import { formatBytes } from '../../contract/shapes';

const desktop = isDesktop();
const open = ref(false);

const live = computed(() => hashJobs.filter((j) => j.state === 'queued' || j.state === 'running'));
/** The running one first, then the line, then what finished (newest last). */
const order: Record<HashJob['state'], number> = { running: 0, queued: 1, failed: 2, cancelled: 3, done: 4 };
const listed = computed(() => [...hashJobs].sort((a, b) => order[a.state] - order[b.state] || a.id - b.id));
const hashing = computed(() => live.value.length > 0);
const running = computed(() => hashJobs.find((j) => j.state === 'running') ?? null);
const pct = computed(() => { const j = running.value; return j && j.total > 0 ? Math.min(100, Math.round((j.done / j.total) * 100)) : 0; });
const headline = computed(() => {
  const j = running.value;
  const n = live.value.length;
  const file = j ? `${j.name}${j.total > 0 ? ` ${pct.value}%` : ''}` : 'waiting…';
  return `${j?.label ?? 'Hashing'}${n > 1 ? ` (${n})` : ''} · ${file}`;
});
const stateOf = (j: HashJob) => j.state === 'running' ? `${j.total ? `${formatBytes(j.done)} of ${formatBytes(j.total)}` : 'reading…'}` : j.state === 'queued' ? 'queued' : j.state === 'done' ? 'done' : j.state === 'cancelled' ? 'cancelled' : 'failed';
</script>

<style scoped>
.fp { border-top: 1px solid var(--border-main); font-size: 11px; }
.fp-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 10px; background: none; border: none; color: var(--text-muted); font: inherit; text-align: left; cursor: pointer; }
.fp-head:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
.fp-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-bar { flex: none; width: 34px; height: 4px; border-radius: 2px; background: var(--border-main); overflow: hidden; }
.fp-fill { display: block; height: 100%; background: var(--accent); transition: width 0.25s linear; }
.fp-list { padding: 2px 10px 6px; border-top: 1px dashed var(--border-main); max-height: 160px; overflow-y: auto; }
.fp-job { display: flex; align-items: center; gap: 6px; padding: 1px 0; color: var(--text-muted); }
.fp-job.running { color: var(--text-primary); }
.fp-job.failed { color: var(--warning); }
.fp-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-state { flex: none; font-variant-numeric: tabular-nums; }
.fp-x { flex: none; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; }
.fp-x:hover { color: var(--danger); }
.fp-foot { display: flex; gap: 6px; padding-top: 4px; }
.fp-small { font: inherit; font-size: 10px; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--border-main); background: var(--controls-bg); color: var(--text-muted); cursor: pointer; }
.fp-small:hover { color: var(--text-primary); }
</style>
