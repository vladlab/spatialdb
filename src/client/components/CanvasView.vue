<!--
  The canvas.

  Structure follows viznotes' CanvasView: a container that owns pointer input, a
  dot-grid background, a transformed world holding the cards, and an SVG layer
  under them for the connections. What differs is where state lives — every
  position here comes from `placements` in the store, and every change leaves as a
  mutation.
-->
<template>
  <!-- The CONTEXT BAR sits above the canvas, not over it: everything that acts on
       the canvas tab lives directly under the tabs (App.vue), and the canvas's own
       rectangle — which drops, zoom-at-cursor and "fit" all measure — is exactly the
       drawing surface and nothing else. -->
  <div class="canvas-view">
    <div class="canvas-controls context-bar" @pointerdown.stop>
      <button
        :class="{ active: viewport.scrollMode.value === 'mouse' }"
        :title="viewport.scrollMode.value === 'mouse'
          ? 'Mouse: scroll zooms (click for touchpad)'
          : 'Touchpad: scroll pans (click for mouse)'"
        @click="toggleScrollMode"
      >{{ viewport.scrollMode.value === 'mouse' ? 'mouse' : 'pad' }}</button>
      <span class="sep" />
      <button @click="viewport.zoomOut()" title="Zoom out">−</button>
      <span class="zoom">{{ viewport.zoomPercent.value }}%</span>
      <button @click="viewport.zoomIn()" title="Zoom in">+</button>
      <button @click="viewport.resetZoom()" title="Reset to 100%">1:1</button>
      <button @click="fitAll" title="Fit all cards">fit</button>
      <span class="sep" />
      <!-- Which RELATIONAL arrows are drawn. A viewing preference, kept in this
           browser — see contract/canvasConfig.ts for why it is not shared. -->
      <button class="arrows-mode" :title="ARROW_MODE_TITLE[arrowMode]" @click="cycleArrowMode">
        arrows: {{ arrowMode }}
      </button>
      <button class="arrows-legend" :class="{ active: legendOpen }" :disabled="!legend.length"
              title="Which relationships are drawn — also the colour legend" @click="legendOpen = !legendOpen">▾</button>
      <div v-if="legendOpen" class="legend" @pointerdown.stop>
        <label v-for="l in legend" :key="l.id" class="legend-row">
          <input type="checkbox" :checked="!l.hidden" @change="toggleFieldArrows(l.id)" />
          <span class="legend-swatch" :style="{ background: l.color || 'var(--arrow)' }" />
          <span class="legend-label">{{ l.label }}</span>
          <span class="legend-n">{{ l.n }}</span>
        </label>
        <p class="legend-note">Colour and direction are set on the link field (⚙ on its column). Shown/hidden is just for you, on this canvas.</p>
      </div>
      <span class="sep" />
      <button :disabled="!selected.size" @click="unplaceSelected">
        unplace{{ selected.size > 1 ? ` ${selected.size}` : '' }}
      </button>
    </div>

    <!-- WHAT A NEW RECORD HERE STARTS OUT LINKED TO. Always visible, because the whole
         point is that nobody should have to wonder: the canvas's own DEFAULTS (set here,
         by pointing), plus the project scope from the breadcrumb, which applies on top.
         The switch turns the canvas's defaults off for YOU, in this browser — the list
         itself is saved with the canvas, for everyone. -->
    <div class="defaults-bar" :class="{ off: !defaultsOn }" @pointerdown.stop>
      <label class="defaults-switch" :title="defaultsOn ? 'New records on this canvas are linked to these. Click to switch that off (for you, here).' : 'Switched off — new records are not linked to these.'">
        <input type="checkbox" :checked="defaultsOn" :disabled="!defaults.length" @change="defaultsOn = ($event.target as HTMLInputElement).checked" />
        <span class="defaults-label">New records here →</span>
      </label>
      <span v-if="scopeChip" class="dchip scope" :title="`From the scope in the breadcrumb — applies to tables that belong to ${scopeChip.table}`">{{ scopeChip.label }} <i>scope</i></span>
      <span v-for="d in defaults" :key="d.recordId" class="dchip" :class="{ missing: d.missing }"
            :title="d.missing ? 'This record no longer exists — remove it' : `${d.table}: new records whose table links to ${d.table} get this one`">
        <span class="dchip-table">{{ d.table }}</span>{{ d.label }}
        <button class="dchip-x" title="Stop linking new records to this" @click="removeDefault(d.recordId)">×</button>
      </span>
      <span v-if="!defaults.length && !scopeChip" class="defaults-none">nothing — new records start unlinked</span>
      <button class="defaults-add" title="Choose a record that everything created on this canvas should be linked to" @click="addingDefault = !addingDefault">+ add</button>
      <span v-for="a in defaultAmbiguities" :key="a" class="defaults-warn" title="A new record of that table will NOT be linked: it has more than one link to the same table, and none (or several) is ticked “membership”. An admin can tick one, in that link field's ⚙ settings.">⚠ {{ a }}</span>

      <div v-if="addingDefault" class="defaults-pop" @keydown.stop>
        <select class="defaults-table" :value="addTable" @change="addTable = ($event.target as HTMLSelectElement).value">
          <option value="" disabled>link new records to a record of…</option>
          <option v-for="t in linkableTables" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <LinkPicker v-if="addTable" :key="addTable" inline :store="store" :target-table-id="addTable" :linked="defaults.filter((d) => d.tableId === addTable).map((d) => d.recordId)"
                    @add="addDefault(addTable, $event)" @remove="removeDefault($event)" @done="addingDefault = false" />
      </div>
    </div>
  <div
    ref="containerRef"
    class="canvas-container"
    :class="{ panning: viewport.isPanning.value || spaceHeld }"
    tabindex="0"
    @wheel.prevent="viewport.onWheel"
    @pointerdown="onCanvasPointerDown"
    @pointermove="onCanvasPointerMove"
    @pointerup="viewport.onPointerUp"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
    @dblclick="onCanvasDblClick"
    @contextmenu.prevent="onCanvasMenu"
  >
    <div class="canvas-grid" :style="viewport.gridStyle.value" />

    <!-- Under the cards, sharing their transform. -->
    <ArrowLayer
      :transform="viewport.transform"
      :links="visibleLinks"
      :rects="cardRects"
      :ports="cardPorts"
      :styles="arrowStyles"
      :highlight-id="hoveredId"
      :selected-key="selectedLinkKey"
      :field-names="linkFieldNames"
      :rubber="rubber"
      @select="selectLink"
      @menu="onLinkMenu"
    />

    <div class="canvas-world" :style="{ transform: viewport.transformCSS.value }">
      <RecordCard
        v-for="c in cards"
        :key="c.recordId"
        v-bind="c"
        :store="store"
        :selected="selected.has(c.recordId)"
        :dragging="drag.draggingIds.value.has(c.recordId)"
        :unconfirmed="store.unconfirmed.value.has(c.recordId)"
        :link-target="linkTargetState(c.recordId, c.tableId)"
        @pointerdown="onCardPointerDown"
        @link-start="startLinkDrag"
        @resize="onCardResize"
        @unplace="unplace"
        @fold="toggleFold"
        @open="(id) => (isBoardRecord(id) ? $emit('open-board', id) : $emit('open-record', id))"
        @menu="onCardMenu"
        @hover="hoveredId = $event"
      />
    </div>

    <!-- Rubber band, drawn in screen space outside the transform. -->
    <div
      v-if="boxSelect.displayRect.value"
      class="selection-box"
      :style="{
        left: `${boxSelect.displayRect.value.left}px`,
        top: `${boxSelect.displayRect.value.top}px`,
        width: `${boxSelect.displayRect.value.width}px`,
        height: `${boxSelect.displayRect.value.height}px`,
      }"
    />


    <!-- Context menu / table chooser / card-fields chooser: one floating panel,
         screen-space, closed by any click outside it. -->
    <div v-if="menu" class="ctx" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
         @pointerdown.stop @dblclick.stop @contextmenu.prevent.stop @keydown.stop>
      <!-- AN ARROW. Removing a link from the canvas is deliberately three steps — select,
           right-click, confirm — because an arrow is a thin thing to hit by accident and
           what goes is DATA, not a drawing. (It is undoable all the same.) -->
      <template v-if="menu.kind === 'link' && menu.link">
        <div class="ctx-head">{{ linkFieldNames.get(menu.link.field_id) ?? 'link' }}</div>
        <div class="ctx-sub">{{ derived.labelOfId(menu.link.from_record) }} → {{ derived.labelOfId(menu.link.to_record) }}</div>
        <hr />
        <button class="danger remove-link" @click="menuDo((m) => removeLink(m.link!))">Remove this link…</button>
      </template>
      <template v-else-if="menu.kind === 'card'">
        <!-- A board placed on a board: this is how you walk from one canvas to another. -->
        <button v-if="isBoardRecord(menu.recordId!)" class="open-board" @click="menuDo((m) => $emit('open-board', m.recordId!))">▦ Open this board</button>
        <button @click="menuDo((m) => $emit('open-record', m.recordId!))">Open record</button>
        <button @click="menuDo((m) => toggleFold(m.recordId!))">{{ isCollapsed(menu.recordId!) ? 'Unfold' : 'Fold' }}</button>
        <button @click="menu = { ...menu, kind: 'fields' }">Fields on {{ tableNameOf(menu.recordId!) }} cards…</button>
        <!-- The easy way to set a canvas default: drop the Ep 101 card here, and point at it. -->
        <button v-if="isDefault(menu.recordId!)" class="unset-default" @click="menuDo((m) => removeDefault(m.recordId!))">Stop linking new records here to this</button>
        <button v-else-if="canBeDefault(menu.recordId!)" class="set-default" @click="menuDo((m) => addDefault(store.state.records.get(m.recordId!)!.table_id, m.recordId!))">Link new records here to this</button>
        <hr />
        <button @click="menuDo((m) => unplace(m.recordId!))">Remove from canvas</button>
        <button class="danger" @click="menuDo((m) => deleteRecord(m.recordId!))">Delete record…</button>
      </template>

      <template v-else-if="menu.kind === 'canvas' || menu.kind === 'create'">
        <p class="ctx-title">New record here, in…</p>
        <button v-for="t in tablesForCreate" :key="t.id" class="create-in" @click="menuDo((m) => createAt(t.id, m.wx, m.wy))">
          <span class="swatch" :style="{ background: colorOf(t.id) }" />{{ t.name }}
        </button>
        <p v-if="!tablesForCreate.length" class="ctx-note">No tables yet — make one in the table tab.</p>
        <template v-if="menu.kind === 'canvas'">
          <hr />
          <button @click="menuDo(() => fitAll())">Fit all cards</button>
        </template>
      </template>

      <template v-else-if="menu.kind === 'fields'">
        <p class="ctx-title">{{ tableNameOf(menu.recordId!) }} cards on this canvas show</p>
        <label v-for="f in fieldChoices" :key="f.id" class="ctx-check">
          <input type="checkbox" :checked="f.on" @change="toggleCardField(f.id)" /> {{ f.name }}
        </label>
        <p class="ctx-note">The title is always the primary field (★ in the grid).</p>
        <button v-if="hasCustomFields" @click="resetCardFields">Reset to default</button>
      </template>
    </div>

  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { Store } from '../store';
