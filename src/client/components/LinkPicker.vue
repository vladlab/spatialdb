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

  TWO SECTIONS, and they must not read as one. What is ALREADY linked (top, darker,
  labelled "linked") and where you SEARCH for more (the "add" line and its results)
  used to share a row — chips and the query input in one wrapping line — and the
  owner could not tell at a glance what was in from what was being looked for.

  `field` is the record tray's mode. There the FIELD shows its own links, as the
  same pills in the same places as when it is not being edited — so this draws no
  "linked" section at all: it is only the search line, sitting exactly where the
  field's "add another…" line was, with the results hanging beneath the field as a
  dropdown (over what is below, so nothing in the tray moves when it opens).
-->
<template>
  <div class="picker" :class="{ inline, field }" :style="inline || field ? undefined : pos" @keydown.stop="onKey" @mousedown.stop>
    <div v-if="!field && linked.length" class="current">
      <span class="sec">linked</span>
      <span v-for="id in linked" :key="id" class="chip linked">
        {{ label(id) }}<button class="chip-x" tabindex="-1" :title="`Unlink ${label(id)}`"
                               @mousedown.prevent @click="$emit('remove', id)">×</button>
      </span>
    </div>
    <div class="find">
      <span class="sec add">{{ field ? '+' : 'add' }}</span>
      <input ref="input" v-model="query" class="q" type="text" :placeholder="`find in ${targetName}…`"
             @blur="onBlur" />
    </div>
    <div ref="drop" class="drop">
    <!-- In a project, candidates default to THAT project's records — with a way
         out, because reusing a file from another show is a legitimate thing to do. -->
    <label v-if="scopeFilter" class="note scope-toggle" @mousedown.prevent>
      <input v-model="everywhere" type="checkbox" tabindex="-1" @mousedown.stop /> search all {{ scopeTableName }}, not just {{ scopeApi?.label.value }}
    </label>
    <!-- A junction's MATCH (contract/junction.ts): candidates that agree with the
         starting record come first and alone — a filter with a way out, never a
         constraint. When nothing agrees the toggle is moot and everything shows. -->
    <label v-if="match && anyMatch" class="note scope-toggle" @mousedown.prevent>
      <input v-model="showAll" type="checkbox" tabindex="-1" @mousedown.stop /> show all {{ targetName }}, not just {{ match.label }}
    </label>
    <div v-if="loading" class="note">loading {{ targetName }}… {{ loadedRows.toLocaleString() }} rows — results are partial</div>
    <ul class="list">
      <li v-for="(c, i) in visible" :key="c.id" :class="{ hi: i === hi }"
          @mousedown.prevent="pick(c.id)" @mousemove="hi = i">
        <span class="name">{{ c.label }}</span>
        <span class="rest">{{ c.rest }}</span>
      </li>
      <!-- CREATE a record named by what was typed — offered when the caller can do
           something with one (`allowCreate`) and nothing matches the query exactly. -->
      <li v-if="allowCreate && canCreate" class="create" :class="{ hi: hi === visible.length }"
          @mousedown.prevent="emit('create', query.trim())" @mousemove="hi = visible.length">
        <span class="name">+ new: “{{ query.trim() }}”</span>
      </li>
    </ul>
    <div v-if="!visible.length && !(allowCreate && canCreate)" class="note">
      {{ candidates.length ? 'nothing matches' : (loading ? '' : `no ${linked.length ? 'other ' : ''}records in ${targetName}`) }}
    </div>
    <div v-else-if="matches.length > visible.length" class="note">
      {{ (matches.length - visible.length).toLocaleString() }} more — keep typing
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { SCOPE } from '../scope';
import type { Store } from '../store';
import { primaryKeys, recordsOf } from '../state';
import { hintFrom, labelFrom } from '../../contract/labels';
import type { EditExit } from './CellEditor.vue';

const props = defineProps<{
  store: Store;
  targetTableId: string;
  /** Record ids already linked from this cell, in display order. */
  linked: string[];
  /** The cell, for positioning. */
  anchor?: HTMLElement | null;
  /** Sit in the normal flow of whatever contains it (a popover), not floating over a cell. */
  inline?: boolean;
  /** Inside a record-tray FIELD that shows its own links: only the search line, in the flow, its results a dropdown beneath. */
  field?: boolean;
  /** Offer "+ new: …" for a query that matches nothing exactly; the caller creates it. */
  allowCreate?: boolean;
  /** Set when the edit was started by typing: becomes the first search character. */
  seed?: string;
  /** Prefer candidates passing `test` (shown alone until "show all"); `label` names what they agree on. */
  match?: { test: (id: string) => boolean; label: string };
}>();
const emit = defineEmits<{
  add: [toRecord: string];
  remove: [toRecord: string];
  /** "+ new" was chosen: a record with this name is wanted (and, presumably, linked). */
  create: [name: string];
  done: [exit: EditExit];
}>();

const MAX_SHOWN = 50;

