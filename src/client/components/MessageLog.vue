<!--
  THE LOG (client/log.ts) — opened from the sidebar footer.

  Every notice the app has shown and every error the store has raised, newest
  first, kept per browser across reloads. It exists so that notices can all go
  away by themselves: nothing has to be read in time.

  A line that named records (the file a drop already knew, the record a
  fingerprint failed on) keeps its pills; one opens the record in the tray and
  closes this, when that record is loaded here.
-->
<template>
  <div class="log-backdrop" @mousedown.self="$emit('close')">
    <div ref="box" class="log" role="dialog" aria-modal="true" tabindex="-1" @keydown.stop="onKey">
      <header>
        <h2>Log</h2>
        <label class="only"><input v-model="problemsOnly" type="checkbox" /> warnings and errors only</label>
        <button class="plain copy" :disabled="!shown.length" title="Copy what is listed, as text" @click="copy">{{ copied ? 'copied' : 'copy' }}</button>
        <button class="plain clear" :disabled="!messageLog.length" @click="clear">clear…</button>
        <button class="x" title="Close (Esc)" @click="$emit('close')">×</button>
      </header>
      <p class="note">What the app has told you, in this browser — the last {{ LOG_KEEP }} lines. Notices leave the corner after {{ NOTICE_MS / 1000 }} seconds; they stay here.</p>
      <div class="lines">
        <template v-for="(e, i) in shown" :key="e.id">
          <div v-if="i === 0 || day(e.at) !== day(shown[i - 1].at)" class="day">{{ day(e.at) }}</div>
          <div class="line" :class="[e.kind, { fresh: e.at > seenBefore && e.kind !== 'info' }]">
            <span class="at">{{ time(e.at) }}</span>
            <span class="kind">{{ e.kind === 'warn' ? 'warning' : e.kind }}</span>
            <span class="text">{{ e.text }}
              <span v-if="e.records" class="pills">
                <button v-for="r in e.records" :key="r.id" class="log-pill" :disabled="!known(r.id)"
                        :title="known(r.id) ? `Open ${r.label} in the tray` : `${r.label} is not loaded here (its table is not open, or it was deleted)`"
                        @click="$emit('open-record', r.id)">{{ r.label }}</button>
              </span>
            </span>
          </div>
        </template>
        <p v-if="!shown.length" class="muted empty">{{ messageLog.length ? 'No warnings or errors.' : 'Nothing has been logged yet.' }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { confirmDialog } from '../dialogs';
import { NOTICE_MS } from '../desktop';
import { clearLog, logAsText, logSeenAt, markLogSeen, messageLog, LOG_KEEP } from '../log';
import type { Store } from '../store';

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ close: []; 'open-record': [id: string] }>();

const problemsOnly = ref(false);
const shown = computed(() => (problemsOnly.value ? messageLog.filter((e) => e.kind !== 'info') : messageLog));
const known = (id: string) => props.store.state.records.has(id);

// What was unread when this opened keeps its mark while it is open; the footer's count clears now.
const seenBefore = logSeenAt.value;
const box = ref<HTMLElement>();
onMounted(() => { markLogSeen(); box.value?.focus(); });

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const copied = ref(false);
async function copy() {
  try { await navigator.clipboard.writeText(logAsText(shown.value)); copied.value = true; setTimeout(() => { copied.value = false; }, 1500); }
  catch { /* no clipboard here: the list is selectable */ }
}
async function clear() {
  if (await confirmDialog({ title: 'Clear the log?', body: `${messageLog.length} line${messageLog.length === 1 ? '' : 's'} will be forgotten in this browser. Nothing in the database changes.`, okText: 'Clear', danger: true })) clearLog();
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
</script>

<style scoped>
.log-backdrop { position: fixed; inset: 0; z-index: 150; background: var(--bg-overlay); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
.log { width: min(860px, 94vw); height: 76vh; display: flex; flex-direction: column; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 20px; box-shadow: var(--card-shadow-drag); font-size: 13px; outline: none; }
header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex: none; }
h2 { margin: 0; font-size: 16px; flex: 1; }
.only { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.only input { margin: 0; }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.note { color: var(--text-muted); font-size: 12px; margin: 0 0 8px; flex: none; }
.plain { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; font-size: 12px; min-width: 58px; }
.plain:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent); }
.plain:disabled { opacity: 0.45; cursor: default; }
.lines { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border-main); border-radius: 6px; background: var(--bg-well); user-select: text; }
.day { position: sticky; top: 0; padding: 3px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); background: var(--bg-chrome); border-bottom: 1px solid var(--border-main); }
.line { display: flex; gap: 10px; align-items: baseline; padding: 4px 10px 4px 7px; border-left: 3px solid var(--accent); border-bottom: 1px solid var(--border-main); line-height: 1.4; }
.line.warn { border-left-color: var(--notice-warn); }
.line.error { border-left-color: var(--danger); }
.line.fresh { background: var(--bg-surface-hover); }
.at { flex: none; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.kind { flex: none; width: 52px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.line.warn .kind { color: var(--notice-warn); }
.line.error .kind { color: var(--danger); }
.text { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--text-primary); }
.pills { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; vertical-align: middle; }
.log-pill { font: inherit; font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--accent); background: var(--accent-ring); color: var(--text-primary); cursor: pointer; }
.log-pill:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); }
.log-pill:disabled { opacity: 0.5; cursor: default; border-color: var(--border-main); background: none; }
.muted { color: var(--text-muted); }
.empty { padding: 14px 10px; margin: 0; }
</style>