import { fieldsOf, tablesSorted, type FieldRow, type RecordRow } from '../state';
import { labelFrom } from '../../contract/labels';
import { useDerived } from '../derived';
import { defaultLinkField } from '../../contract/canvasConfig';
import LinkPicker from './LinkPicker.vue';
import { confirmDialog } from '../dialogs';
import { SCOPE } from '../scope';
import { isEmptyRichText, richTextToPlain } from '../../contract/richtext';
import { formatNumberField, shapeOf, summarise } from '../../contract/shapes';
import { registerDropTarget } from '../recordDrag';
import { arrowStyleOf, type ArrowStyle } from '../../contract/arrows';
import { backlinkSourceOf } from '../../contract/backlinks';
import type { ArrowLink, CardPorts } from './ArrowLayer.vue';
import { linkKey } from '../state';
import { bezierPath, type Point } from '../canvas/geometry';
import { CanvasConfig, cardFieldsFor } from '../../contract/canvasConfig';
import { CARD_W, effectiveHeight, rowPortY } from '../canvas/cardLayout';
import type { CardRow } from './RecordCard.vue';
import type { Rect } from '../canvas/geometry';
import { useViewport } from '../canvas/useViewport';
import { useCardDrag } from '../canvas/useCardDrag';
import { useBoxSelection, useCardResize } from '../canvas/useCardResize';
import ArrowLayer from './ArrowLayer.vue';
import RecordCard from './RecordCard.vue';

const props = defineProps<{ store: Store; canvasId: string }>();
const emit = defineEmits<{ 'open-record': [recordId: string]; 'open-board': [recordId: string] }>();
const isBoardRecord = (id: string) => store.state.tables.get(store.state.records.get(id)?.table_id ?? '')?.kind === 'canvas';
const store = props.store;

const containerRef = ref<HTMLElement | null>(null);
const selected = reactive(new Set<string>());
const hoveredId = ref<string | null>(null);
const spaceHeld = ref(false);

const viewport = useViewport(containerRef);

/* ── derived view of the store ───────────────────────────────────────────── */

const placements = computed(() =>
  [...store.state.placements.values()].filter((p) => p.canvas_id === props.canvasId));

