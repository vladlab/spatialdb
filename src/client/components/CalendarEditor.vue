<!--
  The CALENDAR DEFINITION editor (VIEWS-BRIEF.md B8): mounted by StructuredField for
  a `structured` field of shape 'calendar', in the record tray. Picks only, no ids
  typed.

  Same arrangement as ReportEditor: it edits a DRAFT — a deep copy of the stored
  definition (or an empty one) — and every change re-runs the check the server runs
  (`calendarDefError`, over the whole schema); Save is enabled only when there is no
  problem, and writes ONCE (one mutation, one Ctrl+Z). A stored definition that
  changes underneath (a peer, Ctrl+Z, the top bar switching the layout) replaces an
  UNTOUCHED draft; a touched one is kept, with "revert" offered.

  The LAYOUT and ZOOM are not edited here: the calendar's top bar owns them ("where
  I was", not configuration). A save keeps whatever is stored for them now, so an
  old draft never puts back a layout someone has since switched away from.

  "edit as JSON…" (StructuredField) stays underneath as the escape hatch.
-->
<template>
  <div class="ce" @keydown.stop>
    <!-- ROWS: the resource axis. Optional; without it there is no Resource layout. -->
    <div class="ce-well ce-rows">
      <label class="ce-head">
        <input type="checkbox" class="ce-rows-on" :checked="!!draft.rows" @change="toggleRows(($event.target as HTMLInputElement).checked)" />
        <span class="ce-title">Rows</span>
        <span class="ce-note">one lane per record — for the Resource layout</span>
      </label>
      <template v-if="draft.rows">
        <div class="ce-line">
          <span class="ce-label">table</span>
          <select class="ce-rows-table" :value="draft.rows.tableId" @change="setRowsTable(val($event))">
            <option v-for="t in rowTables" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
        <div class="ce-line top">
          <span class="ce-label">filter</span>
          <FilterLines :store="store" :table-id="draft.rows.tableId" :filters="draft.rows.filters" note=""
                       @update:filters="(f) => { draft.rows!.filters = f; touch(); }" />
        </div>
        <div class="ce-line top">
          <span class="ce-label">sort</span>
          <div class="ce-stack">
            <div v-for="(s, i) in draft.rows.sort" :key="i" class="ce-line">
              <select :value="s.fieldId" @change="s.fieldId = val($event); touch()">
                <option v-for="f in fieldsOf(store.state, draft.rows.tableId)" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <select :value="s.dir" @change="s.dir = val($event) as 'asc' | 'desc'; touch()">
                <option value="asc">A → Z</option><option value="desc">Z → A</option>
              </select>
              <button class="ce-x" title="Remove this sort" @click="draft.rows.sort.splice(i, 1); touch()">×</button>
            </div>
            <button v-if="draft.rows.sort.length < 8" class="ce-add add-row-sort" @click="addRowSort">+ sort</button>
          </div>
        </div>
      </template>
    </div>

    <!-- SOURCES: each a table pouring events in. -->
    <div v-for="(s, i) in draft.sources" :key="s.id" class="ce-well ce-source" :data-source="s.id">
      <div class="ce-head">
        <span class="ce-dot" :class="`tint-${s.tint}`"><i /></span>
        <span class="ce-title">{{ tableName(s.tableId) }}</span>
        <span v-if="isJunction(s.tableId)" class="ce-note">junction</span>
        <button class="ce-x remove-source" title="Remove this source" @click="removeSource(i)">×</button>
      </div>
      <div class="ce-line">
        <span class="ce-label">start</span>
        <select class="ce-start" :value="s.start" @change="s.start = val($event); touch()">
          <option v-for="f in dateFields(s.tableId)" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <span class="ce-label short">end</span>
        <select class="ce-end" :value="s.end ?? ''" @change="setEnd(s, val($event))">
          <option value="">— one day —</option>
          <option v-for="f in dateFields(s.tableId).filter((f) => f.id !== s.start)" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <div class="ce-line">
        <span class="ce-label">label</span>
        <template v-for="(id, j) in s.label" :key="j">
          <select class="ce-labelf" :value="id" @change="s.label[j] = val($event); touch()">
            <option v-for="f in chipFields(s.tableId)" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <button v-if="s.label.length > 1" class="ce-x" title="Remove from the chip" @click="s.label.splice(j, 1); touch()">×</button>
        </template>
        <button v-if="s.label.length < MAX_LABEL_FIELDS" class="ce-add add-label" title="Print another field on the chip" @click="addLabel(s)">+</button>
      </div>
      <div class="ce-line">
        <span class="ce-label">tint</span>
        <button v-for="t in TINTS" :key="t" type="button" class="ce-swatch" :class="[`tint-${t}`, { on: s.tint === t }]" :title="t" @click="s.tint = t; touch()" />
        <span class="ce-label short">by</span>
        <select class="ce-tintby" :value="s.tintBy ?? ''" @change="setTintBy(s, val($event))">
          <option value="">— one tint —</option>
          <option v-for="f in selectFields(s.tableId)" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
      </div>
      <div v-if="s.tintBy" class="ce-line top">
        <span class="ce-label" />
        <div class="ce-stack ce-tintmap">
          <div v-for="c in choicesOfField(s.tintBy)" :key="c" class="ce-line" :data-choice="c">
            <span class="ce-choice">{{ c }}</span>
            <button type="button" class="ce-swatch default" :class="{ on: !s.tintMap?.[c] }" title="the source's tint" @click="setChoiceTint(s, c, null)">·</button>
            <button v-for="t in TINTS" :key="t" type="button" class="ce-swatch" :class="[`tint-${t}`, { on: s.tintMap?.[c] === t }]" :title="t" @click="setChoiceTint(s, c, t)" />
          </div>
        </div>
      </div>
      <div v-if="draft.rows" class="ce-line">
        <span class="ce-label">lane</span>
        <select v-if="lanesFor(s.tableId).length" class="ce-lane" :value="s.lane ?? ''" @change="s.lane = val($event) || undefined; touch()">
          <option v-for="c in lanesFor(s.tableId)" :key="c.field.id" :value="c.field.id">{{ c.field.name }}{{ c.through ? ` (through ${c.through})` : '' }}</option>
        </select>
        <span v-else class="ce-warn">{{ tableName(s.tableId) }} has no link to {{ tableName(draft.rows.tableId) }} — it cannot go on a calendar with these rows</span>
      </div>
      <div class="ce-line top">
        <span class="ce-label">filter</span>
        <FilterLines :store="store" :table-id="s.tableId" :filters="s.filters" note="" @update:filters="(f) => { s.filters = f; touch(); }" />
      </div>
    </div>

    <div class="ce-line">
      <select v-if="draft.sources.length < MAX_SOURCES" class="ce-add-source" value="" @change="addSource(val($event)); ($event.target as HTMLSelectElement).value = ''">
        <option value="" disabled>+ source…</option>
        <option v-for="t in sourceTables" :key="t.id" :value="t.id" :disabled="!dateFields(t.id).length">{{ t.name }}{{ dateFields(t.id).length ? '' : ' — no date field' }}</option>
      </select>
      <span v-else class="ce-note">{{ MAX_SOURCES }} sources at most</span>
    </div>

    <p v-if="error" class="ce-error">{{ error }}</p>
    <p v-else-if="!draft.sources.length" class="ce-note">Add a table to pour into this calendar — anything with a date field.</p>
    <div class="ce-bar">
      <button class="ce-btn primary save-calendar" :disabled="!dirty || !!error" @click="save">save</button>
      <button class="ce-btn revert-calendar" :disabled="!dirty" @click="revert">revert</button>
      <span v-if="dirty" class="ce-note">unsaved changes</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Store } from '../store';
