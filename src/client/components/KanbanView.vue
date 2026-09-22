<!--
  A KANBAN BOARD over a table: one column per value of a field, cards in them.

  It is a VIEW (contract/views.ts, `config.kanban`): filters, sort and hidden fields
  from the same toolbar apply — they choose and order the cards and decide what a
  card shows. What is here is only the columns, the drag, and "+" per column.

  Columns come only from a SINGLE-VALUED field — a select, or a link ticked "single" —
  so every card is in exactly one column and a drag has one meaning: it MOVES the
  card (one batch, one Ctrl+Z). Dropping on "(none)" clears the value.

  Dragging uses client/recordDrag.ts (pointer events, not HTML5 drop — the desktop
  client claims those). Each column is a drop target.
-->
<template>
  <div class="kanban" :class="{ dragging: dragFrom !== null }">
    <div v-for="c in columns" :key="c.key" class="kcol" :class="{ none: c.value.kind === 'empty', over: overKey === c.key }" :ref="(el) => colRef(c.key, el as HTMLElement | null)">
      <header class="kcol-head">
        <span class="kcol-label" :title="c.label">{{ c.label }}</span>
        <span class="kcol-count">{{ c.records.length }}</span>
        <button class="kcol-add" :title="c.value.kind === 'empty' ? 'Add a record with nothing here' : `Add a record in “${c.label}”`" @click="$emit('create', c.value)">+</button>
      </header>
      <div class="kcol-body">
        <article v-for="r in c.records" :key="r.id" class="kcard" :class="{ lifted: dragIds.has(r.id) && dragFrom !== null }"
                 @pointerdown="startDrag(r, c.key, $event)" @dblclick="$emit('open-record', r.id)">
          <div class="kcard-title">{{ labelOf(r) }}<button class="kcard-open" title="Open record" @pointerdown.stop @click.stop="$emit('open-record', r.id)">⤢</button></div>
          <div v-for="f in cardFields" :key="f.id" class="kcard-row">
            <span class="kcard-name">{{ f.name }}</span><span class="kcard-val">{{ valueText(r, f) }}</span>
          </div>
        </article>
        <p v-if="!c.records.length" class="kcol-empty">drop here</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Store } from '../store';
import type { FieldRow, RecordRow } from '../state';
import { useDerived } from '../derived';
import { beginRecordDrag, registerDropTarget } from '../recordDrag';
import { addLink } from '../links';
import { kanbanColumns, type GroupValue } from '../../contract/views';
import { richTextToPlain } from '../../contract/richtext';
import { formatNumberField, shapeOf, summarise } from '../../contract/shapes';

const props = defineProps<{
  store: Store;
  /** Already filtered and sorted by the view. */
  records: RecordRow[];
  field: FieldRow;
  /** The fields a card shows under its title (the view's "shown" fields, minus the primary). */
  cardFields: FieldRow[];
  primary: FieldRow | undefined;
}>();
const emit = defineEmits<{ 'open-record': [id: string]; create: [value: GroupValue] }>();
const derived = useDerived(props.store);

// A link field's columns are its TARGET table's records: make sure they are loaded.
const targetTable = computed(() => (props.field.type === 'link' ? String(props.field.options?.target_table_id ?? '') : ''));
watch(targetTable, (t) => { if (t) void props.store.loadTable(t); }, { immediate: true });