/* ── what a card says ─────────────────────────────────────────────────────

   A card is a title plus a few lines of TEXT. Turning values into text happens
   here rather than in RecordCard because half of it needs the store: a link's
   text is the labels of the records it points at, a lookup's is computed across
   a link (contract/lookups.ts). RecordCard stays a dumb renderer of strings. */

const derived = useDerived(store);
const scopeApi = inject(SCOPE, null);
const labelKeys = derived.labelKeys;
const canvasConfig = computed(() => store.state.canvases.get(props.canvasId)?.config);
const labelOf = (r: RecordRow) => labelFrom(r.data, labelKeys.value.get(r.table_id), r.id.slice(0, 8));

function rowFor(rec: RecordRow, f: FieldRow): CardRow {
  if (f.type === 'link' || f.type === 'lookup' || f.type === 'backlink') {
    const { texts, broken } = derived.textOf(rec.id, f);
    // A port row wears its relationship's colour (a backlink wears the colour of
    // the link field it mirrors — they are the two ends of the same arrows).
    const styleField = f.type === 'link' ? f.id : f.type === 'backlink' ? backlinkSourceOf(f) : null;
    const color = styleField ? arrowStyles.value.get(styleField)?.color : undefined;
    return broken ? { id: f.id, name: f.name, broken: true, text: `broken ${f.type}` }
      : { id: f.id, name: f.name, derived: true, text: texts.join(', '), color, link: f.type === 'link' };
  }
  if (f.type === 'rich_text') return { id: f.id, name: f.name, text: richTextToPlain(rec.data[f.key]).split('\n', 1)[0] };
  // A structured value is a one-line SUMMARY on a card ("4 tracks / 12 ch (5.1, 2.0…)"):
  // a card's rows are fixed-height, and the full thing lives in the tray.
  if (f.type === 'structured') return { id: f.id, name: f.name, text: summarise(shapeOf(f), rec.data[f.key]) };
  if (f.type === 'attachment') {
    const n = Array.isArray(rec.data[f.key]) ? (rec.data[f.key] as unknown[]).length : 0;
    return { id: f.id, name: f.name, text: n ? `${n} file${n === 1 ? '' : 's'}` : '' };
  }
  const v = rec.data[f.key];
  const formatted = formatNumberField(f, v);
  if (formatted !== null) return { id: f.id, name: f.name, text: formatted };
  const text = v === undefined || v === null || v === '' ? ''
    : typeof v === 'boolean' ? (v ? 'yes' : 'no')
    : Array.isArray(v) ? v.join(', ')
    // One line per row, always: the first line of a long text, not all of it.
    : String(v).split('\n', 1)[0];
  return { id: f.id, name: f.name, text };
}

/** The fields a card of this table shows on THIS canvas. */
/**
 * A card's fields come in two kinds (canvas/cardLayout.ts):
 *   ROWS    every shown field except rich text — one fixed-height line each. The same
 *           list for every card of a table, so a field's row INDEX (what ports are
 *           computed from) never depends on the record.
 *   BLOCKS  shown rich_text fields THAT HAVE A NOTE, under the rows: formatted, with
 *           images, in a fixed-height window. A record without a note gets no block
 *           — and no empty 150px hole — which only changes its height, not its rows.
 */
const rowFields = (tableId: string) => shownFields(tableId).filter((f) => f.type !== 'rich_text');
const richBlocks = (rec: RecordRow) => shownFields(rec.table_id)
  .filter((f) => f.type === 'rich_text' && !isEmptyRichText(rec.data[f.key]))
  .map((f) => ({ id: f.id, name: f.name, value: rec.data[f.key] }));

function shownFields(tableId: string): FieldRow[] {
  const all = fieldsOf(store.state, tableId);
  const primaryKey = labelKeys.value.get(tableId);
  return cardFieldsFor(canvasConfig.value, tableId, all, all.find((f) => f.key === primaryKey)?.id);
}

const cards = computed(() =>
  placements.value.flatMap((p) => {
    const rec = store.state.records.get(p.record_id);
    if (!rec) return [];   // placement without its record: mid-sync, skip a frame
    const table = store.state.tables.get(rec.table_id);
    return [{
      recordId: p.record_id,
      tableId: rec.table_id,
      tableName: table?.name ?? 'unknown',
      tableColor: colorOf(rec.table_id),
      title: labelFrom(rec.data, labelKeys.value.get(rec.table_id), ''),
      rows: rowFields(rec.table_id).map((f) => rowFor(rec, f)),
      rich: richBlocks(rec),
      collapsed: p.collapsed,
      x: p.x, y: p.y, w: p.w, h: p.h, z: p.z,
    }];
  }));

/**
 * World rects, for arrows and box selection — from the SAME function RecordCard
 * sizes itself with (canvas/cardLayout.ts), so an arrow meets the edge that is
 * actually drawn without anything measuring the DOM.
 */
const cardRects = computed(() => {
  const m = new Map<string, Rect>();
  for (const c of cards.value) {
    m.set(c.recordId, { x: c.x, y: c.y, w: c.w ?? CARD_W, h: effectiveHeight(c.h, c.rows.length, c.collapsed, c.rich.length) });
  }
  return m;
});

/* ── ports and arrow styles ───────────────────────────────────────────────
   See ArrowLayer.vue for what a port is. Computed per TABLE-on-this-canvas, not
   per card: every card of a table shows the same rows in the same order, so the
   row index of a field is the same for all of them; only fold and height differ. */

const portRowsByTable = computed(() => {
  const m = new Map<string, { out: Array<[string, number]>; in: Array<[string, number]> }>();
  for (const tableId of new Set(cards.value.map((c) => c.tableId))) {
    const entry = { out: [] as Array<[string, number]>, in: [] as Array<[string, number]> };
    rowFields(tableId).forEach((f, i) => {      // ROW fields: indices must match what the card draws
      if (f.type === 'link') entry.out.push([f.id, i]);
      const src = f.type === 'backlink' ? backlinkSourceOf(f) : null;
      if (src) entry.in.push([src, i]);
    });
    m.set(tableId, entry);
  }
  return m;
});

const cardPorts = computed(() => {
  const m = new Map<string, CardPorts>();
  for (const c of cards.value) {
    const rows = portRowsByTable.value.get(c.tableId);
    const rect = cardRects.value.get(c.recordId);
    if (!rows || !rect || (!rows.out.length && !rows.in.length)) continue;
    const at = (pairs: Array<[string, number]>) => new Map(pairs.flatMap(([id, i]) => {
      const y = rowPortY(i, rect.h, c.collapsed);
      return y === null ? [] : [[id, y] as [string, number]];
    }));
    m.set(c.recordId, { out: at(rows.out), in: at(rows.in) });
  }
  return m;
});

/** Colour and direction per link field — from the FIELD, so the same on every canvas. */
const arrowStyles = computed(() => {
  const m = new Map<string, ArrowStyle>();
  for (const f of store.state.fields.values()) if (f.type === 'link') m.set(f.id, arrowStyleOf(f));
  return m;
});

