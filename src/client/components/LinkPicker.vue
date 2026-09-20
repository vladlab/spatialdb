<!--
  The link picker: type to find a record in the target table, Enter to link it.

  Replaces a plain <select> listing every record of the target table — fine at
  twenty rows, useless at two thousand, and the target of a link field in this
  app is routinely "every file on the project".

  It lives inside the grid's edit mode and follows the same exit contract as
  CellEditor (see there), with one difference that comes from a link cell holding
  MANY values rather than one:

    type            filter the candidates          ↑ / ↓      move the highlight
    Enter           link the highlighted record — and STAY OPEN, query cleared,
                    because adding three files to a deliverable is one gesture,
                    not three trips into the cell
    Backspace       on an empty query: unlink the last one (token-input habit)
    Tab / Shift+Tab close and move right / left    Escape     close, stay on the cell

  Every add and remove is its own mutation, written immediately. There is no
  draft to cancel, so Escape closes rather than reverts — undo is per link, and
  a link removal is restorable like any other delete.

  SEARCH COVERS THE WHOLE RECORD, not just its label: you find a file by its
  reel number or codec as readily as by its name. The haystack is built once per
  open; filtering 50k strings per keystroke is a few milliseconds.

  The list is CAPPED at what is rendered, never at what is searched — "37 more,
  keep typing" rather than a scrollbar over ten thousand rows.

  Positioned `fixed` from the cell's rectangle, because every ancestor clips:
  the cell (fixed row height) and the scroller (the grid's viewport).
-->
<template>
  <div class="picker" :style="pos" @keydown.stop="onKey" @mousedown.stop>
    <div class="current">
      <span v-for="id in linked" :key="id" class="chip">
        {{ label(id) }}<button class="chip-x" tabindex="-1" :title="`Unlink ${label(id)}`"
                               @mousedown.prevent @click="$emit('remove', id)">×</button>
      </span>
      <input ref="input" v-model="query" class="q" type="text" :placeholder="`find in ${targetName}…`"
             @blur="onBlur" />
    </div>
    <!-- In a project, candidates default to THAT project's records — with a way
         out, because reusing a file from another show is a legitimate thing to do. -->
    <label v-if="scopeFilter" class="note scope-toggle" @mousedown.prevent>
      <input v-model="everywhere" type="checkbox" tabindex="-1" @mousedown.stop /> search all {{ scopeTableName }}, not just {{ scopeApi?.label.value }}
    </label>
    <div v-if="loading" class="note">loading {{ targetName }}… {{ loadedRows.toLocaleString() }} rows — results are partial</div>
    <ul class="list">
      <li v-for="(c, i) in visible" :key="c.id" :class="{ hi: i === hi }"
          @mousedown.prevent="pick(c.id)" @mousemove="hi = i">
        <span class="name">{{ c.label }}</span>
        <span class="rest">{{ c.rest }}</span>
      </li>
    </ul>
    <div v-if="!visible.length" class="note">
      {{ candidates.length ? 'nothing matches' : (loading ? '' : `no ${linked.length ? 'other ' : ''}records in ${targetName}`) }}
    </div>
    <div v-else-if="matches.length > visible.length" class="note">
      {{ (matches.length - visible.length).toLocaleString() }} more — keep typing
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { SCOPE } from '../scope';
import type { Store } from '../store';
import { primaryKeys, recordsOf } from '../state';
import { labelFrom } from '../../contract/labels';
import type { EditExit } from './CellEditor.vue';

const props = defineProps<{
  store: Store;
  targetTableId: string;
  /** Record ids already linked from this cell, in display order. */
  linked: string[];
  /** The cell, for positioning. */
  anchor?: HTMLElement | null;
  /** Set when the edit was started by typing: becomes the first search character. */
  seed?: string;
}>();
const emit = defineEmits<{
  add: [toRecord: string];
  remove: [toRecord: string];
  done: [exit: EditExit];
}>();

const MAX_SHOWN = 50;

const scopeApi = inject(SCOPE, null);
/** Only when actually narrowed to one project — under "All" there is nothing to escape from. */
const scopeFilter = computed(() => (scopeApi && scopeApi.scope.value.kind !== 'all' ? scopeApi.filterFor(props.targetTableId) : null));
const scopeTableName = computed(() => props.store.state.tables.get(scopeApi?.scopeTableId.value ?? '')?.name ?? 'projects');
const everywhere = ref(false);

const input = ref<HTMLInputElement>();
const query = ref(props.seed ?? '');
const hi = ref(0);

const targetName = computed(() => props.store.state.tables.get(props.targetTableId)?.name ?? 'table');
const load = computed(() => props.store.tableLoads.get(props.targetTableId));
const loading = computed(() => load.value?.state === 'loading');
const loadedRows = computed(() => load.value?.rows ?? 0);

/** Hoisted once; the candidate list labels every record of the target table. */
const labelKeys = computed(() => primaryKeys(props.store.state));
function label(id: string) {
  const r = props.store.state.records.get(id);
  return r ? labelFrom(r.data, labelKeys.value.get(r.table_id), id.slice(0, 8))
    : props.store.farLabels.get(id) ?? id.slice(0, 8);
}

/** Label, the rest of the record as a hint, and one lowercase string to search. */
const candidates = computed(() => {
  const taken = new Set(props.linked);
  const within = everywhere.value ? null : scopeFilter.value;
  return recordsOf(props.store.state, props.targetTableId)
    .filter((r) => !taken.has(r.id) && (!within || within(r)))
    .map((r) => {
      const name = labelFrom(r.data, labelKeys.value.get(r.table_id), r.id.slice(0, 8));
      const rest = Object.values(r.data)
        .filter((v) => (typeof v === 'string' || typeof v === 'number') && v !== '' && v !== name)
        .map(String).join(' · ');
      return { id: r.id, label: name, rest, hay: `${name} ${rest}`.toLowerCase() };
    });
});

/** Every whitespace-separated term must appear: "reel 3 prores" narrows, in any order. */
const matches = computed(() => {
  const terms = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return candidates.value;
  return candidates.value.filter((c) => terms.every((t) => c.hay.includes(t)));
});
const visible = computed(() => matches.value.slice(0, MAX_SHOWN));

watch([query, () => matches.value.length], () => { hi.value = 0; });

function pick(id: string) {
  emit('add', id);
  query.value = '';
  void nextTick(() => input.value?.focus());
}

let finished = false;
function finish(exit: EditExit) {
  if (finished) return;
  finished = true;
  emit('done', exit);
}

function onKey(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); hi.value = Math.min(visible.value.length - 1, hi.value + 1); return;
    case 'ArrowUp': e.preventDefault(); hi.value = Math.max(0, hi.value - 1); return;
    case 'Enter': {
      e.preventDefault();
      const c = visible.value[hi.value];
      // Enter with nothing to pick closes, so Enter-Enter on a link cell is a
      // no-op round trip rather than a trap.
      if (c) pick(c.id); else finish('none');
      return;
    }
    case 'Backspace':
      if (query.value === '' && props.linked.length) {
        e.preventDefault();
        emit('remove', props.linked[props.linked.length - 1]);
      }
      return;
    case 'Escape': e.preventDefault(); finish('none'); return;
    case 'Tab': e.preventDefault(); finish(e.shiftKey ? 'left' : 'right'); return;
  }
}

