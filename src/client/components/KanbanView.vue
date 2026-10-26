<!--
  A KANBAN BOARD over a table: one column per value of a field, cards in them.

  It is a VIEW (contract/views.ts, `config.kanban`): filters, sort and hidden fields
  from the same toolbar apply — they choose and order the cards and decide what a
  card shows. What is here is only the columns, the drag, and "+" per column.

  Columns ("stacks") come only from a SINGLE-VALUED field — a select, a link ticked
  "single", or a text-like / number field (one stack per distinct value) — so every
  card is in exactly one and a drag has one meaning: it MOVES the card (one batch,
  one Ctrl+Z), writing the stack's value. Dropping on "(none)" clears the value.

  Which stacks are DRAWN is `visibleColumns`: empty ones only when hide-empty is off
  and nothing is being searched for (VIEWS-BRIEF.md A3–A4).

  Dragging uses client/recordDrag.ts (pointer events, not HTML5 drop — the desktop
  client claims those). Each column is a drop target.
-->
<template>
  <div class="kanban" :class="{ dragging: dragFrom !== null }">
    <p v-if="!shownColumns.length" class="kanban-nothing">{{ searching ? 'Nothing matches the search.' : 'No cards.' }}</p>
    <div v-for="c in shownColumns" :key="c.key" class="kcol" :class="{ none: c.value.kind === 'empty', over: overKey === c.key }" :ref="(el) => colRef(c.key, el as HTMLElement | null)">
      <header class="kcol-head">
        <span class="kcol-label" :title="c.label">{{ c.label }}</span>
        <span class="kcol-count">{{ c.records.length }}</span>
        <button class="kcol-add" :title="c.value.kind === 'empty' ? 'Add a record with nothing here' : `Add a record in “${c.label}”`" @click="$emit('create', c.value)">+</button>
      </header>
      <div class="kcol-body">
        <article v-for="r in c.records" :key="r.id" class="kcard" :class="{ lifted: dragIds.has(r.id) && dragFrom !== null, opened: r.id === openId }"
                 @pointerdown="startDrag(r, c.key, $event)" @dblclick="$emit('open-record', r.id)" @contextmenu="onCardMenu(r.id, $event)">
          <div class="kcard-title">{{ labelOf(r) }}<button class="kcard-open" title="Open record" @pointerdown.stop @click.stop="$emit('open-record', r.id)">⤢</button></div>
          <div v-for="f in cardFields" :key="f.id" class="kcard-row">
            <span class="kcard-name">{{ f.name }}</span>
            <!-- Linked records are PILLS here too (RecordPill.vue): a double-click opens the
                 record the pill names — not this card's, which a double-click anywhere else
                 on the card opens; a press
                 must not start the card drag. A field shown as a count is one pill. -->
            <span v-if="derived.countOf(r.id, f)?.n" class="kcard-val pills">
              <RecordPill :n="derived.countOf(r.id, f)!.n" :text="derived.countOf(r.id, f)!.noun" :title="derived.countOf(r.id, f)!.title"
                          :back="f.type === 'backlink' && !derived.junctionOfBacklink(f)" :color="derived.pillColorOf(f)" @open="$emit('open-record', r.id)" />
            </span>
            <span v-else-if="!derived.countOf(r.id, f) && linkedIds(r, f).length" class="kcard-val pills">
              <RecordPill v-for="(id, i) in linkedIds(r, f)" :key="id + i" :text="linkedTexts(r, f)[i] ?? ''" :back="f.type === 'backlink' && !derived.junctionOfBacklink(f)"
                          :junction="f.type === 'backlink' && !!derived.junctionOfBacklink(f)" :status="pairStatus(f, id)" :color="derived.pillColorOf(f)"
                          @open="$emit('open-record', namedBy(f, id))" @edit="$emit('open-record', id)" />
            </span>
            <span v-else class="kcard-val">{{ valueText(r, f) }}</span>
            <VerdictMark v-if="verdictOf(r.id, f.id)" class="kcard-verdict" :kind="verdictOf(r.id, f.id)!.ok ? 'ok' : 'warn'" :title="verdictOf(r.id, f.id)!.title" />
          </div>
        </article>
        <p v-if="!c.records.length" class="kcol-empty">drop here</p>
      </div>
    </div>
    <!-- A card's menu: only where it has something to offer (the Resolve tool, in the
         desktop app); elsewhere a right-click is left to the browser. The look is the
         shared `.ctx` (App.vue), fixed in the page's pixels like the grid's row menu. -->
    <div v-if="cardMenu" ref="cardMenuEl" class="ctx kcard-menu" :style="{ left: cardMenu.x + 'px', top: cardMenu.y + 'px' }"
         @contextmenu.prevent.stop @mousedown.stop @pointerdown.stop>
      <div class="ctx-head">{{ derived.labelOfId(cardMenu.id) || 'untitled' }}</div>
      <hr />
      <button class="open-record" @click="cardMenuDo((id) => $emit('open-record', id))">Open record</button>
      <button class="resolve-ingest" @click="cardMenuDo((id) => ingestFromResolve(props.store, id, derived.labelOfId(id)))">Ingest info from Resolve…</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { vp } from '../uiScale';