/* ── defaults: what a record created here starts out linked to ─────────────
   contract/canvasConfig.ts (`defaults`, `defaultLinkField`) and client/scope.ts
   (`createRecord`). This block is the BAR: showing them, adding, removing, the switch. */

const rawDefaults = computed(() => parsedConfig().defaults ?? []);
// A default's record has to be LOADED to have a name here (and to be linked to at all).
watch(rawDefaults, (list) => { for (const t of new Set(list.map((d) => d.tableId))) void store.loadTable(t); }, { immediate: true });

const defaults = computed(() => rawDefaults.value.map((d) => {
  const loaded = store.tableLoads.get(d.tableId)?.state === 'loaded';
  return {
    ...d, table: store.state.tables.get(d.tableId)?.name ?? '?',
    label: store.state.records.has(d.recordId) ? derived.labelOfId(d.recordId) : loaded ? '(deleted)' : '…',
    missing: loaded && !store.state.records.has(d.recordId),
  };
}));
const isDefault = (recordId: string) => rawDefaults.value.some((d) => d.recordId === recordId);

/** Tables something LINKS TO — the only ones a default can usefully point at. */
const linkableTables = computed(() => {
  const targets = new Set<string>();
  for (const f of store.state.fields.values()) if (f.type === 'link' && typeof f.options?.target_table_id === 'string') targets.add(f.options.target_table_id);
  return tablesSorted(store.state).filter((t) => targets.has(t.id));
});
const canBeDefault = (recordId: string) => linkableTables.value.some((t) => t.id === store.state.records.get(recordId)?.table_id);

function saveDefaults(next: Array<{ tableId: string; recordId: string }>) {
  const { defaults: _old, ...rest } = parsedConfig();
  void _old;
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: next.length ? { ...rest, defaults: next } : rest });
}
function addDefault(tableId: string, recordId: string) {
  if (isDefault(recordId) || rawDefaults.value.length >= 20) return;
  saveDefaults([...rawDefaults.value, { tableId, recordId }]);
  defaultsOn.value = true;                 // you just asked for it
}
const removeDefault = (recordId: string) => saveDefaults(rawDefaults.value.filter((d) => d.recordId !== recordId));

const addingDefault = ref(false);
const addTable = ref('');

/* On/off is a way of WORKING, not a fact about the board: per browser, per canvas. */
const offKey = () => `spatialdb.canvas.defaults.off.${props.canvasId}`;
const readOn = () => { try { return localStorage.getItem(offKey()) !== '1'; } catch { return true; } };
const defaultsOn = ref(readOn());
watch(() => props.canvasId, () => { defaultsOn.value = readOn(); addingDefault.value = false; });
watch(defaultsOn, (on) => { try { if (on) localStorage.removeItem(offKey()); else localStorage.setItem(offKey(), '1'); } catch { /* unavailable */ } });

/** What createAt hands to createRecord. */
const activeDefaults = computed(() => (defaultsOn.value ? rawDefaults.value : []));

/** The project scope applies on top; show it, so the bar is the WHOLE answer. */
const scopeChip = computed(() => {
  const s = scopeApi?.scope.value;
  if (!scopeApi || !s || s.kind !== 'record') return null;
  return { label: scopeApi.label.value, table: store.state.tables.get(scopeApi.scopeTableId.value)?.name ?? '' };
});

/** "Files → Works": tables where a default would be SKIPPED because the field is ambiguous. */
const defaultAmbiguities = computed(() => {
  const out: string[] = [];
  for (const targetId of new Set(rawDefaults.value.map((d) => d.tableId))) {
    for (const t of tablesSorted(store.state)) {
      const via = defaultLinkField(store.state.fields.values(), t.id, targetId);
      if (via && 'ambiguous' in via) out.push(`${t.name} has ${via.ambiguous.length} links to ${store.state.tables.get(targetId)?.name ?? '?'}`);
    }
  }
  return out;
});

/* ── arrows you can select, and links you can make and remove here ─────────

   This REVERSES an earlier decision ("an arrow from a link field is never created
   by a canvas gesture"). What was rejected then was dragging a card onto a card and
   letting the app guess which field you meant. What is built is narrower, and has
   none of that ambiguity (PLAN.md, "Linking from the canvas"):

     ADD     drag from the handle on a VISIBLE link row — so the field is chosen by
             you, never guessed — onto a card of the table that field points at.
             Any other card, or empty canvas: nothing happens, the line vanishes.
     SEE     click an arrow: it is selected and labelled with its field's name.
     REMOVE  right-click an arrow → "Remove this link…" → confirm. (Delete, with an
             arrow selected, asks the same question.) An arrow is thin; what goes is
             data. It is one Ctrl+Z either way. */

const selectedLink = ref<ArrowLink | null>(null);
const keyOfLink = (l: ArrowLink) => `${l.field_id}|${l.from_record}|${l.to_record}`;
const selectedLinkKey = computed(() => {
  const l = selectedLink.value;
  // A peer (or our own Remove) may have deleted it: a selection must not outlive its link.
  return l && store.state.links.has(linkKey(l.field_id, l.from_record, l.to_record)) ? keyOfLink(l) : null;
});
const linkFieldNames = computed(() => {
  const m = new Map<string, string>();
  for (const f of store.state.fields.values()) if (f.type === 'link') m.set(f.id, f.name);
  return m;
});

function selectLink(l: ArrowLink) {
  selected.clear();                       // an arrow OR cards, never both: Delete must be unambiguous
  selectedLink.value = l;
  menu.value = null;
  containerRef.value?.focus();
}
function onLinkMenu(l: ArrowLink, e: MouseEvent) {
  selectLink(l);
  const r = containerRef.value!.getBoundingClientRect();
  const w = viewport.clientToWorld(e.clientX, e.clientY);
  menu.value = { kind: 'link', x: e.clientX - r.left, y: e.clientY - r.top, wx: w.x, wy: w.y, link: l };
}
async function removeLink(l: ArrowLink) {
  const field = linkFieldNames.value.get(l.field_id) ?? 'link';
  if (!await confirmDialog({
    title: `Remove this “${field}” link?`, danger: true, okText: 'Remove link',
    body: `${derived.labelOfId(l.from_record)} → ${derived.labelOfId(l.to_record)}\n\nBoth records stay; only the link between them goes. It can be undone (Ctrl+Z, or from History).`,
  })) return;
  store.mutate({ type: 'link.remove', fieldId: l.field_id, fromRecord: l.from_record, toRecord: l.to_record });
  selectedLink.value = null;
}

/* Dragging a new link out of a port. */
interface LinkDrag { fromRecord: string; fieldId: string; targetTable: string; from: Point; to: Point; over: string | null }
const linkDrag = ref<LinkDrag | null>(null);

