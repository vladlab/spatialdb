<!--
  The command palette (Ctrl+K): find any record, in any table, from anywhere.

  This replaces the canvas tray as the way to bring an EXISTING record onto a
  board. The tray listed "the first hundred unplaced records" — fine for a demo
  database, hopeless for a real one. You know what you are looking for; type it.

    oev3              every table, every value: records mentioning "oev3"
    edit:oev3         only tables whose NAME fuzzy-matches "edit"  (Tab completes it)
    edit:             the newest records in those tables
    reel 3 prores     all three words, anywhere in the record, any order

  What Enter does depends on where you are, and the footer says so:

    on a canvas   place the record at the cursor (or jump to it if it is already
                  there — a record sits on a canvas once). Shift+Enter places and
                  KEEPS the palette open, so a board is built in one visit.
    elsewhere     open the record.

  Records are searched on the SERVER (GET /api/search): the client holds only the
  tables it has opened, and "cannot find a record in a table I have not visited"
  would make this useless. Table names are matched here, fuzzily (client/fuzzy.ts)
  — there are few of them and they are already in memory.

  The `>` prefix is reserved for commands and `@` for jumping to a canvas; neither
  is built. They are reserved so that adding them later does not change what an
  existing query means.
-->
<template>
  <div class="palette-backdrop" @mousedown.self="$emit('close')">
    <div class="palette" @keydown.stop="onKey">
      <input ref="input" v-model="query" class="pq" type="text" spellcheck="false"
             placeholder="Find a record…   table:text narrows to a table" />

      <div v-if="parsed.scoped" class="scope">
        in <span v-for="t in parsed.tables.slice(0, 4)" :key="t.id" class="scope-chip">{{ t.name }}</span>
        <span v-if="parsed.tables.length > 4">+{{ parsed.tables.length - 4 }}</span>
      </div>

      <ul class="presults">
        <!-- Before a colon is typed, tables whose name matches are offered first:
             picking one turns "edi" into "Edits:" — the same thing Tab does. -->
        <li v-for="(t, i) in tableHints" :key="'t' + t.id" class="hint-row" :class="{ hi: i === hi }"
            @mousedown.prevent="scopeTo(t.name)" @mousemove="hi = i">
          <span class="swatch" :style="{ background: t.color || 'var(--card-head-bg)' }" />
          <span class="plabel">{{ t.name }}:</span>
          <span class="prest">search only this table</span>
        </li>
        <li v-for="(r, j) in results" :key="r.record.id" :class="{ hi: tableHints.length + j === hi }"
            @mousedown.prevent="choose(r, $event.shiftKey)" @mousemove="hi = tableHints.length + j">
          <span class="swatch" :style="{ background: colorOf(r.record.table_id) }" />
          <span class="plabel">{{ r.label }}</span>
          <span class="ptable" :class="{ far: preferTables?.size && !preferTables.has(r.record.table_id) }"
                :title="preferTables?.size && !preferTables.has(r.record.table_id) ? 'In another section' : undefined">{{ tableName(r.record.table_id) }}</span>
          <span class="prest">{{ restOf(r) }}</span>
          <span v-if="r.inScope && scopeLabel" class="in-scope">in {{ scopeLabel }}</span>
          <span v-if="placedIds?.has(r.record.id)" class="placed">on this canvas</span>
        </li>
      </ul>

      <div class="pfoot">
        <span v-if="searching">searching…</span>
        <span v-else-if="error" class="perr">{{ error }}</span>
        <span v-else-if="!query.trim()">Type to search every table.</span>
        <span v-else-if="!results.length && !tableHints.length">Nothing matches.</span>
        <span v-else-if="fuzzy">No exact match — showing similar spellings.</span>
        <span v-else>{{ results.length }} result{{ results.length === 1 ? '' : 's' }}</span>
        <span class="spacer" />
        <span class="keys">
          <template v-if="canPlace"><b>↵</b> place · <b>⇧↵</b> place, keep open · </template>
          <template v-else><b>↵</b> open · </template>
          <b>Tab</b> complete table · <b>Esc</b> close
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Store } from '../store';
import { tablesSorted, type RecordRow } from '../state';
import { fuzzyRank, parsePaletteQuery } from '../fuzzy';

interface Hit { record: RecordRow; label: string; inScope?: boolean }

const props = defineProps<{
  store: Store;
  /** True on a canvas: Enter places. Otherwise Enter opens. */
  canPlace: boolean;
  /** Records already on the current canvas — shown as such, and jumped to. */
  placedIds?: Set<string>;
  /**
   * Tables of the section you are in. Their records are RANKED FIRST, never the
   * only ones shown: search is where "I can't find it" hurts most, so a section
   * narrows what you are offered first and hides nothing.
   */
  preferTables?: Set<string>;
  /** From client/scope.ts: tells the server which project you are in, so it ranks by it. */
  scopeParams?: string;
  /** The scoped project's name, for the "in Duke" marker. */
  scopeLabel?: string;
}>();
const emit = defineEmits<{
  close: [];
  /** `keepOpen` is Shift+Enter. The parent decides place-vs-jump-vs-open. */
  choose: [record: RecordRow, keepOpen: boolean];
}>();

const input = ref<HTMLInputElement>();
const query = ref('');
const results = ref<Hit[]>([]);
const fuzzy = ref(false);
const searching = ref(false);
const error = ref('');
const hi = ref(0);

