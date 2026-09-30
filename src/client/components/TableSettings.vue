<!--
  Everything about ONE table: its name and look, its kind, and — the body of the
  dialog — its SCHEMA: the fields, in the order that is the default for views,
  cards and the record tray and that defines the primary (contract/labels.ts).
  Opened from the ⚙ on a table's row in the tree.

  The field list is an editor, not a listing. Each row: a grip to drag it (the
  others slide out of the way — a TransitionGroup FLIP), the ★ of the field that
  names records (previewed while dragging, since the first plain-valued field
  is the primary and a drag can change it), the name, type and a one-line summary,
  and ⚙, which unfolds the same FieldSettings form the grid's column headers use —
  rename, choices, arrow style, compare, delete. "+ add field" at the bottom is the
  same FieldForm as the grid's "+", kept open: type a name, Enter, and the focus is
  back in the name box for the next one — the fast path for a schema with a LOT
  of fields, which is why this list exists (the column headers are fine for one).

  Every control writes at once; a drag writes once, on release, as one Ctrl+Z.
-->
<template>
  <div class="ts-backdrop" @mousedown.self="$emit('close')">
    <div v-if="table" class="ts" @keydown.stop="onKey">
      <header><h2>Table settings</h2><button class="x" title="Close (Esc)" @click="$emit('close')">×</button></header>

      <div class="line">
        <input class="icon-in" :value="table.icon" maxlength="4" placeholder="▦" title="An emoji, or a letter" @change="upd({ icon: val($event) })" />
        <input ref="nameInput" class="name-in" :value="table.name" @change="actions.renameTable(table.id, val($event))" />
        <input type="color" :value="table.color || '#4a4a4a'" title="Card colour for this table's records" @change="upd({ color: val($event) })" />
      </div>
      <div class="fld">
        <label for="ts-singular">Singular name <span class="hint">— shown on cards: “Deliverable”, not “Deliverables”</span></label>
        <input id="ts-singular" :value="table.singular_name" placeholder="(optional)" @change="upd({ singularName: val($event) })" />
      </div>

      <p class="info">
        <template v-if="table.kind === 'canvas'"><b>▦ A table of boards.</b> Every record in it is a canvas. This is set when a table is made and cannot be changed.</template>
        <template v-else-if="table.kind === 'report'"><b>▤ A table of reports.</b> Every record in it is a report: its “Report” field holds the definition. This is set when a table is made and cannot be changed.</template>
        <template v-else-if="table.kind === 'junction'"><!-- JunctionSettings below says it all --></template>
        <template v-else>An ordinary table. (Tables of boards, reports or junctions are chosen in the new-table dialog.)</template>
      </p>
      <JunctionSettings v-if="table.kind === 'junction'" :store="store" :table-id="tableId" />

      <!-- THE SCHEMA. Its order is not any view's column order — that is arranged in
           the grid and saved per view. This one is the DEFAULT (the record tray, canvas
           cards, the link picker, a never-arranged view) and it DEFINES the primary: the
           first plain-valued field names the table's records (contract/labels.ts). -->
      <section class="schema">
        <h3>Fields <span class="hint">— {{ ownFields.length }}; drag to reorder. The order is the default for views, cards and the record panel; the first plain-valued field (★) names records</span></h3>
        <TransitionGroup tag="div" name="fl" class="field-list" :class="{ dragging: !!drag }">
          <div v-for="(f, i) in shownFields" :key="f.id" class="fitem" :class="{ lifted: drag?.id === f.id, open: openId === f.id }" :data-field="f.id">
            <div class="frow">
              <span class="grip" title="Drag to reorder (↑ ↓ also work)" @pointerdown.prevent="startDrag(f.id, $event)">⋮⋮</span>
              <span class="star" :class="{ on: primaryId === f.id }" :title="primaryId === f.id ? 'Primary field — names this table\'s records' : ''">★</span>
              <span class="fname">{{ f.name }}</span>
              <span class="ftype mono">{{ f.type }}</span>
              <span class="fsum hint">{{ summaryOf(f) }}</span>
              <button class="mv prev" :disabled="i === 0" tabindex="-1" title="Move up" @click="actions.moveField(f.id, -1)">↑</button>
              <button class="mv next" :disabled="i === shownFields.length - 1" tabindex="-1" title="Move down" @click="actions.moveField(f.id, 1)">↓</button>
              <button class="gear" :class="{ on: openId === f.id }" :title="openId === f.id ? 'Close' : 'Settings — rename, choices, arrows, comparison, delete'" @click="openId = openId === f.id ? null : f.id">⚙</button>
            </div>
            <FieldSettings v-if="openId === f.id" :store="store" :actions="actions" :field="f" layout="stack" class="fopen" @deleted="openId = null" />
          </div>
        </TransitionGroup>
        <p v-if="!ownFields.length" class="info">No fields yet.</p>
        <!-- Kept open: the run of adds. -->
        <FieldForm :store="store" :actions="actions" :table-id="tableId" layout="row" class="fadd" @created="onCreated" />
      </section>

      <ToolSettings v-if="!table.kind || table.kind === 'records'" :store="store" :table-id="tableId" />

      <footer><button class="danger" @click="remove">Delete table…</button></footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { useSchemaActions } from '../schemaActions';