/** Could `recordId` take the link being dragged? Right table, not itself, not already linked. */
function canTakeLink(d: LinkDrag, recordId: string, tableId: string) {
  return tableId === d.targetTable && recordId !== d.fromRecord
    && !store.state.links.has(linkKey(d.fieldId, d.fromRecord, recordId));
}
function linkTargetState(recordId: string, tableId: string): 'ok' | 'over' | null {
  const d = linkDrag.value;
  if (!d || !canTakeLink(d, recordId, tableId)) return null;
  return d.over === recordId ? 'over' : 'ok';
}
/** The topmost card under a world point. */
function cardAt(p: Point): { recordId: string; tableId: string } | null {
  let best: { recordId: string; tableId: string; z: number } | null = null;
  for (const c of cards.value) {
    const r = cardRects.value.get(c.recordId);
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && (!best || c.z >= best.z)) best = { recordId: c.recordId, tableId: c.tableId, z: c.z };
  }
  return best;
}

function startLinkDrag({ recordId, fieldId, e }: { recordId: string; fieldId: string; e: PointerEvent }) {
  const field = store.state.fields.get(fieldId);
  const targetTable = field?.type === 'link' ? String(field.options?.target_table_id ?? '') : '';
  const rect = cardRects.value.get(recordId);
  const portY = cardPorts.value.get(recordId)?.out.get(fieldId);
  if (!targetTable || !rect || portY === undefined) return;
  selected.clear(); selectedLink.value = null; menu.value = null;
  const from = { x: rect.x + rect.w, y: rect.y + portY };
  linkDrag.value = { fromRecord: recordId, fieldId, targetTable, from, to: viewport.clientToWorld(e.clientX, e.clientY), over: null };

  const move = (ev: PointerEvent) => {
    const d = linkDrag.value;
    if (!d) return;
    const to = viewport.clientToWorld(ev.clientX, ev.clientY);
    const hit = cardAt(to);
    linkDrag.value = { ...d, to, over: hit && canTakeLink(d, hit.recordId, hit.tableId) ? hit.recordId : null };
  };
  const up = () => {
    const d = linkDrag.value;
    end();
    // Dropped on a card that can take it: the link exists. Anywhere else — the wrong
    // table, itself, a record already linked, empty canvas — NOTHING happens.
    if (d?.over) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: d.fieldId, fromRecord: d.fromRecord, toRecord: d.over });
  };
  const cancel = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(); };
  function end() {
    linkDrag.value = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('keydown', cancel, true);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('keydown', cancel, true);
}

/** The line being dragged, for ArrowLayer: from the port to the pointer (or to the card it would land on). */
const rubber = computed(() => {
  const d = linkDrag.value;
  if (!d) return null;
  const goingRight = d.to.x >= d.from.x;
  const rect = cardRects.value.get(d.fromRecord)!;
  const start = goingRight ? d.from : { x: rect.x, y: d.from.y };
  return { path: bezierPath(start, goingRight ? 'right' : 'left', d.to, goingRight ? 'left' : 'right', 0),
    valid: d.over !== null, color: arrowStyles.value.get(d.fieldId)?.color };
});

/* ── which relational arrows are drawn ────────────────────────────────────

   all       every link whose two ends are both on this canvas
   selected  only links touching a selected card — for a busy board, where the
             question is "what is THIS connected to"
   off       none

   Relational arrows only; hand-drawn canvas arrows (not built yet) get their own
   switch. Kept per browser, per canvas. */
type ArrowMode = 'all' | 'selected' | 'off';
const ARROW_MODES: ArrowMode[] = ['all', 'selected', 'off'];
const ARROW_MODE_TITLE: Record<ArrowMode, string> = {
  all: 'Showing every relationship between cards on this canvas — click for: selected only',
  selected: 'Showing only relationships touching the selected cards — click for: off',
  off: 'Relationship arrows hidden — click for: all',
};
const arrowKey = () => `spatialdb.arrows.${props.canvasId}`;
function readArrowMode(): ArrowMode {
  try {
    const v = localStorage.getItem(arrowKey());
    return ARROW_MODES.includes(v as ArrowMode) ? (v as ArrowMode) : 'all';
  } catch { return 'all'; }   // storage can be unavailable (private mode, tests)
}
const arrowMode = ref<ArrowMode>(readArrowMode());
watch(() => props.canvasId, () => { arrowMode.value = readArrowMode(); });
function cycleArrowMode() {
  arrowMode.value = ARROW_MODES[(ARROW_MODES.indexOf(arrowMode.value) + 1) % ARROW_MODES.length];
  try { localStorage.setItem(arrowKey(), arrowMode.value); } catch { /* see above */ }
}

/* Per RELATIONSHIP, on top of the mode: hide "Inputs" while you look at version
   lineage. Same storage rule as the mode — this browser, this canvas. The list
   doubles as a legend: it names each relationship drawn here, in its colour. */
const hiddenFieldsKey = () => `spatialdb.arrows.hidden.${props.canvasId}`;
function readHiddenFields(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(hiddenFieldsKey()) ?? '[]') as string[]); }
  catch { return new Set(); }
}
const hiddenFields = ref(readHiddenFields());
watch(() => props.canvasId, () => { hiddenFields.value = readHiddenFields(); });
function toggleFieldArrows(fieldId: string) {
  const next = new Set(hiddenFields.value);
  if (next.has(fieldId)) next.delete(fieldId); else next.add(fieldId);
  hiddenFields.value = next;
  try { localStorage.setItem(hiddenFieldsKey(), JSON.stringify([...next])); } catch { /* unavailable */ }
}
const legendOpen = ref(false);

const linksOnCanvas = computed(() => [...store.state.links.values()].filter(
  (l) => cardRects.value.has(l.from_record) && cardRects.value.has(l.to_record)));

/** Every relationship that HAS an arrow on this canvas, for the legend. */
const legend = computed(() => {
  const counts = new Map<string, number>();
  for (const l of linksOnCanvas.value) counts.set(l.field_id, (counts.get(l.field_id) ?? 0) + 1);
  return [...counts].flatMap(([fieldId, n]) => {
    const f = store.state.fields.get(fieldId);
    if (!f) return [];
    return [{ id: fieldId, n, color: arrowStyles.value.get(fieldId)?.color,
      label: `${store.state.tables.get(f.table_id)?.name ?? '?'} · ${f.name}`, hidden: hiddenFields.value.has(fieldId) }];
  }).sort((a, b) => a.label.localeCompare(b.label));
});

const visibleLinks = computed(() => {
  if (arrowMode.value === 'off') return [];
  const onCanvas = linksOnCanvas.value.filter((l) => !hiddenFields.value.has(l.field_id));
  return arrowMode.value === 'all' ? onCanvas
    : onCanvas.filter((l) => selected.has(l.from_record) || selected.has(l.to_record));
});