/** Clicking anywhere outside closes. Clicks INSIDE never blur — they preventDefault. */
function onBlur() { finish('none'); }

const pos = computed(() => {
  const r = props.anchor?.getBoundingClientRect();
  if (!r) return {};
  return { left: `${r.left}px`, top: `${r.top}px`, minWidth: `${Math.max(r.width, 320)}px` };
});

onMounted(() => {
  void props.store.loadTable(props.targetTableId);   // no-op if already walked
  void nextTick(() => input.value?.focus());
});
</script>

<style scoped>
.picker {
  position: fixed; z-index: 50; max-width: 560px;
  background: var(--controls-bg); border: 2px solid var(--success); border-radius: 4px;
  box-shadow: var(--card-shadow-drag); font-size: 12px;
}
.current { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; padding: 4px 6px; }
.q {
  flex: 1; min-width: 120px; background: none; border: none; outline: none;
  color: inherit; font: inherit; padding: 2px 0;
}
.list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto;
        border-top: 1px solid var(--border-main); }
.list li { display: flex; gap: 8px; padding: 4px 8px; cursor: pointer; white-space: nowrap; }
.list li.hi { background: var(--bg-surface-hover); }
.name { color: var(--text-primary); }
.rest { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
.scope-toggle { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.note { padding: 4px 8px; color: var(--text-muted); font-size: 11px;
        border-top: 1px solid var(--border-main); }
</style>