import { ingestFromResolve, resolveOffered } from '../tools/resolveIngest';
import type { Store } from '../store';
import type { FieldRow, RecordRow } from '../state';
import { useDerived } from '../derived';
import { beginRecordDrag, registerDropTarget } from '../recordDrag';
import { addLink } from '../links';
import RecordPill from './RecordPill.vue';
import VerdictMark from './VerdictMark.vue';
import { kanbanColumns, visibleColumns, type GroupValue } from '../../contract/views';
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
  /** The record open in the tray, or '' — its card is marked. */
  openId?: string;
  /** The records the view lets through BEFORE the quick search: where text/number stacks come from. */
  universe?: RecordRow[];
  /** Draw no stack without cards (the view's `kanban.hideEmpty`, or its default). */
  hideEmpty?: boolean;
  /** The quick-search box is not empty: stacks with no matches are not drawn. */
  searching?: boolean;
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
const columns = computed(() => kanbanColumns(props.records, props.field, (rid, fid) => derived.linksFrom(rid, fid), targets.value, props.universe));
const shownColumns = computed(() => visibleColumns(columns.value, { hideEmpty: !!props.hideEmpty, searching: !!props.searching }));

const verdictOf = (recordId: string, fieldId: string) => derived.fieldVerdicts(recordId).get(fieldId);
const labelOf = (r: RecordRow) => (props.primary ? valueText(r, props.primary) : '') || '(untitled)';
/** The records behind a link / backlink / junction-column row, and their pill texts (same order). */
function linkedIds(r: RecordRow, f: FieldRow): string[] {
  if (f.type === 'link') return derived.linksFrom(r.id, f.id);
  if (f.type !== 'backlink') return [];
  // A junction column's pill opens the PAIR row; a plain backlink's the record holding the link.
  return derived.backlinkOf(r.id, f) ?? [];
}
/** What a pill NAMES, and so what it opens: for a junction's pair row, the record at its other end; else the id itself. */
function namedBy(f: FieldRow, id: string): string {
  const j = f.type === 'backlink' ? derived.junctionOfBacklink(f) : null;
  return (j && derived.junctionChip(id, j.side).other) || id;
}
/** A junction column's pill is a pair: its status, drawn as the pill's second segment. */
function pairStatus(f: FieldRow, rowId: string): string | undefined {
  const j = f.type === 'backlink' ? derived.junctionOfBacklink(f) : null;
  return j ? derived.junctionChip(rowId, j.side).status : undefined;
}
function linkedTexts(r: RecordRow, f: FieldRow): string[] {
  if (f.type === 'link') return derived.linksFrom(r.id, f.id).map((id) => derived.labelOfId(id));
  return derived.textOf(r.id, f).texts;
}
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

/* ── the card menu ── */
const cardMenu = ref<{ id: string; x: number; y: number } | null>(null);
const cardMenuEl = ref<HTMLElement>();
function onCardMenu(id: string, e: MouseEvent) {
  if (!resolveOffered(props.store, id)) return;           // nothing to offer: the browser's own menu
  e.preventDefault();
  cardMenu.value = { id, x: vp(e.clientX), y: vp(e.clientY) };
}
/** Close the menu, THEN act (as the grid's `rowMenuDo` and the canvas's `menuDo` do). */
function cardMenuDo(fn: (id: string) => void) { const m = cardMenu.value; cardMenu.value = null; if (m) fn(m.id); }
const closeOnOutside = (e: Event) => { if (cardMenu.value && !cardMenuEl.value?.contains(e.target as Node)) cardMenu.value = null; };
const closeOnEscape = (e: KeyboardEvent) => { if (e.key === 'Escape' && cardMenu.value) { cardMenu.value = null; e.stopPropagation(); } };
const closeMenu = () => { cardMenu.value = null; };
onMounted(() => {
  document.addEventListener('mousedown', closeOnOutside, true);
  document.addEventListener('keydown', closeOnEscape, true);
  window.addEventListener('blur', closeMenu); window.addEventListener('resize', closeMenu);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', closeOnOutside, true);
  document.removeEventListener('keydown', closeOnEscape, true);
  window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu);
});

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
.kcard-menu { position: fixed; z-index: 60; }
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
/* The record open in the tray — the same solid ring a canvas card wears (RecordCard.vue). */
.kcard.opened { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.kcard-title { display: flex; align-items: center; gap: 4px; font-weight: 600; margin-bottom: 2px; }
.kcard-title span, .kcard-title { overflow: hidden; }
.kcard-open { visibility: hidden; margin-left: auto; background: none; border: none; color: var(--accent); cursor: pointer; font-size: 11px; padding: 0 2px; }
.kcard:hover .kcard-open { visibility: visible; }
.kcard-row { display: flex; gap: 6px; font-size: 11px; line-height: 1.5; min-width: 0; }
.kcard-name { color: var(--text-faint); flex: 0 0 auto; }
.kcard-val { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Pills on a board card: the card's smaller line, and the row's whole width (the room a pill's floating actions use). */
.kcard-val.pills { flex: 1; }
.kcard-val :deep(.pill) { font-size: 11px; line-height: 16px; }
.kcard-verdict { margin-left: auto; }
.kanban-nothing { margin: 0; color: var(--text-faint); font-size: 12px; padding: 8px; }
.kcol-empty { margin: 0; color: var(--text-faint); font-size: 11px; text-align: center; padding: 8px; }
.kanban.dragging .kcol-empty { color: var(--text-muted); }
</style>