const scopeApi = inject(SCOPE, null);
/** Only when actually narrowed to one project — under "All" there is nothing to escape from. */
const scopeFilter = computed(() => (scopeApi && scopeApi.scope.value.kind !== 'all' ? scopeApi.filterFor(props.targetTableId) : null));
const scopeTableName = computed(() => props.store.state.tables.get(scopeApi?.scopeTableId.value ?? '')?.name ?? 'projects');
const everywhere = ref(false);
const showAll = ref(false);

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
const inScope = computed(() => {
  const taken = new Set(props.linked);
  const within = everywhere.value ? null : scopeFilter.value;
  return recordsOf(props.store.state, props.targetTableId).filter((r) => !taken.has(r.id) && (!within || within(r)));
});
const anyMatch = computed(() => !!props.match && inScope.value.some((r) => props.match!.test(r.id)));
const candidates = computed(() => {
  const m = props.match;
  return inScope.value
    .filter((r) => !m || showAll.value || !anyMatch.value || m.test(r.id))
    .map((r) => {
      const name = labelFrom(r.data, labelKeys.value.get(r.table_id), r.id.slice(0, 8));
      const rest = hintFrom(r.data, name);
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
const canCreate = computed(() => { const q = query.value.trim().toLowerCase(); return !!q && !candidates.value.some((c) => c.label.toLowerCase() === q); });

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
    case 'ArrowDown': e.preventDefault(); hi.value = Math.min(visible.value.length - (props.allowCreate && canCreate.value ? 0 : 1), hi.value + 1); return;
    case 'ArrowUp': e.preventDefault(); hi.value = Math.max(0, hi.value - 1); return;
    case 'Enter': {
      e.preventDefault();
      if (props.allowCreate && canCreate.value && hi.value === visible.value.length) { emit('create', query.value.trim()); return; }
      const c = visible.value[hi.value];
      // Enter with nothing to pick closes, so Enter-Enter on a link cell is a
      // no-op round trip rather than a trap.
      if (c) pick(c.id); else finish('none');
      return;
    }
    case 'Backspace':
      // Not in a tray field: its links are the field's own pills, each with its ×, and
      // holding Backspace to clear a query must not go on to eat a link.
      if (query.value === '' && props.linked.length && !props.field) {
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

/** A tray field near the bottom of the tray: bring the dropdown into view rather than open it below the fold. */
const drop = ref<HTMLElement>();
function showDrop() { if (props.field) drop.value?.scrollIntoView?.({ block: 'nearest' }); }

onMounted(() => {
  void props.store.loadTable(props.targetTableId);   // no-op if already walked
  void nextTick(() => { input.value?.focus(); showDrop(); });
});
</script>

<style scoped>
.picker {
  position: fixed; z-index: 50; max-width: 560px;
  background: var(--controls-bg); border: 2px solid var(--success); border-radius: 4px;
  box-shadow: var(--card-shadow-drag); font-size: 12px;
}
.picker.inline { position: static; max-width: none; box-shadow: none; border-width: 1px; border-color: var(--border-main); }
/* LINKED: what is already in. Darker than the rest, and said. */
.current { display: flex; flex-wrap: wrap; gap: 3px; align-items: center; padding: 5px 6px; background: var(--bg-app); border-bottom: 1px solid var(--border-main); border-radius: 2px 2px 0 0; }
.sec { flex: none; color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; user-select: none; }
/* ADD: the search line, and under it what it finds. */
.find { display: flex; align-items: center; gap: 4px; padding: 4px 6px; }
.sec.add { color: var(--success); }
/* What is already linked: the pill look (RecordPill) — squarish and tinted — not a tag's round chip. */
.chip.linked { border-radius: 4px; border-color: transparent; background: rgba(96, 150, 204, 0.2); font-size: 12px; margin: 0; padding: 1px 3px 1px 7px; }
.q {
  flex: 1; min-width: 120px; background: none; border: none; outline: none;
  color: inherit; font: inherit; padding: 2px 0;
}

/* IN A TRAY FIELD: no box of its own — the field is the box. The search line takes
   the place of the field's "add another…" line; the results hang off the field's
   bottom edge (-9px / +5px: the field's padding and border), over what is below. */
.picker.field { position: relative; flex: 1 1 100%; max-width: none; background: none; border: none; box-shadow: none; font-size: inherit; }
.picker.field .find { padding: 0; }
.picker.field .sec.add { font-size: 13px; letter-spacing: 0; margin-right: 2px; }
.picker.field .q { padding: 0; }
.picker.field .drop {
  position: absolute; z-index: 50; top: calc(100% + 4px); left: -9px; right: -9px;
  background: var(--controls-bg); border: 1px solid var(--success); border-radius: 0 0 4px 4px;
  box-shadow: var(--card-shadow-drag); font-size: 12px;
}
.list { list-style: none; margin: 0; padding: 0; max-height: 320px; overflow-y: auto;
        border-top: 1px solid var(--border-main); }
.list li { display: flex; gap: 8px; padding: 4px 8px; cursor: pointer; white-space: nowrap; }
.list li.hi { background: var(--bg-surface-hover); }
.name { color: var(--text-primary); }
.rest { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
.scope-toggle { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.create .name { color: var(--accent); }
.note { padding: 4px 8px; color: var(--text-muted); font-size: 11px;
        border-top: 1px solid var(--border-main); }
</style>
