<!--
  A calendar, OPEN (VIEWS-BRIEF.md Part B). The record's definition is parsed, the
  tables its sources and rows read are loaded, and `runCalendar` runs — on the
  client, over the same store the grid reads, so a peer's edit reappears here as it
  does in a grid. Nothing is stored; a calendar is DERIVED each time it is opened.
  Scope applies to every source and to the rows, through the same ScopeApi every
  grid asks.

  The TOP BAR owns the layout (and, later, the resource zoom): switching writes it
  into the definition — "where I was", remembered for everyone. While the
  definition has a problem (a field it names was deleted) the server would refuse
  that write, so the switch then works for this screen only and says so
  (owner's call, Oct 25 2026: option a).

  Round 3 draws no layouts yet: the bar, the legend, the problems, and a count per
  source — enough to check a definition made in the editor. Month and week come in
  round 4, agenda in 5, resource in 7.
-->
<template>
  <div class="calendarview">
    <div class="cv-bar context-bar">
      <span class="cv-kind">▥ calendar</span>
      <span class="cv-title">{{ title }}</span>
      <span class="cv-layouts" role="group" aria-label="Layout">
        <button v-for="l in LAYOUTS" :key="l" class="cv-layout" :class="{ on: layout === l }" :data-layout="l"
                :disabled="l === 'resource' && !def?.rows"
                :title="l === 'resource' && !def?.rows ? 'Resource needs rows — pick a row table (Computers, People…) in the calendar\'s settings' : `${LAYOUT_LABELS[l]} layout`"
                @click="setLayout(l)">{{ LAYOUT_LABELS[l] }}</button>
      </span>
      <span v-if="result?.legend.length" class="tint-legend cv-legend">
        <button v-for="l in result.legend" :key="l.sourceId" class="cv-src" :class="[`tint-${l.tint}`, { off: hidden.has(l.sourceId) }]" :data-source="l.sourceId"
                :title="hidden.has(l.sourceId) ? `Show ${l.tableName} (this browser only)` : `Hide ${l.tableName} (this browser only)`"
                @click="toggleSource(calendarId, l.sourceId)"><i />{{ l.tableName }}</button>
      </span>
      <span v-if="scopeNote" class="cv-note">{{ scopeNote }}</span>
      <span v-if="loading" class="cv-note">loading…</span>
      <span class="cv-spacer" />
      <span v-if="result" class="cv-count">{{ result.events.length }} event{{ result.events.length === 1 ? '' : 's' }}</span>
      <button class="cv-def" title="Open the calendar's record — its sources and rows are set there" @click="$emit('open-record', calendarId)">settings…</button>
    </div>

    <p v-if="problem" class="hint stage-body">{{ problem }}</p>
    <div v-else class="cv-body stage-body">
      <p v-if="localOnly" class="cv-warning cv-local">The layout is not saved while the definition has a problem — this switch is for this screen only. Fix it in settings: {{ invalid }}</p>
      <p v-else-if="invalid" class="cv-warning">⚠ {{ invalid }}</p>
      <ul v-if="result?.problems.length" class="cv-problems">
        <li v-for="p in result.problems" :key="p">{{ p }}</li>
      </ul>
      <!-- Interim (round 3): what each source contributes, until the layouts draw. -->
      <table v-if="result && def?.sources.length" class="cv-sources">
        <tr v-for="s in perSource" :key="s.sourceId" :data-source="s.sourceId">
          <td><span class="tint-legend"><span :class="`tint-${s.tint}`"><i />{{ s.tableName }}</span></span></td>
          <td class="n">{{ s.hidden ? 'hidden here' : `${s.n} event${s.n === 1 ? '' : 's'}` }}</td>
          <td class="span">{{ s.span }}</td>
        </tr>
        <tr v-if="result.lanes"><td>rows</td><td class="n">{{ result.lanes.length - 1 }} lane{{ result.lanes.length === 2 ? '' : 's' }} + Unassigned</td><td /></tr>
      </table>
      <p class="cv-soon">The {{ LAYOUT_LABELS[layout].toLowerCase() }} layout is drawn in a later round.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { Store } from '../store';
import { calendarFieldOf, type RecordRow } from '../state';
import { useDerived } from '../derived';
import { SCOPE } from '../scope';
import { hiddenSources, toggleSource } from '../calendarPrefs';
import {
  CalendarDef, LAYOUTS, LAYOUT_LABELS, calendarDefError, runCalendar,
  type CalendarContext, type CalendarField, type Layout,
} from '../../contract/calendar';

const props = defineProps<{ store: Store; calendarId: string }>();
defineEmits<{ 'open-record': [recordId: string] }>();

const store = props.store;
const derived = useDerived(store);
const scopeApi = inject(SCOPE, null);

const record = computed(() => store.state.records.get(props.calendarId));
const table = computed(() => (record.value ? store.state.tables.get(record.value.table_id) : undefined));
const field = computed(() => (table.value ? calendarFieldOf(store.state, table.value.id) : undefined));
const title = computed(() => (record.value ? derived.labelOfId(record.value.id) : 'calendar'));
const raw = computed(() => (record.value && field.value ? record.value.data[field.value.key] : undefined));

const def = computed<CalendarDef | null>(() => {
  if (raw.value === undefined) return null;
  const r = CalendarDef.safeParse(raw.value);
  return r.success ? r.data : null;
});

/** What is wrong enough that nothing can be shown. */
const problem = computed(() => {
  if (!record.value) return 'This calendar no longer exists.';
  if (!table.value || table.value.kind !== 'calendar') return 'This record is not a calendar.';
  if (!field.value) return 'This table of calendars has no "calendar" field — add a structured field with the shape "calendar".';
  if (raw.value === undefined) return 'No sources yet — open settings… and add a table to pour into this calendar.';
  if (!def.value) { const r = CalendarDef.safeParse(raw.value); const i = !r.success ? r.error.issues[0] : undefined; return `The definition does not parse: ${i ? `${i.path.join('.')}: ${i.message}` : 'unknown error'}`; }
  return '';
});

const fields = computed(() => [...store.state.fields.values()] as CalendarField[]);
/** Wrong, but runCalendar is lenient and still draws: shown above the body. */
const invalid = computed(() => (def.value ? (calendarDefError(def.value, fields.value, [...store.state.tables.values()]) ?? '').replace(/^calendar: /, '') : ''));

/* ── the layout: the definition's, unless a switch could not be saved ── */
const localLayout = ref<Layout | null>(null);
watch(() => props.calendarId, () => { localLayout.value = null; });
// Once the definition is fixed (or changed by anyone), the stored layout is the truth again.
watch(invalid, (now) => { if (!now) localLayout.value = null; });
const layout = computed<Layout>(() => {
  const l = localLayout.value ?? def.value?.layout ?? 'month';
  return l === 'resource' && !def.value?.rows ? 'month' : l;
});
const localOnly = computed(() => localLayout.value !== null && localLayout.value !== def.value?.layout);
function setLayout(l: Layout) {
  if (!def.value || !field.value || l === layout.value) return;
  if (invalid.value) { localLayout.value = l; return; }
  localLayout.value = null;
  store.mutate({ type: 'record.update', id: props.calendarId, set: { [field.value.key]: { ...def.value, layout: l } }, unset: [] });
}

/* ── the tables it reads: every source's, the rows', and those its filters and labels reach ── */
const tablesNeeded = computed(() => {
  const out = new Set<string>();
  const d = def.value;
  if (!d) return out;
  const read = (ids: string[]) => { for (const t of derived.tablesNeededBy(ids.map((id) => store.state.fields.get(id)).filter((f): f is NonNullable<typeof f> => !!f))) out.add(t); };
  for (const s of d.sources) { out.add(s.tableId); read([...s.label, ...s.filters.map((f) => f.fieldId)]); if (s.lane) read([s.lane]); }
  if (d.rows) { out.add(d.rows.tableId); read([...d.rows.filters.map((f) => f.fieldId), ...d.rows.sort.map((x) => x.fieldId)]); }
  return out;
});
watch(tablesNeeded, (ids) => { for (const id of ids) void store.loadTable(id); }, { immediate: true });
const loading = computed(() => [...tablesNeeded.value].some((id) => store.tableLoads.get(id)?.state === 'loading'));

const scopeNote = computed(() => {
  if (!def.value || !scopeApi) return '';
  const scoped = def.value.sources.filter((s) => scopeApi.filterFor(s.tableId)).length;
  return scoped ? scopeApi.describe(def.value.sources.find((s) => scopeApi.filterFor(s.tableId))!.tableId).note.replace(/^not scoped.*$/, '') : '';
});

const hidden = computed(() => hiddenSources(props.calendarId));

const ctx = computed<CalendarContext>(() => {
  const byTable = new Map<string, RecordRow[]>();
  for (const r of store.state.records.values()) { const a = byTable.get(r.table_id); if (a) a.push(r); else byTable.set(r.table_id, [r]); }
  return {
    fields: fields.value,
    tables: [...store.state.tables.values()],
    recordsOf: (t) => byTable.get(t) ?? [],
    linksFrom: derived.linksFrom,
    idsOf: derived.idsOf,
    labelOf: derived.labelOfId,
    links: (recordId, fieldId) => { const f = store.state.fields.get(fieldId); return f ? derived.textOf(recordId, f).texts : []; },
    // Scope narrows each table it applies to — every source, and the rows.
    inScope: scopeApi ? (r) => scopeApi.filterFor((r as RecordRow).table_id)?.(r as RecordRow) ?? true : undefined,
    hidden: hidden.value,
  };
});
const result = computed(() => (def.value ? runCalendar(def.value, ctx.value) : null));

const perSource = computed(() => (result.value ? result.value.legend.map((l) => {
  const evs = result.value!.events.filter((e) => e.sourceId === l.sourceId);
  const span = evs.length ? `${evs.reduce((m, e) => (e.start < m ? e.start : m), evs[0].start)} → ${evs.reduce((m, e) => (e.end > m ? e.end : m), evs[0].end)}` : '';
  return { ...l, n: evs.length, span, hidden: hidden.value.has(l.sourceId) };
}) : []));
</script>

<style scoped>
/* `display: contents`: the bar and the body are items of App's stage grid (App.vue, `.stage`). */
.calendarview { display: contents; }
.cv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 6px 12px; border-bottom: 1px solid var(--border-main); background: var(--controls-bg); font-size: 12px; }
.cv-bar > * { white-space: nowrap; }
.cv-kind { color: var(--text-faint); font-size: 11px; }
.cv-title { font-weight: 600; color: var(--text-primary); }
.cv-layouts { display: inline-flex; }
.cv-layout { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); padding: 1px 9px; cursor: pointer; font: inherit; font-size: 11px; margin-left: -1px; }
.cv-layout:first-child { border-radius: 3px 0 0 3px; margin-left: 0; }
.cv-layout:last-child { border-radius: 0 3px 3px 0; }
.cv-layout.on { color: var(--accent); border-color: var(--accent); position: relative; z-index: 1; }
.cv-layout:disabled { opacity: 0.35; cursor: default; }
.cv-legend { margin-left: 4px; }
.cv-src { background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: inherit; display: inline-flex; align-items: center; gap: 4px; }
.cv-src.off { opacity: 0.4; text-decoration: line-through; }
.cv-note { color: var(--text-muted); font-size: 11px; }
.cv-spacer { flex: 1; }
.cv-count { color: var(--text-muted); font-size: 11px; }
.cv-def { background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 3px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.cv-def:hover { border-color: var(--accent); }
.cv-body { overflow: auto; padding: 12px 16px 40px; }
.cv-warning { margin: 0 0 10px; color: var(--warning); font-size: 12px; }
.cv-problems { margin: 0 0 12px; padding-left: 18px; color: var(--warning); font-size: 12px; }
.cv-sources { border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
.cv-sources td { padding: 3px 14px 3px 0; color: var(--text-secondary); }
.cv-sources td.n { color: var(--text-primary); }
.cv-sources td.span { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.cv-soon { margin: 0; color: var(--text-faint); font-size: 11px; font-style: italic; }
.hint { padding: 24px; color: var(--text-muted); white-space: normal; max-width: 640px; }
</style>