const tables = computed(() => tablesSorted(props.store.state));
const parsed = computed(() => parsePaletteQuery(query.value, tables.value, (t) => t.name));
const tableName = (id: string) => props.store.state.tables.get(id)?.name ?? '';
const colorOf = (id: string) => props.store.state.tables.get(id)?.color || 'var(--card-head-bg)';

/** Table suggestions — only while no colon has scoped the query yet. */
const tableHints = computed(() => {
  const q = query.value.trim();
  if (!q || parsed.value.scoped || q.includes(' ')) return [];
  return fuzzyRank(q, tables.value, (t) => t.name).slice(0, 3);
});

function restOf(r: Hit) {
  return Object.values(r.record.data)
    .filter((v) => (typeof v === 'string' || typeof v === 'number') && v !== '' && String(v) !== r.label)
    .map(String).join(' · ');
}

/* Debounced, and the LATEST request wins: results for "oev" must not land on top
   of results for "oev3" just because the network delivered them in that order. */
let timer: ReturnType<typeof setTimeout> | undefined;
let ticket = 0;
watch(query, () => {
  clearTimeout(timer);
  hi.value = 0;
  const { text, tables: scope, scoped } = parsed.value;
  if (!text && !scoped) { results.value = []; fuzzy.value = false; searching.value = false; return; }
  searching.value = true;
  timer = setTimeout(async () => {
    const mine = ++ticket;
    try {
      const out = await props.store.search(text, scope.map((t) => t.id), props.scopeParams ?? '');
      if (mine !== ticket) return;
      const near = props.preferTables;
      // Stable partition: the server's ranking is kept within each half.
      // Closeness, in three rings: your PROJECT (the server ranked those first and
      // flagged them), then your SECTION, then everything else. Nothing is dropped.
      const ring = (r: Hit) => (r.inScope ? 0 : near?.size && near.has(r.record.table_id) ? 1 : 2);
      results.value = out.results.map((r, i) => ({ r, i })).sort((a, b) => ring(a.r) - ring(b.r) || a.i - b.i).map((x) => x.r);
      fuzzy.value = out.fuzzy; error.value = '';
    } catch (e) {
      if (mine === ticket) { results.value = []; error.value = `search failed: ${(e as Error).message}`; }
    } finally {
      if (mine === ticket) searching.value = false;
    }
  }, 120);
});

function scopeTo(name: string) {
  query.value = `${name}:`;
  void nextTick(() => input.value?.focus());
}

function choose(r: Hit, keepOpen: boolean) {
  emit('choose', r.record, keepOpen);
  if (keepOpen) void nextTick(() => input.value?.select());
}

function onKey(e: KeyboardEvent) {
  const total = tableHints.value.length + results.value.length;
  switch (e.key) {
    case 'Escape': e.preventDefault(); emit('close'); return;
    case 'ArrowDown': e.preventDefault(); hi.value = Math.min(total - 1, hi.value + 1); return;
    case 'ArrowUp': e.preventDefault(); hi.value = Math.max(0, hi.value - 1); return;
    case 'Tab': {
      e.preventDefault();
      const t = tableHints.value[Math.min(hi.value, tableHints.value.length - 1)] ?? tableHints.value[0];
      if (t) scopeTo(t.name);
      return;
    }
    case 'Enter': {
      e.preventDefault();
      if (hi.value < tableHints.value.length) return scopeTo(tableHints.value[hi.value].name);
      const r = results.value[hi.value - tableHints.value.length];
      if (r) choose(r, e.shiftKey);
      return;
    }
  }
}

onMounted(() => void nextTick(() => input.value?.focus()));
onUnmounted(() => clearTimeout(timer));
</script>

<style scoped>
.palette-backdrop {
  position: fixed; inset: 0; z-index: 200; display: flex; justify-content: center;
  align-items: flex-start; padding-top: 12vh; background: rgba(0, 0, 0, 0.35);
}
.palette {
  width: min(680px, 92vw); background: var(--controls-bg); border: 1px solid var(--border-main);
  border-radius: 8px; box-shadow: var(--card-shadow-drag); overflow: hidden; font-size: 13px;
}
.pq {
  width: 100%; box-sizing: border-box; padding: 12px 14px; font: inherit; font-size: 15px;
  background: none; border: none; outline: none; color: var(--text-primary);
  border-bottom: 1px solid var(--border-main);
}
.scope { padding: 6px 14px 0; color: var(--text-muted); font-size: 11px; display: flex; gap: 4px; align-items: center; }
.scope-chip { background: var(--bg-surface-hover); border-radius: 3px; padding: 1px 6px; color: var(--accent); }
.presults { list-style: none; margin: 0; padding: 4px 0; max-height: 46vh; overflow-y: auto; }
.presults li { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.presults li.hi { background: var(--bg-surface-hover); }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.plabel { color: var(--text-primary); flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; }
.ptable { color: var(--text-muted); font-size: 11px; flex: none; }
.ptable.far { font-style: italic; opacity: 0.75; }
.prest { color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1; }
.in-scope { color: var(--accent); font-size: 11px; flex: none; }
.placed { color: var(--success); font-size: 11px; flex: none; }
.hint-row .plabel { color: var(--accent); }
.pfoot {
  display: flex; gap: 8px; align-items: center; padding: 7px 14px; font-size: 11px;
  color: var(--text-muted); border-top: 1px solid var(--border-main);
}
.spacer { flex: 1; }
.keys b { font-weight: 600; color: var(--text-secondary); }
.perr { color: var(--danger); }
</style>