function colorOf(tableId: string) {
  return store.state.tables.get(tableId)?.color || 'var(--card-head-bg)';
}


/* ── interactions ────────────────────────────────────────────────────────── */

const drag = useCardDrag({
  state: store.state,
  canvasId: () => props.canvasId,
  getTransform: () => viewport.transform,
  selected,
  mutate: store.mutate,
  topZ: () => placements.value.reduce((n, p) => Math.max(n, p.z), 0),
});

const resize = useCardResize({
  state: store.state,
  canvasId: () => props.canvasId,
  getTransform: () => viewport.transform,
  mutate: store.mutate,
  measure: (id) => {
    const r = cardRects.value.get(id);
    return r ? { w: r.w, h: r.h } : null;
  },
});

const boxSelect = useBoxSelection({
  clientToWorld: viewport.clientToWorld,
  cardRects: () => [...cardRects.value.entries()].map(([recordId, r]) => ({ recordId, ...r })),
  selected,
});

function onCardPointerDown({ recordId, e }: { recordId: string; e: PointerEvent }) {
  menu.value = null;
  selectedLink.value = null;       // cards OR an arrow, never both
  if (spaceHeld.value) return;   // space+drag pans, even over a card
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  if (additive) {
    selected.has(recordId) ? selected.delete(recordId) : selected.add(recordId);
  } else if (!selected.has(recordId)) {
    // Clicking an unselected card selects only it. Clicking one that is ALREADY
    // part of a multi-selection must NOT collapse the selection, or dragging a
    // group would be impossible.
    selected.clear();
    selected.add(recordId);
  }
  drag.start(recordId, e);
}

function onCardResize({ recordId, handle, e }: { recordId: string; handle: 'e' | 's' | 'se'; e: PointerEvent }) {
  resize.start(recordId, handle, e);
}

function onCanvasPointerMove(e: PointerEvent) {
  lastPointer = viewport.clientToWorld(e.clientX, e.clientY);
  viewport.onPointerMove(e);
}

function onCanvasPointerDown(e: PointerEvent) {
  menu.value = null;
  addingDefault.value = false;
  selectedLink.value = null;
  legendOpen.value = false;
  if (e.button === 1 || spaceHeld.value) { viewport.startPan(e); return; }
  if (e.button !== 0) return;
  if (e.target !== containerRef.value &&
      !(e.target as HTMLElement).classList.contains('canvas-grid') &&
      !(e.target as HTMLElement).classList.contains('canvas-world')) return;
  if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selected.clear();
  boxSelect.start(e);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !spaceHeld.value) { spaceHeld.value = true; e.preventDefault(); }
  // Delete removes the PLACEMENT, never the record. This is the distinction the
  // whole schema is built around, so the destructive-looking key gets the
  // non-destructive meaning; deleting a record is a deliberate act elsewhere.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    // With an ARROW selected, Delete asks about the link (and only ever asks).
    const l = selectedLink.value;
    if (l && selectedLinkKey.value) void removeLink(l); else unplaceSelected();
  }
  if (e.key === 'Escape') { if (menu.value) { menu.value = null; return; } selected.clear(); selectedLink.value = null; drag.cancel(); }
  if (e.key === 'Enter' && selected.size === 1) { emit('open-record', [...selected][0]); e.preventDefault(); }
  if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    for (const id of cardRects.value.keys()) selected.add(id);
  }
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey) fitAll();
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') { spaceHeld.value = false; viewport.onPointerUp(); }
}

function toggleScrollMode() {
  viewport.scrollMode.value = viewport.scrollMode.value === 'mouse' ? 'touchpad' : 'mouse';
}

function fitAll() {
  viewport.fit([...cardRects.value.values()]);
}

/* ── placing and unplacing ───────────────────────────────────────────────── */

/* ── fold ─────────────────────────────────────────────────────────────── */

const placementOf = (recordId: string) => placements.value.find((p) => p.record_id === recordId);
const isCollapsed = (recordId: string) => placementOf(recordId)?.collapsed === true;
function toggleFold(recordId: string) {
  store.mutate({ type: 'placement.update', canvasId: props.canvasId, recordId, collapsed: !isCollapsed(recordId) });
}

/* ── menus, and making records on the canvas ──────────────────────────────

   One floating panel in three guises. `create` is what a double-click opens:
   just the table list, because a double-click means "new record here" and the
   only open question is WHICH KIND. It is skipped entirely when there is a
   single table — or when you made a record a moment ago, in which case the same
   table is assumed (hold Alt to be asked anyway). Laying out ten File cards is
   ten double-clicks, not ten double-clicks and ten menu picks. */

interface Menu { kind: 'card' | 'canvas' | 'create' | 'fields' | 'link'; x: number; y: number; wx: number; wy: number; recordId?: string; link?: ArrowLink }
const menu = ref<Menu | null>(null);
const lastCreateTable = ref('');

const tablesForCreate = computed(() => tablesSorted(store.state));
const tableNameOf = (recordId: string) =>
  store.state.tables.get(store.state.records.get(recordId)?.table_id ?? '')?.name ?? 'these';

