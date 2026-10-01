<!--
  A report, OPEN (REPORTS-BRIEF.md §2, "renderings"): the record's definition is
  parsed, the tables it walks are loaded, `runReport` runs — on the client, over the
  same store the grid reads, so a peer's edit reappears here as it does in a grid —
  and the result is drawn by ReportOutline. Nothing is stored; a report is DERIVED
  each time it is looked at. Scope filters the root level only (§3), through the
  same ScopeApi every grid asks.

  Read-only. The definition is edited on the record (the tray's JSON editor now, the
  level editor later); "definition…" opens it.
-->
<template>
  <div class="reportview">
    <div class="rv-bar">
      <span class="rv-kind">▤ report</span>
      <span class="rv-title">{{ title }}</span>
      <span v-if="scopeNote" class="rv-note">{{ scopeNote }}</span>
      <span v-if="loading" class="rv-note">loading…</span>
      <span class="rv-spacer" />
      <span v-if="result" class="rv-count">{{ result.nodes.length }} {{ rootTableName }}</span>
      <button class="rv-def" title="Open the report's record — its definition is edited there" @click="$emit('open-record', reportId)">definition…</button>
    </div>
    <p v-if="problem" class="hint">{{ problem }}</p>
    <div v-else-if="result && rootLevel" class="rv-body">
      <p v-if="warning" class="rv-warning">⚠ {{ warning }}</p>
      <ReportOutline :section="result" :level="rootLevel" :levels="levels" :depth="0" :fields="fieldMap" :tables="store.state.tables"
                     @open="$emit('open-record', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, watch } from 'vue';
import type { Store } from '../store';
import { reportFieldOf, type RecordRow } from '../state';
import { useDerived } from '../derived';
import { SCOPE } from '../scope';
import { ReportDef, reportDefError, reportSchema, resolvePin, resolveVia, runReport, type Descent, type ReportContext, type ReportField, type RootLevel } from '../../contract/reports';
import ReportOutline from './ReportOutline.vue';

const props = defineProps<{ store: Store; reportId: string }>();
defineEmits<{ 'open-record': [recordId: string] }>();

const store = props.store;
const derived = useDerived(store);
const scopeApi = inject(SCOPE, null);

const record = computed(() => store.state.records.get(props.reportId));
const table = computed(() => (record.value ? store.state.tables.get(record.value.table_id) : undefined));
const field = computed(() => (table.value ? reportFieldOf(store.state, table.value.id) : undefined));
const title = computed(() => (record.value ? derived.labelOfId(record.value.id) : 'report'));
const raw = computed(() => (record.value && field.value ? record.value.data[field.value.key] : undefined));

const parsed = computed(() => {
  if (raw.value === undefined) return null;
  const r = ReportDef.safeParse(raw.value);
  return r.success ? r.data : null;
});
const def = computed(() => parsed.value);
const rootLevel = computed(() => def.value?.root);

/** Every level by id — the outline looks its own columns up here. */
const levels = computed(() => {
  const m = new Map<string, RootLevel | Descent>();
  const walk = (l: RootLevel | Descent) => { m.set(l.id, l); for (const c of l.children) walk(c); };
  if (def.value) walk(def.value.root);
  return m;
});

/** What is wrong enough that nothing can be shown. */
const problem = computed(() => {
  if (!record.value) return 'This report no longer exists.';
  if (!table.value || table.value.kind !== 'report') return 'This record is not a report.';
  if (!field.value) return 'This table of reports has no "report" field — add a structured field with the shape "report".';
  if (raw.value === undefined) return 'No definition yet — open the record (definition…) and edit the Report field as JSON. REPORTS-BRIEF.md has the shape.';
  if (!def.value) { const r = ReportDef.safeParse(raw.value); const i = !r.success ? r.error.issues[0] : undefined; return `The definition does not parse: ${i ? `${i.path.join('.')}: ${i.message}` : 'unknown error'}`; }
  return '';
});
/** Wrong, but the walk still runs (read-time is lenient): shown above the outline. */
const warning = computed(() => (def.value ? reportDefError(def.value, fields.value, [...store.state.tables.values()]) ?? '' : ''));

