<!--
  A junction column in the record tray: the pairs as a NESTED TABLE.

  A junction row is a relationship that has attributes (contract/junction.ts) — this
  file, that deliverable, and what the pair carries: a status, a note, whatever fields
  the junction table has. Seen from one of its ends that is a small table, relevant
  here and nowhere by itself: one line per pair, the OTHER end first, then the pair's
  own fields in columns. It used to be a list of two-part pills ("Texted Master |
  Uploaded"), which had room for exactly one of those fields and lined nothing up.

      the other end     a pill — it is a record. ⤢ opens THAT record; drag it onto a
                        canvas to place it.
      the pair's fields each drawn as what it is — a select as a capsule, text as
                        text, a tick as a box — in the junction table's own field
                        order (Table settings), and edited IN PLACE with the same
                        editor the grid uses: click a cell. Notes, attachments and
                        the like are a summary here; ⤢ on the row opens the pair.
      ⤢  ×              at the row's end, on hover (their room is always kept): open
                        the pair row itself; delete the pair (undo restores it).

  Adding a pair is still the junction popup (JunctionEditor): the line under the
  table asks the tray to open it. This component writes only `record.update` on a
  pair row and `record.delete` — nothing a junction's rules (apply.ts) care about.

  The grid cannot do this — its rows are one fixed line — so there a junction column
  shows its first pair and a "+N" (GridView); a canvas card shows the pairs as two
  aligned columns (RecordCard). The full table is here.
-->
<template>
  <div class="jt-wrap" @click.stop @keydown.enter.stop>
    <table v-if="rows.length" class="jt">
      <thead>
        <tr>
          <th>{{ otherName }}</th>
          <th v-for="c in cols" :key="c.id">{{ c.name }}</th>
          <th class="acts" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row" class="jt-row" :data-row="row">
          <td class="other">
            <span class="pills">
              <RecordPill v-if="otherOf(row)" :text="derived.plainLabelOfId(otherOf(row)!)" :color="color" title="Drag onto a canvas to place it · ⤢ opens it"
                          drag @down="$emit('drag', otherOf(row)!, $event)" @open="$emit('open', otherOf(row)!)" />
            </span>
          </td>
          <td v-for="c in cols" :key="c.id" :class="{ editable: EDITABLE(c), editing: isEditing(row, c), box: c.type === 'checkbox' }"
              :title="EDITABLE(c) || c.type === 'checkbox' ? undefined : 'Open the pair (⤢) to change this'" @click="startEdit(row, c)">
            <input v-if="c.type === 'checkbox'" type="checkbox" :checked="valueOf(row, c) === true" @click.stop @change="set(row, c.key, !(valueOf(row, c) === true))" />
            <template v-else>
              <span class="shown" :class="{ under: isEditing(row, c) }">
                <span v-if="c.type === 'select' && text(row, c)" class="choice">{{ text(row, c) }}</span>
                <template v-else-if="c.type === 'multi_select'"><span v-for="v in list(row, c)" :key="v" class="choice many">{{ v }}</span></template>
                <span v-else-if="c.type === 'link'" class="pills"><RecordPill v-for="to in derived.linksFrom(row, c.id)" :key="to" :text="derived.labelOfId(to)" :color="derived.pillColorOf(c)" @open="$emit('open', to)" /></span>
                <span v-else class="value" :class="{ derived: DERIVED.has(c.type) }">{{ text(row, c) }}</span>
              </span>
              <CellEditor v-if="isEditing(row, c)" class="over" :field="c" :value="valueOf(row, c)"
                          @set="(k, v) => set(row, k, v)" @unset="(k) => unset(row, k)" @done="(exit) => onDone(row, c, exit)" @cancel="editing = null" />
            </template>
          </td>
          <td class="acts">
            <button class="act open" tabindex="-1" :title="`Open this ${name} — everything on the pair`" @click="$emit('open', row)">⤢</button>
            <button class="act del" tabindex="-1" :title="`Delete this ${name} (undo restores it)`" @click="remove(row)">×</button>
          </td>
        </tr>
      </tbody>
    </table>
    <button class="jt-add" tabindex="-1" @click="$emit('add')">add {{ rows.length ? 'another' : 'a' }} {{ name }}…</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import CellEditor, { type EditExit } from './CellEditor.vue';
import RecordPill from './RecordPill.vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { useDerived } from '../derived';
import { otherEnd, type JunctionConfig } from '../../contract/junction';
import { SYSTEM_FIELD_TYPES } from '../../contract/systemFields';
import { formatNumberField, shapeOf, summarise } from '../../contract/shapes';
import { richTextToPlain } from '../../contract/richtext';

const props = defineProps<{
  store: Store;
  /** The record whose tray this is, and its junction column (a backlink mirroring the junction's endpoint). */
  recordId: string;
  field: FieldRow;
  /** The junction table, its config, and which end `recordId` is on. */
  table: string;
  cfg: JunctionConfig;
  side: 'a' | 'b';
}>();
defineEmits<{ open: [recordId: string]; add: []; drag: [recordId: string, e: PointerEvent] }>();

const store = props.store;
const derived = useDerived(store);

/** The pair rows, as the column lists them. */
const rows = computed(() => derived.backlinkOf(props.recordId, props.field) ?? []);
const otherOf = (row: string) => derived.junctionRow(row)?.[otherEnd(props.side)];
const color = computed(() => derived.pillColorOf(props.field));

const junctionTable = computed(() => store.state.tables.get(props.table));
const name = computed(() => junctionTable.value?.singular_name || junctionTable.value?.name || 'pair');
/** The first column is named for what it holds: the table at the other end. */
const otherName = computed(() => {
  const f = store.state.fields.get(props.side === 'a' ? props.cfg.b : props.cfg.a);
  const t = store.state.tables.get(String(f?.options?.target_table_id ?? ''));
  return t?.singular_name || t?.name || f?.name || 'record';
});
/** The pair's OWN fields, in the junction table's field order: everything but its two ends and the system fields. */
const cols = computed(() => fieldsOf(store.state, props.table)
  .filter((f) => f.id !== props.cfg.a && f.id !== props.cfg.b && !SYSTEM_FIELD_TYPES.has(f.type)));

/** Edited in place, with the grid's editor. The rest is a summary: the pair's own tray (⤢) is where it is changed. */
const INLINE = new Set(['text', 'long_text', 'number', 'date', 'select', 'multi_select', 'file_path']);
const EDITABLE = (f: FieldRow) => INLINE.has(f.type);
const DERIVED = new Set(['lookup', 'backlink']);

const valueOf = (row: string, f: FieldRow) => store.state.records.get(row)?.data[f.key];
const list = (row: string, f: FieldRow) => { const v = valueOf(row, f); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; };
function text(row: string, f: FieldRow): string {
  if (f.type === 'lookup' || f.type === 'backlink') return derived.textOf(row, f).texts.join(', ');
  const v = valueOf(row, f);
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'rich_text') return richTextToPlain(v).split('\n', 1)[0] ?? '';
  if (f.type === 'structured') return summarise(shapeOf(f), v);
  if (f.type === 'attachment') { const n = Array.isArray(v) ? v.length : 0; return n ? `${n} file${n === 1 ? '' : 's'}` : ''; }
  return formatNumberField(f, v) ?? String(v).split('\n', 1)[0] ?? '';
}