function openMenu(kind: Menu['kind'], e: MouseEvent, recordId?: string) {
  const box = containerRef.value?.getBoundingClientRect();
  const world = viewport.clientToWorld(e.clientX, e.clientY);
  menu.value = { kind, recordId, wx: world.x, wy: world.y,
    x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
}
/**
 * Close the menu, THEN act — handing the action the menu as it was. The first
 * version cleared `menu` and then ran a closure that read `menu.value`: every
 * item found nothing there. The snapshot is the fix; do not "simplify" it away.
 */
function menuDo(fn: (m: Menu) => void) {
  const m = menu.value;
  menu.value = null;
  if (m) fn(m);
}

const isBackground = (t: EventTarget | null) =>
  t === containerRef.value
  || (t as HTMLElement | null)?.classList?.contains('canvas-grid') === true
  || (t as HTMLElement | null)?.classList?.contains('canvas-world') === true;

function onCardMenu({ recordId, x, y }: { recordId: string; x: number; y: number }) {
  if (!selected.has(recordId)) { selected.clear(); selected.add(recordId); }
  openMenu('card', { clientX: x, clientY: y } as MouseEvent, recordId);
}
function onCanvasMenu(e: MouseEvent) {
  if (isBackground(e.target)) openMenu('canvas', e);
}
function onCanvasDblClick(e: MouseEvent) {
  if (!isBackground(e.target)) return;
  const tables = tablesForCreate.value;
  const known = tables.find((t) => t.id === lastCreateTable.value);
  const world = viewport.clientToWorld(e.clientX, e.clientY);
  if (tables.length === 1) return createAt(tables[0].id, world.x, world.y);
  if (known && !e.altKey) return createAt(known.id, world.x, world.y);
  openMenu('create', e);
}

/**
 * A record AND its placement, in one flush — so they share a transaction and a
 * peer never sees a card-less record or a record-less card. Then straight into
 * the record panel: a new card is blank, and a blank card is useless until named.
 */
function createAt(tableId: string, wx: number, wy: number) {
  const id = crypto.randomUUID();
  lastCreateTable.value = tableId;
  const z = placements.value.reduce((n, p) => Math.max(n, p.z), 0) + 1;
  // Through the scope (client/scope.ts): inside a project the new record is made a
  // member of it, in this same run — record, link and placement are one Ctrl+Z.
  // …and linked to this canvas's DEFAULTS (the bar at the top), unless switched off.
  if (scopeApi) scopeApi.createRecord(tableId, {}, id, { defaults: activeDefaults.value });
  else store.mutate({ type: 'record.create', id, tableId, data: {} });
  store.mutate({
    type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: id,
    x: Math.round(wx - CARD_W / 2), y: Math.round(wy - 24), w: null, h: null, z,
  });
  selected.clear();
  selected.add(id);
  emit('open-record', id);
}

/* ── placing an existing record (the command palette) ─────────────────────

   Exposed to App.vue, which owns the palette. A record can be on a canvas ONCE
   (placements are keyed by canvas + record), so choosing one that is already
   here pans to it instead. */

/**
 * A record brought onto the canvas from OUTSIDE it (the palette, a drop) arrives
 * without its links: links reach the client with a table or a scene, and this
 * record came from neither. Its arrows to cards already here would be missing
 * until a reload. `store.loadSceneLinks` fetches exactly the links among the cards
 * now on the canvas — links ONLY, and only if nothing changed locally meanwhile;
 * see its comment for the Ctrl+Z race that taught it to.
 */
function refreshLinksAfterPlacing() {
  void store.loadSceneLinks(props.canvasId).catch(() => {});
}

/** Where the pointer last was over the canvas, in world space — "at the cursor". */
let lastPointer: { x: number; y: number } | null = null;
let cascade = 0;

function placeOrJump(rec: RecordRow): 'placed' | 'jumped' {
  const already = cardRects.value.get(rec.id);
  if (already) {
    viewport.centerOn([already]);
    selected.clear(); selected.add(rec.id);
    return 'jumped';
  }
  store.adopt([rec]);
  const box = containerRef.value?.getBoundingClientRect();
  const at = lastPointer ?? viewport.clientToWorld((box?.left ?? 0) + (box?.width ?? 0) / 2, (box?.top ?? 0) + (box?.height ?? 0) / 2);
  // Several placed in one palette visit (Shift+Enter) step down-right instead of
  // stacking exactly on top of each other.
  const off = (cascade++ % 8) * 28;
  const z = placements.value.reduce((n, p) => Math.max(n, p.z), 0) + 1;
  store.mutate({
    type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: rec.id,
    x: Math.round(at.x - CARD_W / 2 + off), y: Math.round(at.y - 24 + off), w: null, h: null, z,
  });
  selected.clear(); selected.add(rec.id);
  refreshLinksAfterPlacing();
  return 'placed';
}
/**
 * Several records dropped at one point — rows dragged out of a grid, once two views can share the screen.
 * Laid out as a column (wrapping into further columns), top-left at the drop
 * point, in the order they were in the grid: a sorted, filtered selection arrives
 * on the canvas still sorted. Records already here are skipped, not duplicated
 * (a record sits on a canvas once) and are selected along with the new ones, so
 * the whole set you dragged ends up highlighted either way.
 *
 * All the placement.add mutations happen in one synchronous run, which makes the
 * whole drop ONE Ctrl+Z (see history.ts).
 */
const DROP_GAP = 16, DROP_PER_COLUMN = 8;
function placeMany(records: RecordRow[], clientX: number, clientY: number) {
  const at = viewport.clientToWorld(clientX, clientY);
  const fresh = records.filter((r) => !cardRects.value.has(r.id));
  store.adopt(fresh);
  let z = placements.value.reduce((n, p) => Math.max(n, p.z), 0);
  let col = 0, row = 0, y = at.y;
  for (const rec of fresh) {
    const h = effectiveHeight(null, rowFields(rec.table_id).length, false, richBlocks(rec).length);
    store.mutate({
      type: 'placement.add', id: crypto.randomUUID(), canvasId: props.canvasId, recordId: rec.id,
      x: Math.round(at.x + col * (CARD_W + DROP_GAP)), y: Math.round(y), w: null, h: null, z: ++z,
    });
    y += h + DROP_GAP;
    if (++row === DROP_PER_COLUMN) { row = 0; col++; y = at.y; }
  }
  selected.clear();
  for (const r of records) selected.add(r.id);
  if (fresh.length) refreshLinksAfterPlacing();
  containerRef.value?.focus();
}

const placedIds = computed(() => new Set(cardRects.value.keys()));
defineExpose({ placeOrJump, placeMany, placedIds, resetCascade: () => { cascade = 0; } });

/** The one place the canvas can destroy DATA, so it says so, and says it is undoable. */
async function deleteRecord(recordId: string) {
  const rec = store.state.records.get(recordId);
  if (!rec) return;
  if (!await confirmDialog({ title: `Delete “${labelOf(rec)}” everywhere?`, danger: true, okText: 'Delete record',
    body: 'Not just from this canvas: it disappears from every canvas and table. It can be restored from History.' })) return;
  store.mutate({ type: 'record.delete', id: recordId });
}

/* ── which fields this canvas's cards show ────────────────────────────── */

const menuTableId = computed(() => store.state.records.get(menu.value?.recordId ?? '')?.table_id ?? '');
const fieldChoices = computed(() => {
  const on = new Set(shownFields(menuTableId.value).map((f) => f.id));
  const primaryKey = labelKeys.value.get(menuTableId.value);
  return fieldsOf(store.state, menuTableId.value)
    .filter((f) => f.key !== primaryKey)          // the title; always shown, never listed
    .map((f) => ({ id: f.id, name: f.name, on: on.has(f.id) }));
});
// A FUNCTION DECLARATION, deliberately: it is hoisted. As a `const` arrow it sat below
// the defaults bar's setup code, which reads the config immediately (an `immediate`
// watcher) — "Cannot access 'parsedConfig' before initialization", and every canvas
// failed to open. Caught by test/scope.ts.
function parsedConfig() {
  const p = CanvasConfig.safeParse(canvasConfig.value ?? {});
  return p.success ? p.data : { cardFields: {} };
}
const hasCustomFields = computed(() => menuTableId.value in parsedConfig().cardFields);

function saveCardFields(tableId: string, ids: string[] | null) {
  const cardFields = { ...parsedConfig().cardFields };
  if (ids) cardFields[tableId] = ids; else delete cardFields[tableId];
  // MERGED into the config, never `{ cardFields }` alone: canvas.update replaces the
  // whole config, and that would silently wipe the canvas's defaults.
  store.mutate({ type: 'canvas.update', id: props.canvasId, config: { ...parsedConfig(), cardFields } });
}
function toggleCardField(fieldId: string) {
  const tableId = menuTableId.value;
  const current = shownFields(tableId).map((f) => f.id);
  const next = current.includes(fieldId) ? current.filter((x) => x !== fieldId)
    // Added fields keep TABLE order rather than going last: the card then reads
    // like the grid's columns, which is where people learned the order.
    : fieldsOf(store.state, tableId).map((f) => f.id).filter((x) => x === fieldId || current.includes(x));
  saveCardFields(tableId, next);
}
function resetCardFields() { saveCardFields(menuTableId.value, null); }

function unplace(recordId: string) {
  store.mutate({ type: 'placement.remove', canvasId: props.canvasId, recordId });
  selected.delete(recordId);
}

function unplaceSelected() {
  for (const id of [...selected]) unplace(id);
}

/* ── lifecycle ───────────────────────────────────────────────────────────── */

let unregisterDrop: (() => void) | undefined;

onMounted(async () => {
  // Records dropped here by anything that uses
  // client/recordDrag.ts) land here.
  if (containerRef.value) unregisterDrop = registerDropTarget(containerRef.value, placeMany);
  await store.loadScene(props.canvasId);
  fitAll();
  containerRef.value?.focus();
});

// Reopening a different canvas reloads rather than reusing a stale scene.
watch(() => props.canvasId, async (id) => {
  selected.clear();
  await store.loadScene(id);
  fitAll();
});

onUnmounted(() => {
  unregisterDrop?.();
  drag.cancel();
  resize.cancel();
});
</script>

<style scoped>
.canvas-container {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: clip;
  background: var(--bg-canvas);
  outline: none;
  user-select: none;
  cursor: default;
}
.canvas-container.panning { cursor: grabbing; }

.canvas-grid { position: absolute; inset: 0; pointer-events: none; z-index: 0; }

.canvas-world {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  transform-origin: 0 0;
  z-index: 1;
  /* Click-through, as in viznotes: this box covers the whole container and sits
     above the arrow layer, so if it took pointer events it would swallow every
     click meant for the background. Cards re-enable events on themselves. */
  pointer-events: none;
  will-change: transform;
}

.selection-box {
  position: fixed;
  border: 1px solid var(--accent);
  background: var(--accent-ring);
  pointer-events: none;
  z-index: 50;
}

.canvas-view { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.canvas-controls {
  position: relative; flex: none;
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-main);
  z-index: 40;
  font-size: 12px;
}
.canvas-controls button {
  background: none; border: none; color: var(--text-secondary);
  cursor: pointer; padding: 2px 6px; border-radius: 3px; font: inherit;
}
.canvas-controls button:hover:not(:disabled) { background: var(--bg-surface-hover); }
.canvas-controls button:disabled { opacity: 0.35; cursor: default; }
.canvas-controls button.active { color: var(--accent); }
.canvas-controls .zoom { color: var(--text-muted); min-width: 38px; text-align: center; }
.canvas-controls .sep { width: 1px; height: 14px; background: var(--border-main); margin: 0 2px; }

.stream-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
.stream-dot.connected { background: var(--success); }
.stream-dot.reconnecting, .stream-dot.connecting { background: var(--warning); }
.stream-dot.resyncing { background: var(--accent); }

.legend {
  position: absolute; top: calc(100% + 4px); left: 12px; min-width: 240px; padding: 6px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  box-shadow: var(--card-shadow-drag); font-size: 12px; display: flex; flex-direction: column; gap: 2px;
}
.legend-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; white-space: nowrap; }
.legend-swatch { width: 18px; height: 3px; border-radius: 2px; flex: none; }
.legend-label { flex: 1; }
.legend-n { color: var(--text-muted); font-size: 11px; }
.legend-note { margin: 4px 4px 2px; color: var(--text-faint); font-size: 11px; white-space: normal; max-width: 260px; }