import ToolSettings from './ToolSettings.vue';
import JunctionSettings from './JunctionSettings.vue';
import FieldSettings from './FieldSettings.vue';
import FieldForm from './FieldForm.vue';
import { SYSTEM_FIELD_TYPES } from '../../contract/systemFields';
import { LABEL_TYPES } from '../../contract/labels';
import { choicesOf } from '../../contract/values';
import { shapeOf } from '../../contract/shapes';

const props = defineProps<{ store: Store; tableId: string }>();
const emit = defineEmits<{ close: [] }>();
const actions = useSchemaActions(props.store);
const nameInput = ref<HTMLInputElement>();

const val = (e: Event) => (e.target as HTMLInputElement).value;
const table = computed(() => props.store.state.tables.get(props.tableId));
const ownFields = computed(() => fieldsOf(props.store.state, props.tableId).filter((f) => !SYSTEM_FIELD_TYPES.has(f.type)));
const upd = (patch: { icon?: string; color?: string; singularName?: string }) =>
  props.store.mutate({ type: 'table.update', id: props.tableId, ...patch });

/* ── the list ──────────────────────────────────────────────────────────── */
const openId = ref<string | null>(null);
const tableName = (id: unknown) => props.store.state.tables.get(String(id ?? ''))?.name ?? '?';
const fieldName = (id: unknown) => props.store.state.fields.get(String(id ?? ''))?.name ?? '?';
/** One line of what makes this field what it is. */
function summaryOf(f: FieldRow): string {
  const o = f.options ?? {};
  switch (f.type) {
    case 'link': return `→ ${tableName(o.target_table_id)}${o.single ? ' · single' : ''}${o.membership ? ' · membership' : ''}${o.compare ? ' · compares' : ''}`;
    case 'backlink': { const src = props.store.state.fields.get(String(o.source_field_id ?? '')); return src ? `← ${tableName(src.table_id)}.${src.name}${o.compare ? ' · compares' : ''}` : '← (broken)'; }
    case 'lookup': return `${fieldName(o.via_field_id)} → ${fieldName(o.show_field_id)}`;
    case 'select': case 'multi_select': { const c = choicesOf(o); return o.vocabulary ? `built-in: ${o.vocabulary}` : c ? `${c.length} choice${c.length === 1 ? '' : 's'}${c.length ? ': ' + c.slice(0, 4).join(', ') + (c.length > 4 ? '…' : '') : ''}` : ''; }
    case 'structured': return shapeOf(f) ?? '';
    case 'number': return typeof o.format === 'string' ? o.format : '';
    default: return '';
  }
}
function onCreated(id: string) {
  // Show it, and keep the new row in view.
  void nextTick(() => document.querySelector<HTMLElement>(`.ts .fitem[data-field="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
}

/* ── drag to reorder ─────────────────────────────────────────────────────
   The list is rendered in `draft` order while a row is held; the others slide
   out of the way (TransitionGroup). Nothing is written until release: then the
   whole order goes as one reorder — one Ctrl+Z. ↑ ↓ remain for the keyboard. */
const drag = ref<{ id: string; order: string[]; y: number } | null>(null);
const shownFields = computed(() => {
  const d = drag.value;
  if (!d) return ownFields.value;
  const by = new Map(ownFields.value.map((f) => [f.id, f]));
  return d.order.map((id) => by.get(id)!).filter(Boolean);
});
/** The ★: the first plain-valued field in the order SHOWN — so a drag previews what it would rename. */
const primaryId = computed(() => shownFields.value.find((f) => LABEL_TYPES.has(f.type))?.id ?? null);

function startDrag(id: string, e: PointerEvent) {
  if (e.button !== 0) return;
  openId.value = null;
  drag.value = { id, order: ownFields.value.map((f) => f.id), y: e.clientY };
  const move = (ev: PointerEvent) => {
    const d = drag.value; if (!d) return;
    d.y = ev.clientY;
    // Where the pointer is among the rows: the lifted row goes before the first row
    // whose middle is below the pointer.
    const rows = [...document.querySelectorAll<HTMLElement>('.ts .field-list .fitem')].filter((el) => el.dataset.field !== id);
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i]!.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { index = i; break; } }
    const rest = d.order.filter((x) => x !== id);
    rest.splice(index, 0, id);
    if (rest.join() !== d.order.join()) d.order = rest;
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    const d = drag.value; drag.value = null;
    if (!d) return;
    const before = ownFields.value.map((f) => f.id).join();
    if (d.order.join() !== before) actions.reorderFields(props.tableId, d.order);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

async function remove() { if (await actions.deleteTable(props.tableId)) emit('close'); }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (openId.value) openId.value = null; else emit('close'); } }
onMounted(() => void nextTick(() => nameInput.value?.focus()));
</script>

<style scoped>
.ts-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.4); display: flex; justify-content: center; align-items: flex-start; padding-top: 6vh; }
.ts { width: min(720px, 94vw); max-height: 88vh; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
header { display: flex; align-items: center; margin-bottom: 10px; }
h2 { margin: 0; font-size: 15px; flex: 1; }
h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; }
h3 .hint { font-weight: 400; }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.line { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
input:not([type='color']) { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 8px; font: inherit; min-width: 0; }
.icon-in { width: 44px; text-align: center; }
.name-in { flex: 1; font-weight: 600; }
input[type='color'] { width: 30px; height: 26px; padding: 0; border: 1px solid var(--border-main); background: none; }
.fld { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.fld label { font-size: 11px; color: var(--text-muted); }
.fld input { width: 100%; box-sizing: border-box; }
.hint { color: var(--text-faint); }
.info { color: var(--text-muted); font-size: 12px; margin: 0 0 8px; line-height: 1.4; }
.mono { font-family: var(--font-mono, monospace); font-size: 11px; }

.schema { margin: 12px 0; padding: 10px; border: 1px solid var(--border-main); border-radius: 6px; }
.field-list { display: flex; flex-direction: column; }
.fitem { border-radius: 4px; }
.fitem.lifted { background: var(--controls-bg); box-shadow: var(--card-shadow-drag); position: relative; z-index: 1; }
.fitem.open { background: var(--controls-bg); }
.frow { display: flex; align-items: center; gap: 6px; padding: 3px 4px; min-height: 26px; }
.grip { color: var(--text-faint); cursor: grab; user-select: none; letter-spacing: -2px; padding: 0 2px; }
.grip:hover, .lifted .grip { color: var(--accent); }
.field-list.dragging { cursor: grabbing; }
.field-list.dragging .grip { cursor: grabbing; }
.star { color: transparent; width: 12px; text-align: center; }
.star.on { color: var(--warning); }
.fname { font-weight: 500; }
.ftype { color: var(--text-secondary); }
.fsum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv, .gear { background: none; border: 1px solid transparent; border-radius: 3px; color: var(--text-muted); cursor: pointer; padding: 0 5px; font: inherit; line-height: 1.4; }
.mv:hover:not(:disabled), .gear:hover, .gear.on { color: var(--accent); border-color: var(--accent); }
.mv:disabled { opacity: 0.3; cursor: default; }
.fopen { padding: 6px 8px 8px 30px; }
.fadd { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-main); }
/* The FLIP: rows slide to their new place. */
.fl-move { transition: transform 0.18s ease; }
.fl-enter-active { transition: opacity 0.15s ease; }
.fl-enter-from { opacity: 0; }
.fl-leave-active { position: absolute; opacity: 0; }

footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-main); }
.danger { background: none; border: 1px solid var(--border-main); color: var(--danger); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
</style>