/* ── editing a cell ── */
const editing = ref<{ row: string; field: string } | null>(null);
const isEditing = (row: string, f: FieldRow) => editing.value?.row === row && editing.value.field === f.id;
function startEdit(row: string, f: FieldRow) { if (EDITABLE(f) && !isEditing(row, f)) editing.value = { row, field: f.id }; }
function set(row: string, key: string, value: unknown) { store.mutate({ type: 'record.update', id: row, set: { [key]: value }, unset: [] }); }
function unset(row: string, key: string) { store.mutate({ type: 'record.update', id: row, set: {}, unset: [key] }); }
function remove(row: string) { editing.value = null; store.mutate({ type: 'record.delete', id: row }); }
/** Tab goes to the next cell you can type in (and on to the next pair); Enter, down the column; then out. */
function onDone(row: string, f: FieldRow, exit: EditExit) {
  editing.value = null;
  if (exit === 'none') return;
  const cs = cols.value.filter(EDITABLE);
  const ci = cs.findIndex((c) => c.id === f.id), ri = rows.value.indexOf(row);
  if (ci < 0 || ri < 0) return;
  if (exit === 'down') { const next = rows.value[ri + 1]; if (next) editing.value = { row: next, field: f.id }; return; }
  const flat = ri * cs.length + ci + (exit === 'right' ? 1 : -1);
  const nr = rows.value[Math.floor(flat / cs.length)], nc = cs[flat % cs.length];
  if (flat >= 0 && nr && nc) editing.value = { row: nr, field: nc.id };
}
</script>

<style scoped>
/* The table fills the field's box (RecordPanel drops the box's padding for it). Wide —
   a junction with many fields — it scrolls sideways inside the box rather than be cut. */
.jt-wrap { width: 100%; min-width: 0; overflow-x: auto; cursor: default; }
.jt { border-collapse: collapse; width: 100%; font-size: 12px; }
.jt th {
  height: 22px; padding: 0 8px; text-align: left; white-space: nowrap;
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--head-text);
  background: rgba(255, 255, 255, 0.06); border-bottom: 1px solid var(--border-main);
}
.jt td {
  position: relative; height: 28px; box-sizing: border-box; padding: 0 8px; white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
/* A long value ends in an ellipsis rather than widen the table without limit: the cap is
   on what is INSIDE the cell (a cell's own max-width is not something a table honours). */
.jt td.other .pills { max-width: 260px; flex-wrap: nowrap; }
.jt-row:hover td { background: var(--bg-surface-hover); }
.jt td.editable { cursor: text; }
.jt td.editing { outline: 2px solid var(--success); outline-offset: -2px; background: var(--controls-bg); }
.shown { display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 240px; overflow: hidden; }
.shown.under { visibility: hidden; }          /* still sizing the column, under the editor — as in the grid */
.value { overflow: hidden; text-overflow: ellipsis; }
.value.derived { color: var(--text-secondary); font-style: italic; }
.jt td :deep(.over) { position: absolute; inset: 0; padding: 0 8px; box-sizing: border-box; }
/* The row's own actions: always the same room, shown on hover — nothing shifts. */
.jt th.acts, .jt td.acts { width: 1%; padding: 0 4px; text-align: right; }
.act { visibility: hidden; background: none; border: none; cursor: pointer; font: inherit; font-size: 11px; line-height: 16px; padding: 0 3px; }
.jt-row:hover .act, .act:focus { visibility: visible; }
.act.open { color: var(--accent); }
.act.del { color: var(--text-muted); font-size: 12px; }
.act.del:hover { color: var(--danger); }
.jt-add {
  display: block; width: 100%; box-sizing: border-box; height: 28px; padding: 0 8px; text-align: left;
  background: none; border: none; color: var(--text-faint); font: inherit; font-style: italic; cursor: text;
}
.jt-add:hover { color: var(--text-secondary); }
</style>
