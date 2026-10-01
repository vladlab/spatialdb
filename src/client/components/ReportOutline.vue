<!--
  One SECTION of a report result (contract/reports.ts `ReportSection`), drawn as a
  table, and under a node that has children, its child sections, nested and
  indented, each drawn by this same component.

  A report is a document: it reads top to bottom and should spend its lines on
  records, not on scaffolding. So a section has at most ONE line above its rows —
  the header row, whose first cell is the section's own label (the table's name and
  its count) and whose other cells name the level's columns: its role if any of the
  level's links carry one, the PAIR's fields for a level reached through a junction
  (the file's Delivery status, beside the file), its fields, its rollups. And that
  line is drawn only where it says something:
    - on a section that HAS columns to name;
    - on a nested section with none, only when its node has other child sections
      to tell it from. A lone column of names needs no title: ReportView's
      "Deliverables › Work › Files" line says what the levels are, and its bar
      already counts the root ("3 Deliverables").
  An EMPTY section is one line, "— no files —": the absence is the information
  (REPORTS-BRIEF.md §1), and it does not need a heading to say so.

  Columns hug their content (a trailing filler cell takes the slack), so a file and
  its status sit together instead of at opposite edges of the window. Every section
  of a level is its own small table, so to make them read as ONE — the Status of
  every file at the same x — each ends in an invisible, zero-height SIZER row
  holding the level's longest texts per column (`sizers`, from ReportView): the
  browser then gives all of them the same column widths, in the real font, with
  nothing measured or estimated here.

  Read-only, and deliberately not the grid: no fixed row height, no windowing, no
  editing.
-->
<template>
  <div class="ro" :class="{ root: depth === 0 }">
    <p v-if="!section.nodes.length" class="ro-empty">— no {{ tableName.toLowerCase() }} —</p>
    <table v-else class="ro-table-el">
      <thead v-if="showHead">
        <tr>
          <th class="c-label"><span class="ro-table">{{ tableName }}</span><span class="ro-count">{{ section.nodes.length }}</span></th>
          <th v-if="hasRole" class="c-role">role</th>
          <th v-for="c in pairColumns" :key="'p' + c.id" class="c-field c-pair" :title="`${pairTableName}: ${c.name} — of the pair, not the ${singular}`">{{ c.name }}</th>
          <th v-for="c in columns" :key="c.id" class="c-field">{{ c.name }}</th>
          <th v-for="r in level.rollups" :key="r.id" class="c-rollup">{{ r.label || r.id }}</th>
          <th class="c-fill" aria-hidden="true"></th>
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
            <td class="c-fill" aria-hidden="true"></td>
          </tr>
          <tr v-if="n.children.length" class="ro-children">
            <td :colspan="span">
              <ReportOutline v-for="s in n.children" :key="s.levelId" :section="s" :level="levels.get(s.levelId)!" :levels="levels"
                             :depth="depth + 1" :alone="n.children.length === 1" :sizers="sizers" :fields="fields" :tables="tables" @open="$emit('open', $event)" />
            </td>
          </tr>
        </template>
      </tbody>
      <tfoot v-if="sizers?.has(level.id)" class="ro-sizer" aria-hidden="true">
        <tr>
          <td class="c-label"><span v-for="t in sz('label')" :key="t" class="ro-label">{{ t }}</span></td>
          <td v-if="hasRole" class="c-role"></td>
          <td v-for="c in pairColumns" :key="'p' + c.id" class="c-field c-pair"><span v-for="t in sz('p:' + c.id)" :key="t">{{ t }}</span></td>
          <td v-for="c in columns" :key="c.id" class="c-field"><span v-for="t in sz('f:' + c.id)" :key="t">{{ t }}</span></td>
          <td v-for="r in level.rollups" :key="r.id" class="c-rollup"></td>
          <td class="c-fill"></td>
        </tr>
      </tfoot>
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
  /** This section is its node's ONLY child section — so, with no columns to name, it needs no header. */
  alone?: boolean;
  /** Per level id, the longest few texts of each column ('label', 'f:<field>', 'p:<pair field>') — what the sizer row holds. */
  sizers?: Map<string, Record<string, string[]>>;
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
const extra = computed(() => (hasRole.value ? 1 : 0) + pairColumns.value.length + columns.value.length + props.level.rollups.length);
const span = computed(() => 2 + extra.value);   // the label, the columns, the filler
/** One line above the rows, only where it says something (see the header comment). */
const showHead = computed(() => extra.value > 0 || (props.depth > 0 && !props.alone));
const sz = (key: string) => props.sizers?.get(props.level.id)?.[key] ?? [];
</script>

<style scoped>
.ro { display: flex; flex-direction: column; }
.ro + .ro { margin-top: 4px; }
.ro-empty { margin: 0; padding: 1px 0; color: var(--text-faint); font-size: 11px; font-style: italic; }
.ro-table-el { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; vertical-align: top; white-space: nowrap; padding: 2px 28px 2px 0; }
th { font-weight: 600; color: var(--text-muted); font-size: 11px; padding-top: 1px; padding-bottom: 3px; border-bottom: 1px solid var(--border-main); }
/* The filler takes whatever width the columns do not need, so they hug their content. */
.c-fill { width: 100%; padding: 0; }
.ro-table { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
.ro-count { margin-left: 6px; font-weight: 400; font-size: 10px; color: var(--text-faint); background: var(--bg-app); border-radius: 8px; padding: 0 6px; }
.ro-row { cursor: pointer; }
.ro-row:hover td { background: var(--bg-surface-hover); }
/* Rules only between the report's top-level records: the nesting is drawn by the indent and its left line. */
.ro.root > table > tbody > .ro-row:not(:first-child) > td { border-top: 1px solid color-mix(in srgb, var(--border-main) 60%, transparent); }
.ro.root > table > tbody > .ro-row > td { padding-top: 5px; padding-bottom: 3px; }
.ro-label { font-weight: 600; color: var(--text-primary); }
.c-field { color: var(--text-secondary); max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.c-pair { color: var(--text-primary); }
.c-rollup { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-primary); }
.c-rollup.zero { color: var(--warning); }
.c-rollup.none { color: var(--text-faint); }
.ro-role { display: inline-block; font-size: 10px; border: 1px solid var(--border-main); border-radius: 3px; padding: 0 4px; margin-right: 3px; color: var(--text-muted); }
/* The sizer: no height, no paint — only its width counts. */
.ro-sizer td { padding-top: 0; padding-bottom: 0; border: 0; line-height: 0; visibility: hidden; }
.ro-sizer span { display: block; height: 0; overflow: hidden; }
.ro-children > td { padding: 0 0 5px 14px; border-left: 2px solid var(--border-main); white-space: normal; }
.ro.root > table > tbody > .ro-children > td { padding-bottom: 8px; }
</style>
