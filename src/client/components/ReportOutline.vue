<!--
  One SECTION of a report result (contract/reports.ts `ReportSection`), drawn as a
  table: a header row of the level's columns — the record, its role if any of the
  level's links carry one, the PAIR's fields for a level reached through a junction
  (the file's Delivery status, beside the file), its fields by name, its rollups by
  label — then one row
  per node, and under a node that has children, its child sections, nested and
  indented, each drawn by this same component.

  Read-only, and deliberately not the grid: no fixed row height, no windowing, no
  editing. A report is a document; it reads top to bottom and grows as tall as it
  is. An EMPTY section is drawn, as a line saying so — the absence is the
  information (REPORTS-BRIEF.md §1).
-->
<template>
  <div class="ro" :class="{ root: depth === 0 }">
    <div class="ro-head">
      <span class="ro-table">{{ tableName }}</span>
      <span class="ro-count">{{ section.nodes.length }}</span>
    </div>
    <p v-if="!section.nodes.length" class="ro-empty">— nothing —</p>
    <table v-else class="ro-table-el">
      <thead>
        <tr>
          <th class="c-label">{{ singular }}</th>
          <th v-if="hasRole" class="c-role">role</th>
          <th v-for="c in pairColumns" :key="'p' + c.id" class="c-field c-pair" :title="`${pairTableName}: ${c.name} — of the pair, not the ${singular}`">{{ c.name }}</th>
          <th v-for="c in columns" :key="c.id" class="c-field">{{ c.name }}</th>
          <th v-for="r in level.rollups" :key="r.id" class="c-rollup">{{ r.label || r.id }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="n in section.nodes" :key="n.record.id">
          <tr class="ro-row" :data-record="n.record.id" @click="$emit('open', n.record.id)">
            <td class="c-label"><span class="ro-label">{{ n.record.label }}</span></td>
            <td v-if="hasRole" class="c-role"><span v-for="r in n.roles" :key="r" class="ro-role">{{ r }}</span></td>
            <td v-for="c in pairColumns" :key="'p' + c.id" class="c-field c-pair" :title="pairText(n, c.id)">{{ pairText(n, c.id) }}</td>
            <td v-for="c in n.cells" :key="c.fieldId" class="c-field" :title="c.text">{{ c.text }}</td>
            <td v-for="r in n.rollups" :key="r.id" class="c-rollup" :class="{ zero: r.value === 0, none: r.value === null }">{{ r.value === null ? '—' : r.value }}</td>
          </tr>
          <tr v-if="n.children.length" class="ro-children">
            <td :colspan="span">
              <ReportOutline v-for="s in n.children" :key="s.levelId" :section="s" :level="levels.get(s.levelId)!" :levels="levels"
                             :depth="depth + 1" :fields="fields" :tables="tables" @open="$emit('open', $event)" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ReportNode, ReportSection, RootLevel, Descent } from '../../contract/reports';

const props = defineProps<{
  section: ReportSection;
  level: RootLevel | Descent;
  /** Every level of the definition by id, so a child section finds its own columns. */
  levels: Map<string, RootLevel | Descent>;
  depth: number;
  fields: Map<string, { id: string; name: string }>;
  tables: Map<string, { id: string; name: string; singular_name?: string }>;
}>();
defineEmits<{ open: [recordId: string] }>();

const table = computed(() => props.tables.get(props.section.tableId));
const tableName = computed(() => table.value?.name ?? '?');
const singular = computed(() => table.value?.singular_name || table.value?.name || 'record');
const hasRole = computed(() => 'via' in props.level && props.level.via.some((v) => !!v.role));
const columns = computed(() => props.level.fields.flatMap((id) => { const f = props.fields.get(id); return f ? [f] : []; }));
/** Through a junction: the pair's columns, drawn only where the walk found a junction to read them from. */
const pairColumns = computed(() => (props.section.pairTableId && 'pair' in props.level ? props.level.pair?.fields ?? [] : []).flatMap((id) => { const f = props.fields.get(id); return f ? [f] : []; }));
const pairTableName = computed(() => props.tables.get(props.section.pairTableId ?? '')?.name ?? 'pair');
const pairText = (n: ReportNode, fieldId: string) => n.pair?.cells.find((c) => c.fieldId === fieldId)?.text ?? '';
const span = computed(() => 1 + (hasRole.value ? 1 : 0) + pairColumns.value.length + columns.value.length + props.level.rollups.length);
</script>

<style scoped>
.ro { display: flex; flex-direction: column; gap: 4px; }
.ro-head { display: flex; align-items: baseline; gap: 6px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); padding: 2px 0; }
.ro.root > .ro-head { font-size: 11px; color: var(--text-muted); }
.ro-count { background: var(--bg-app); border-radius: 8px; padding: 0 6px; letter-spacing: 0; text-transform: none; }
.ro-empty { margin: 0 0 4px; color: var(--text-faint); font-size: 12px; font-style: italic; }
.ro-table-el { border-collapse: collapse; width: 100%; font-size: 12px; }
th { text-align: left; font-weight: 600; color: var(--text-muted); font-size: 11px; padding: 3px 8px 3px 0; border-bottom: 1px solid var(--border-main); white-space: nowrap; }
td { padding: 3px 8px 3px 0; vertical-align: top; border-bottom: 1px solid color-mix(in srgb, var(--border-main) 50%, transparent); }
.ro-row { cursor: pointer; }
.ro-row:hover td { background: var(--bg-surface-hover); }
.ro-label { font-weight: 600; color: var(--text-primary); }
.c-field { color: var(--text-secondary); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-pair { color: var(--text-primary); }
.c-rollup { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.c-rollup.zero { color: var(--warning); }
.c-rollup.none { color: var(--text-faint); }
.ro-role { display: inline-block; font-size: 10px; border: 1px solid var(--border-main); border-radius: 3px; padding: 0 4px; margin-right: 3px; color: var(--text-muted); }
.ro-children > td { padding: 4px 0 10px 22px; border-bottom: none; border-left: 2px solid var(--border-main); }
</style>