.defaults-bar {
  position: relative; flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 4px 12px; border-bottom: 1px solid var(--border-main); font-size: 12px; z-index: 39;
}
.defaults-switch { display: flex; align-items: center; gap: 6px; cursor: pointer; color: var(--text-secondary); white-space: nowrap; }
.defaults-switch input { margin: 0; }
.defaults-bar.off .dchip:not(.scope) { opacity: 0.4; text-decoration: line-through; }
.dchip { display: inline-flex; align-items: center; gap: 5px; background: var(--controls-bg); border: 1px solid var(--accent); border-radius: 10px; padding: 0 4px 0 8px; white-space: nowrap; }
.dchip.scope { border-color: var(--border-main); padding-right: 8px; }
.dchip.scope i { color: var(--text-faint); font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.05em; }
.dchip.missing { border-color: var(--warning); color: var(--warning); }
.dchip-table { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.dchip-x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 2px; font-size: 12px; line-height: 1; }
.dchip-x:hover { color: var(--danger); }
.defaults-none { color: var(--text-faint); font-style: italic; }
.defaults-add { background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 10px; padding: 0 8px; cursor: pointer; font: inherit; font-size: 11px; }
.defaults-add:hover { color: var(--accent); border-color: var(--accent); }
.defaults-warn { color: var(--warning); font-size: 11px; white-space: nowrap; cursor: help; }
.defaults-pop {
  position: absolute; top: calc(100% + 2px); left: 12px; z-index: 60; width: 340px; padding: 8px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px; box-shadow: var(--card-shadow-drag);
  display: flex; flex-direction: column; gap: 6px;
}
.defaults-table { background: var(--bg-app); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 6px; font: inherit; }

.ctx-head { padding: 4px 10px 0; font-weight: 600; font-size: 12px; }
.ctx-sub { padding: 0 10px 4px; color: var(--text-muted); font-size: 11px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ctx {
  position: absolute; z-index: 40; min-width: 200px; max-width: 320px; padding: 4px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  box-shadow: var(--card-shadow-drag); font-size: 12px; display: flex; flex-direction: column;
}
.ctx button {
  display: flex; align-items: center; gap: 6px; text-align: left;
  background: none; border: none; color: var(--text-primary); font: inherit;
  padding: 5px 8px; border-radius: 4px; cursor: pointer;
}
.ctx button:hover { background: var(--bg-surface-hover); }
.ctx button.danger { color: var(--danger); }
.ctx hr { border: none; border-top: 1px solid var(--border-main); margin: 4px 0; width: 100%; }
.ctx-title { margin: 0; padding: 4px 8px; color: var(--text-muted); font-size: 11px; }
.ctx-note { margin: 0; padding: 4px 8px; color: var(--text-faint); font-size: 11px; }
.ctx-check { display: flex; gap: 6px; align-items: center; padding: 3px 8px; cursor: pointer; }
.swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
</style>