const targets = computed(() => {
  if (!targetTable.value) return [];
  return [...props.store.state.records.values()].filter((r) => r.table_id === targetTable.value)
    .map((r) => ({ id: r.id, label: derived.labelOfId(r.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
});
const columns = computed(() => kanbanColumns(props.records, props.field, (rid, fid) => derived.linksFrom(rid, fid), targets.value));

const labelOf = (r: RecordRow) => (props.primary ? valueText(r, props.primary) : '') || '(untitled)';
function valueText(r: RecordRow, f: FieldRow): string {
  if (f.type === 'link') return derived.linksFrom(r.id, f.id).map((id) => derived.labelOfId(id)).join(', ');
  if (f.type === 'lookup' || f.type === 'backlink') return derived.textOf(r.id, f).texts.join(', ');
  const v = r.data[f.key];
  if (v === undefined || v === null) return '';
  if (f.type === 'rich_text') return richTextToPlain(v).split('\n', 1)[0];
  if (f.type === 'structured') return summarise(shapeOf(f), v);
  if (f.type === 'attachment') return Array.isArray(v) ? `${v.length} file${v.length === 1 ? '' : 's'}` : '';
  return formatNumberField(f, v) ?? (typeof v === 'boolean' ? (v ? 'yes' : 'no') : Array.isArray(v) ? v.join(', ') : String(v));
}

/* ── drag ── */
const colEls = new Map<string, HTMLElement>();
const unregister = new Map<string, () => void>();
function colRef(key: string, el: HTMLElement | null) {
  if (el && colEls.get(key) !== el) {
    colEls.set(key, el);
    unregister.get(key)?.();
    unregister.set(key, registerDropTarget(el, (records) => dropInto(key, records)));
  } else if (!el) { unregister.get(key)?.(); unregister.delete(key); colEls.delete(key); }
}
onUnmounted(() => { for (const u of unregister.values()) u(); });

const dragFrom = ref<string | null>(null);
const dragIds = ref(new Set<string>());
const overKey = ref('');
function startDrag(r: RecordRow, fromKey: string, e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return;
  dragIds.value = new Set([r.id]);
  beginRecordDrag(() => { dragFrom.value = fromKey; return [r]; }, e, () => labelOf(r));
  const track = (ev: PointerEvent) => {
    if (dragFrom.value === null) return;
    overKey.value = [...colEls.entries()].find(([, el]) => { const b = el.getBoundingClientRect(); return ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom; })?.[0] ?? '';
  };
  // Bubble phase, registered AFTER the drag service's own pointerup: the drop (which
  // needs `dragFrom`) runs first, this cleanup second. Capture would run before it.
  const end = () => { dragFrom.value = null; overKey.value = ''; window.removeEventListener('pointerup', end); window.removeEventListener('pointermove', track); };
  window.addEventListener('pointermove', track);
  window.addEventListener('pointerup', end);
}
watch(dragFrom, (k) => { if (k === null) overKey.value = ''; });

/** MOVE `records` into column `toKey`: one value per record, so set it (or clear it). */
function dropInto(toKey: string, records: RecordRow[]) {
  const from = columns.value.find((c) => c.key === dragFrom.value);
  const to = columns.value.find((c) => c.key === toKey);
  dragFrom.value = null;
  if (!to || (from && from.key === to.key)) return;
  const f = props.field;
  for (const r of records) {
    if (f.type === 'link') {
      if (to.value.kind === 'links') addLink(props.store, f.id, r.id, to.value.ids[0]);       // single: addLink replaces
      else for (const id of derived.linksFrom(r.id, f.id)) props.store.mutate({ type: 'link.remove', fieldId: f.id, fromRecord: r.id, toRecord: id });
    } else if (to.value.kind === 'value') {
      props.store.mutate({ type: 'record.update', id: r.id, set: { [f.key]: to.value.value }, unset: [] });
    } else {
      props.store.mutate({ type: 'record.update', id: r.id, set: {}, unset: [f.key] });
    }
  }
}
</script>

<style scoped>
.kanban { display: flex; gap: 10px; padding: 10px 12px; overflow-x: auto; height: 100%; box-sizing: border-box; align-items: flex-start; }
.kcol { flex: 0 0 240px; display: flex; flex-direction: column; max-height: 100%; background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px; }
.kcol.over { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.kcol.none { border-style: dashed; }
.kcol-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border-main); font-size: 12px; }
.kcol-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.kcol.none .kcol-label { color: var(--text-faint); font-style: italic; font-weight: 400; }
.kcol-count { color: var(--text-muted); font-size: 11px; background: var(--bg-app); border-radius: 8px; padding: 0 6px; }
.kcol-add { background: none; border: 1px solid transparent; border-radius: 3px; color: var(--text-muted); cursor: pointer; font: inherit; padding: 0 5px; }
.kcol-add:hover { color: var(--accent); border-color: var(--accent); }
.kcol-body { overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 6px; min-height: 48px; }
.kcard { background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 4px; padding: 6px 8px; cursor: grab; user-select: none; font-size: 12px; }
.kcard.lifted { opacity: 0.4; }
.kcard-title { display: flex; align-items: center; gap: 4px; font-weight: 600; margin-bottom: 2px; }
.kcard-title span, .kcard-title { overflow: hidden; }
.kcard-open { visibility: hidden; margin-left: auto; background: none; border: none; color: var(--accent); cursor: pointer; font-size: 11px; padding: 0 2px; }
.kcard:hover .kcard-open { visibility: visible; }
.kcard-row { display: flex; gap: 6px; font-size: 11px; line-height: 1.5; min-width: 0; }
.kcard-name { color: var(--text-faint); flex: 0 0 auto; }
.kcard-val { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kcol-empty { margin: 0; color: var(--text-faint); font-size: 11px; text-align: center; padding: 8px; }
.kanban.dragging .kcol-empty { color: var(--text-muted); }
</style>