import { fieldsOf, isUtilityTable, type FieldRow, type TableRow } from '../state';
import { TINTS, type Tint } from '../../contract/colorRules';
import { LABEL_TYPES } from '../../contract/labels';
import { choicesOf } from '../../contract/values';
import {
  CalendarDef, EMPTY_CALENDAR, MAX_LABEL_FIELDS, MAX_SOURCES, calendarDefError, laneCandidates,
  type CalendarField, type CalendarSource,
} from '../../contract/calendar';
import FilterLines from './FilterLines.vue';

const props = defineProps<{ store: Store; recordId: string; field: FieldRow; value: unknown }>();
const emit = defineEmits<{ set: [value: unknown] }>();
const store = props.store;
const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;

const stored = (): CalendarDef | null => { const r = CalendarDef.safeParse(props.value); return r.success ? r.data : null; };
const fresh = (): CalendarDef => JSON.parse(JSON.stringify(stored() ?? EMPTY_CALENDAR()));
const draft = ref<CalendarDef>(fresh());
const dirty = ref(false);
const error = ref('');
const touch = () => { dirty.value = true; };

/* ── what may be picked ── */
const allTables = computed(() => [...store.state.tables.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
const tableName = (id: string) => store.state.tables.get(id)?.name ?? '(deleted table)';
const isJunction = (id: string) => store.state.tables.get(id)?.kind === 'junction';
/** Rows: tables of THINGS — not boards, reports, calendars, junctions or vocabularies. */
const rowTables = computed(() => allTables.value.filter((t) => !isUtilityTable(t)));
/** Sources: ordinary tables and junctions (a booking IS a pair); never boards, reports or calendars. */
const sourceTables = computed(() => allTables.value.filter((t: TableRow) => !t.kind || t.kind === 'records' || t.kind === 'junction'));
const dateFields = (t: string) => fieldsOf(store.state, t).filter((f) => f.type === 'date');
const CHIP = new Set([...LABEL_TYPES, 'link', 'backlink', 'lookup', 'checkbox']);
const chipFields = (t: string) => fieldsOf(store.state, t).filter((f) => CHIP.has(f.type));
const selectFields = (t: string) => fieldsOf(store.state, t).filter((f) => f.type === 'select');
const choicesOfField = (id: string) => { const f = store.state.fields.get(id); return f ? choicesOf(f.options) ?? [] : []; };
const schemaFields = () => [...store.state.fields.values()] as CalendarField[];
const lanesFor = (t: string) => (draft.value.rows ? laneCandidates(t, draft.value.rows.tableId, schemaFields(), store.state.tables.values()) : []);

/* ── edits ── */
function toggleRows(on: boolean) {
  if (on) {
    const t = rowTables.value[0];
    if (!t) return;
    draft.value.rows = { tableId: t.id, filters: [], sort: [] };
    for (const s of draft.value.sources) s.lane = lanesFor(s.tableId)[0]?.field.id;
  } else {
    delete draft.value.rows;
    for (const s of draft.value.sources) delete s.lane;
  }
  touch();
}
function setRowsTable(id: string) {
  draft.value.rows = { tableId: id, filters: [], sort: [] };
  for (const s of draft.value.sources) s.lane = lanesFor(s.tableId)[0]?.field.id;
  touch();
}
function addRowSort() {
  const f = fieldsOf(store.state, draft.value.rows!.tableId)[0];
  if (f) { draft.value.rows!.sort.push({ fieldId: f.id, dir: 'asc' }); touch(); }
}
function newSourceId(): string {
  const used = new Set(draft.value.sources.map((s) => s.id));
  for (let n = draft.value.sources.length + 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`;
}
/**
 * A new source, filled in as far as it can be guessed: the first date field is the
 * start, a second one the end; the label is the table's primary field; the lane the
 * first link to the rows; the tint the next one round the six.
 */
function addSource(tableId: string) {
  const dates = dateFields(tableId);
  if (!dates.length) return;
  const primary = fieldsOf(store.state, tableId).find((f) => LABEL_TYPES.has(f.type)) ?? chipFields(tableId)[0];
  const used = new Set(draft.value.sources.map((s) => s.tint));
  const s: CalendarSource = {
    id: newSourceId(), tableId, filters: [], start: dates[0].id,
    ...(dates[1] ? { end: dates[1].id } : {}),
    label: primary ? [primary.id] : [],
    tint: TINTS.find((t) => !used.has(t)) ?? TINTS[draft.value.sources.length % TINTS.length],
  };
  if (draft.value.rows) { const lane = lanesFor(tableId)[0]; if (lane) s.lane = lane.field.id; }
  draft.value.sources.push(s);
  touch();
}
function removeSource(i: number) { draft.value.sources.splice(i, 1); touch(); }
function setEnd(s: CalendarSource, id: string) { if (id) s.end = id; else delete s.end; touch(); }
function addLabel(s: CalendarSource) {
  const next = chipFields(s.tableId).find((f) => !s.label.includes(f.id));
  if (next) { s.label.push(next.id); touch(); }
}
function setTintBy(s: CalendarSource, id: string) {
  if (id) { s.tintBy = id; s.tintMap = {}; } else { delete s.tintBy; delete s.tintMap; }
  touch();
}
function setChoiceTint(s: CalendarSource, choice: string, t: Tint | null) {
  const m = { ...(s.tintMap ?? {}) };
  if (t) m[choice] = t; else delete m[choice];
  s.tintMap = m;
  touch();
}

/* ── check, save ── */
function validate() {
  const err = calendarDefError(draft.value, schemaFields(), store.state.tables.values());
  error.value = err ? err.replace(/^calendar: /, '') : '';
}
watch(draft, validate, { deep: true, immediate: true });
// The schema moved under an open editor (a field renamed or deleted): re-check.
watch(() => store.state.fields.size, validate);

watch(() => props.value, () => { if (!dirty.value) draft.value = fresh(); });

function save() {
  validate();
  if (error.value) return;
  const now = stored();
  const out: CalendarDef = JSON.parse(JSON.stringify(draft.value));
  // The top bar owns these: keep what is stored, unless it no longer fits.
  out.layout = now?.layout ?? out.layout;
  out.zoom = now?.zoom ?? out.zoom;
  if (out.layout === 'resource' && !out.rows) out.layout = 'month';
  emit('set', out);
  dirty.value = false;
}
function revert() { draft.value = fresh(); dirty.value = false; }
</script>

<style scoped>
.ce { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; font-size: 12px; }
.ce-well { display: flex; flex-direction: column; gap: 5px; border-left: 2px solid var(--border-main); padding: 2px 0 2px 10px; }
.ce-source { border-left-color: var(--border-main); }
.ce-head { display: flex; align-items: center; gap: 6px; cursor: default; }
label.ce-head { cursor: pointer; }
.ce-title { font-weight: 600; color: var(--text-primary); }
.ce-dot { display: inline-flex; }
.ce-dot i { width: 10px; height: 10px; border-radius: 3px; background: var(--tint); display: inline-block; }
.ce-line { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; }
.ce-line.top { align-items: flex-start; }
.ce-stack { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.ce-label { flex: 0 0 44px; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 2px; }
.ce-label.short { flex: 0 0 auto; margin-left: 8px; }
.ce-note { margin: 0; color: var(--text-faint); font-size: 11px; font-style: italic; }
.ce-warn { color: var(--warning); font-size: 11px; white-space: normal; }
.ce-error { margin: 0; color: var(--warning); font-size: 11px; white-space: normal; }
.ce-choice { flex: 0 0 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.ce-swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid transparent; padding: 0; cursor: pointer; background: var(--tint); opacity: 0.45; }
.ce-swatch:hover { opacity: 0.8; }
.ce-swatch.on { opacity: 1; border-color: #fff; box-shadow: 0 0 0 1px var(--tint); }
.ce-swatch.default { background: none; border: 1px dashed var(--border-main); color: var(--text-muted); font-size: 10px; line-height: 1; }
.ce-swatch.default.on { border-style: solid; border-color: var(--text-secondary); box-shadow: none; }
select, input { background: var(--bg-app); color: var(--text-primary); border: 1px solid var(--border-main); border-radius: 3px; font: inherit; font-size: 11px; padding: 1px 4px; min-width: 0; max-width: 100%; }
input[type="checkbox"] { width: auto; margin: 0; }
.ce-add { align-self: flex-start; background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 3px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.ce-add:hover { color: var(--accent); border-color: var(--accent); }
.ce-x { background: none; border: none; color: var(--text-faint); cursor: pointer; font: inherit; font-size: 13px; padding: 0 3px; }
.ce-head .ce-x { margin-left: auto; }
.ce-x:hover { color: var(--danger); }
.ce-bar { display: flex; align-items: center; gap: 6px; }
.ce-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; font-size: 11px; }
.ce-btn.primary { border-color: var(--accent); color: var(--accent); }
.ce-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.ce-btn:disabled { opacity: 0.35; cursor: default; }
</style>