const fields = computed(() => [...store.state.fields.values()] as ReportField[]);
const fieldMap = computed(() => store.state.fields as Map<string, { id: string; name: string }>);

/**
 * The tables the walk lands in — each must be loaded, like a lookup's far table —
 * and the JUNCTION tables it goes through: their pair rows are what the walk follows.
 */
const schema = computed(() => reportSchema(fields.value, store.state.tables.values()));
const tablesNeeded = computed(() => {
  const out = new Set<string>();
  if (!def.value) return out;
  const walk = (l: RootLevel | Descent, tableId: string, above: { id: string; table: string }[]) => {
    out.add(tableId);
    const here = [...above, { id: l.id, table: tableId }];
    for (const c of l.children) {
      let landing = '';
      for (const v of c.via) {
        const d = resolveVia(tableId, v, schema.value);
        if (typeof d === 'string') continue;
        landing ||= d.table;
        if (d.dir === 'junction') out.add(d.junction);
      }
      if (!landing) continue;
      for (const p of c.pins ?? []) {                      // a pin through a junction reads its pair rows too
        const anc = here.find((a) => a.id === p.levelId);
        const d = anc ? resolvePin(landing, anc.table, p.fieldId, schema.value) : null;
        if (d && typeof d !== 'string' && d.dir === 'junction') out.add(d.junction);
      }
      walk(c, landing, here);
    }
  };
  walk(def.value.root, def.value.root.table, []);
  return out;
});
watch(tablesNeeded, (ids) => { for (const id of ids) void store.loadTable(id); }, { immediate: true });
const loading = computed(() => [...tablesNeeded.value].some((id) => store.tableLoads.get(id)?.state === 'loading'));

const rootTableName = computed(() => (def.value ? store.state.tables.get(def.value.root.table)?.name ?? '' : ''));
const scopeNote = computed(() => (def.value && scopeApi ? scopeApi.describe(def.value.root.table).note.replace(/^not scoped.*$/, '') : ''));

const ctx = computed<ReportContext>(() => {
  const inScope = def.value && scopeApi ? scopeApi.filterFor(def.value.root.table) : null;
  const byTable = new Map<string, RecordRow[]>();
  for (const r of store.state.records.values()) { const a = byTable.get(r.table_id); if (a) a.push(r); else byTable.set(r.table_id, [r]); }
  return {
    fields: fields.value,
    tables: [...store.state.tables.values()],
    recordsOf: (t) => byTable.get(t) ?? [],
    linksFrom: derived.linksFrom,
    linksTo: derived.linkedTo,
    labelOf: derived.labelOfId,
    links: (recordId, fieldId) => { const f = store.state.fields.get(fieldId); return f ? derived.textOf(recordId, f).texts : []; },
    inScope: inScope ? (r) => inScope(r as RecordRow) : undefined,
  };
});
const result = computed(() => (def.value ? runReport(def.value, ctx.value) : null));
</script>

<style scoped>
.reportview { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.rv-bar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--border-main); background: var(--controls-bg); font-size: 12px; }
.rv-kind { color: var(--text-faint); font-size: 11px; }
.rv-title { font-weight: 600; color: var(--text-primary); }
.rv-note { color: var(--text-muted); font-size: 11px; }
.rv-spacer { flex: 1; }
.rv-count { color: var(--text-muted); font-size: 11px; }
.rv-def { background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 3px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.rv-def:hover { border-color: var(--accent); }
.rv-body { flex: 1; overflow: auto; padding: 12px 16px 40px; }
.rv-warning { margin: 0 0 10px; color: var(--warning); font-size: 12px; }
.hint { padding: 24px; color: var(--text-muted); white-space: normal; max-width: 640px; }
</style>
