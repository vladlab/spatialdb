<!--
  The junction popup — what makes a junction's backlink column WRITABLE (sql/016,
  contract/junction.ts). Opened from a Files row's "Delivery" cell, it does the one
  gesture the data model asks for:

      1. pick the OTHER end (a deliverable) — the link picker, narrowed by the
         junction's `match` to records that agree with this file (same Work),
         with "show all" a tick away
      2. pick a STATUS — the junction's own select, its choices as buttons

  and writes the row: record.create + two link.add, in one synchronous run, so it
  is one batch (whole or nothing, apply.ts checks) and one Ctrl+Z.

  The other end is picked FIRST, before the status, on purpose: if this pair already
  has a row, picking the same deliverable again lands on that row — you change its
  status rather than discovering a duplicate. One row per pair is a rule the server
  enforces; picking first is what makes it feel natural.

  Opened on an EXISTING row (a chip's click), it skips to step 2: change the status,
  open the row in the tray for notes, or delete it. Deleting is the only way to
  take a pair apart — there is no unlinking one end — and undo restores it whole.

  Positioned like Popover.vue: fixed, from the cell's rectangle.
-->
<template>
  <Popover :anchor="anchor" class="je" @close="$emit('done')">
    <div class="head">
      <span class="what">{{ junctionName }}</span>
      <span class="from">{{ fromLabel }}</span>
      <span class="arrow">{{ side === 'a' ? '→' : '←' }}</span>
      <span v-if="other" class="to">{{ otherLabel }}</span>
      <span v-else class="to muted">pick {{ otherSingular }}…</span>
    </div>

    <LinkPicker v-if="!other" :store="store" :target-table-id="otherTable" :linked="[]" inline
                :match="matchRule" @add="pickOther" @done="onPickerDone" />

    <template v-else>
      <div v-if="statusField" class="statuses">
        <span class="lbl">{{ statusField.name }}</span>
        <button v-for="c in choices" :key="c" class="st" :class="{ on: c === status }" @click="setStatus(c)">{{ c }}</button>
        <button v-if="!choices.length" class="st muted" disabled>no choices yet — add some in Table settings</button>
        <button v-if="status" class="st clear" title="Clear the status" @click="setStatus('')">×</button>
      </div>
      <div class="actions">
        <button v-if="!rowId" class="act primary" @click="create()">Add{{ status ? ` as “${status}”` : '' }}</button>
        <template v-else>
          <button class="act" title="Open this row in the tray — notes, anything else on it" @click="$emit('open', rowId)">Open ⤢</button>
          <button class="act danger" title="Delete this pair (undo restores it)" @click="remove">Delete</button>
        </template>
        <button class="act" @click="$emit('done')">Done</button>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Popover from './Popover.vue';
import LinkPicker from './LinkPicker.vue';
import type { Store } from '../store';
import { useDerived } from '../derived';
import { choicesOf } from '../../contract/values';
import { hasMatch, matches, otherEnd, type JunctionConfig } from '../../contract/junction';
import type { EditExit } from './CellEditor.vue';

const props = defineProps<{
  store: Store;
  /** The junction table and its config. */
  table: string;
  cfg: JunctionConfig;
  /** Which end the STARTING record is on, and which record it is. */
  side: 'a' | 'b';
  from: string;
  /** An existing row to edit; absent when adding a pair. */
  rowId?: string;
  /** The other end, already chosen (a canvas drop): skips the picker, straight to the status. */
  picked?: string;
  anchor?: HTMLElement | null;
}>();
const emit = defineEmits<{ done: []; open: [rowId: string]; created: [rowId: string, other: string] }>();

const derived = useDerived(props.store);
const rowId = ref(props.rowId);
const junctionName = computed(() => props.store.state.tables.get(props.table)?.singular_name || props.store.state.tables.get(props.table)?.name || 'pair');
const mine = computed(() => (props.side === 'a' ? props.cfg.a : props.cfg.b));
const theirs = computed(() => (props.side === 'a' ? props.cfg.b : props.cfg.a));
const otherTable = computed(() => String(props.store.state.fields.get(theirs.value)?.options?.target_table_id ?? ''));
const otherSingular = computed(() => { const t = props.store.state.tables.get(otherTable.value); return t?.singular_name || t?.name || 'a record'; });
const statusField = computed(() => (props.cfg.status ? props.store.state.fields.get(props.cfg.status) : undefined));
const choices = computed(() => choicesOf(statusField.value?.options) ?? []);

/** The other end: from the row when editing, else what was picked. */
const picked = ref<string>();
if (props.picked && !props.rowId) {
  // Handed the other end: land on the existing pair if there is one, else it is the pick.
  const existing = derived.junctionRowFor(props.cfg, props.side, props.from, props.picked);
  if (existing) rowId.value = existing; else picked.value = props.picked;
}
const other = computed(() => (rowId.value ? derived.junctionRow(rowId.value)?.[otherEnd(props.side)] : picked.value));
const fromLabel = computed(() => derived.plainLabelOfId(props.from));
const otherLabel = computed(() => (other.value ? derived.plainLabelOfId(other.value) : ''));

/** The status: the row's when editing, else the draft chosen for the new row. */
const draft = ref('');
const status = computed(() => (rowId.value ? derived.junctionRow(rowId.value)?.status ?? '' : draft.value));

/** The picker's narrowing, when this junction has a match pair the starting record can use. */
const matchRule = computed(() => {
  if (!hasMatch(props.cfg, props.side, props.from, derived.linksFrom)) return undefined;
  const names = (props.cfg.match ?? [])
    .map(([fa, fb]) => props.store.state.fields.get(props.side === 'a' ? fa : fb)?.name)
    .filter((n): n is string => !!n);
  return { test: (id: string) => matches(props.cfg, props.side, props.from, id, derived.linksFrom), label: `the same ${names.join(' / ') || 'links'}` };
});

function pickOther(id: string) {
  // The pair may already have a row: land on it rather than making a second.
  const existing = derived.junctionRowFor(props.cfg, props.side, props.from, id);
  if (existing) { rowId.value = existing; return; }
  picked.value = id;
  // Nothing to choose → the row is the pick.
  if (!statusField.value || !choices.value.length) create();
}
function onPickerDone(exit: EditExit) { if (exit === 'none' && !other.value) emit('done'); }

function setStatus(c: string) {
  if (!rowId.value) { draft.value = c; return; }
  const key = statusField.value?.key;
  if (!key) return;
  if (c) props.store.mutate({ type: 'record.update', id: rowId.value, set: { [key]: c }, unset: [] });
  else props.store.mutate({ type: 'record.update', id: rowId.value, set: {}, unset: [key] });
}

/** The row, its two links: one run, one batch, one Ctrl+Z. */
function create() {
  if (!picked.value || rowId.value) return;
  const id = crypto.randomUUID();
  const key = statusField.value?.key;
  const data = key && draft.value ? { [key]: draft.value } : {};
  props.store.mutate({ type: 'record.create', id, tableId: props.table, data });
  props.store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: mine.value, fromRecord: id, toRecord: props.from });
  props.store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: theirs.value, fromRecord: id, toRecord: picked.value });
  const other = picked.value;
  rowId.value = id;
  picked.value = undefined;
  emit('created', id, other);
}

function remove() {
  if (!rowId.value) return;
  props.store.mutate({ type: 'record.delete', id: rowId.value });
  emit('done');
}
</script>

<style scoped>
.je { min-width: 340px; max-width: 560px; }
.head { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; margin-bottom: 8px; }
.what { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); margin-right: 4px; }
.from, .to { font-weight: 600; }
.arrow { color: var(--text-muted); }
.muted { color: var(--text-muted); font-weight: 400; }
.statuses { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 6px 0 10px; }
.lbl { color: var(--text-muted); margin-right: 4px; }
.st { font: inherit; padding: 3px 8px; border-radius: 10px; border: 1px solid var(--border-main); background: none; color: var(--text-secondary); cursor: pointer; }
.st:hover { color: var(--text-primary); border-color: var(--text-muted); }
.st.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.st.clear { padding: 3px 6px; }
.st[disabled] { cursor: default; }
.actions { display: flex; gap: 6px; justify-content: flex-end; }
.act { font: inherit; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--border-main); background: none; color: var(--text-primary); cursor: pointer; }
.act.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.act.danger { color: var(--danger, #c33); }
</style>
