<!--
  One SECTION of a report result (contract/reports.ts `ReportSection`), and under
  each of its nodes, its child sections, nested, each drawn by this same component.

  Two shapes, by whether the level HAS CHILD LEVELS (Oct 17, the owner's pick from
  mockups — "much more clear what the layers are"):

  - A BRANCH level (Work, Deliverable — anything with levels beneath it): each record
    is a BAND, tinted by depth like the grid's group headers — the outermost the
    deeper blue, the next a lighter blue, deeper ones neutral — carrying the level's
    name, the record's label, a count chip per child section ("2 deliverables"), its
    roles, its pair fields and own fields as small name·value pairs, and its rollups
    at the right ("Accepted 2"). Its child sections sit indented beneath it. A band
    is a heading: the record IS the section.
  - A LEAF level (Files): a table, as before — at most ONE line above its rows (the
    header row, naming the level's columns: a role, the PAIR's fields, its fields, its
    rollups), drawn only where it says something. Columns hug their content (a
    trailing filler takes the slack) and every section of a level ends in an
    invisible, zero-height SIZER row holding the level's longest texts per column
    (`sizers`, from ReportView), so all its small tables get the same column widths
    from the browser itself.

  GROUPS (`section.groups`, a level with `groupBy`): the nodes of either shape are
  drawn in labelled RUNS — "STATUS · Accepted · 2" — the grid's "group ·" inside one
  level; a run with no value is "(empty)".

  An EMPTY section is one line, "— no files —": the absence is the information
  (REPORTS-BRIEF.md §1). Read-only, and deliberately not the grid: no fixed row
  height, no windowing, no editing. A click on a row or a band opens the record.
-->
<template>
  <div class="ro" :class="[{ root: depth === 0, branch }, `d${Math.min(depth, 2)}`]">
    <p v-if="!section.nodes.length" class="ro-empty">— no {{ tableName.toLowerCase() }} —</p>

    <!-- BRANCH: bands -->
    <template v-else-if="branch">
      <template v-for="run in runs" :key="run.key">
        <div v-if="run.label !== null" class="ro-grp" :class="{ empty: run.label === '' }">
          <span class="ro-grp-field">{{ groupFieldName }}</span><span class="ro-grp-label">{{ run.label || '(empty)' }}</span><span class="ro-grp-count">{{ run.nodes.length }}</span>
        </div>
        <template v-for="n in run.nodes" :key="n.record.id">
          <div class="ro-row ro-band" :class="[{ painted: !!n.paint?.row }, n.paint?.row ? `tint-${n.paint.row.tint}` : '']" :data-record="n.record.id" @click="$emit('open', n.record.id)">
            <span class="ro-level">{{ singular }}</span>
            <span class="ro-label">{{ n.record.label }}</span>
            <span v-if="n.paint?.row?.label" class="ro-tint-label">{{ n.paint.row.label }}</span>
            <span v-for="s in n.children" :key="s.levelId" class="ro-chip" :class="{ none: !s.nodes.length }">{{ s.nodes.length }} {{ countNoun(s) }}</span>
            <span v-for="r in n.roles" :key="r" class="ro-role">{{ r }}</span>
            <span v-for="c in pairColumns" :key="'p' + c.id" class="ro-kv pair" :class="tintClass(n, c.id)" :title="`${pairTableName}: ${c.name} — of the pair, not the ${singular}`"><span class="k">{{ c.name }}</span>{{ pairText(n, c.id) }}</span>
            <span v-for="c in n.cells" :key="c.fieldId" class="ro-kv" :class="tintClass(n, c.fieldId)"><span class="k">{{ fields.get(c.fieldId)?.name }}</span>{{ c.text }}</span>
            <span class="ro-spacer" />
            <span v-for="r in n.rollups" :key="r.id" class="ro-roll" :class="{ zero: r.value === 0, none: r.value === null }"><span class="k">{{ r.label || r.id }}</span>{{ r.value === null ? '—' : r.value }}</span>
          </div>
          <div class="ro-kids">
            <ReportOutline v-for="s in n.children" :key="s.levelId" :section="s" :level="levels.get(s.levelId)!" :levels="levels"
                           :depth="depth + 1" :alone="n.children.length === 1" :sizers="sizers" :fields="fields" :tables="tables" @open="$emit('open', $event)" />
          </div>
        </template>
      </template>
    </template>

    <!-- LEAF: a table -->
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
        <template v-for="run in runs" :key="run.key">
          <tr v-if="run.label !== null" class="ro-grp-row" :class="{ empty: run.label === '' }">
            <td :colspan="span"><div class="ro-grp"><span class="ro-grp-field">{{ groupFieldName }}</span><span class="ro-grp-label">{{ run.label || '(empty)' }}</span><span class="ro-grp-count">{{ run.nodes.length }}</span></div></td>
          </tr>
          <tr v-for="n in run.nodes" :key="n.record.id" class="ro-row" :class="[{ grouped: run.label !== null, painted: !!n.paint?.row }, n.paint?.row ? `tint-${n.paint.row.tint}` : '']" :data-record="n.record.id" @click="$emit('open', n.record.id)">
            <td class="c-label"><span class="ro-label">{{ n.record.label }}</span><span v-if="n.paint?.row?.label" class="ro-tint-label">{{ n.paint.row.label }}</span></td>
            <td v-if="hasRole" class="c-role"><span v-for="r in n.roles" :key="r" class="ro-role">{{ r }}</span></td>
            <td v-for="c in pairColumns" :key="'p' + c.id" class="c-field c-pair" :class="tintClass(n, c.id)" :title="pairText(n, c.id)">{{ pairText(n, c.id) }}</td>
            <td v-for="c in n.cells" :key="c.fieldId" class="c-field" :class="tintClass(n, c.fieldId)" :title="c.text">{{ c.text }}</td>
            <td v-for="r in n.rollups" :key="r.id" class="c-rollup" :class="{ zero: r.value === 0, none: r.value === null }">{{ r.value === null ? '—' : r.value }}</td>
            <td class="c-fill" aria-hidden="true"></td>
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
/** A level with levels beneath it: its records are bands, not rows. */
const branch = computed(() => props.level.children.length > 0);
const hasRole = computed(() => 'via' in props.level && props.level.via.some((v) => !!v.role));
const columns = computed(() => props.level.fields.flatMap((id) => { const f = props.fields.get(id); return f ? [f] : []; }));
/** Through a junction: the pair's columns, drawn only where the walk found a junction to read them from. */
const pairColumns = computed(() => (props.section.pairTableId && 'pair' in props.level ? props.level.pair?.fields ?? [] : []).flatMap((id) => { const f = props.fields.get(id); return f ? [f] : []; }));
const pairTableName = computed(() => props.tables.get(props.section.pairTableId ?? '')?.name ?? 'pair');
const pairText = (n: ReportNode, fieldId: string) => n.pair?.cells.find((c) => c.fieldId === fieldId)?.text ?? '';
/** A cell a colour rule painted (contract/colorRules.ts): the tint's classes, else nothing. */
const tintClass = (n: ReportNode, fieldId: string) => { const p = n.paint?.fields[fieldId]; return p ? ['cell-painted', `tint-${p.tint}`] : undefined; };
const extra = computed(() => (hasRole.value ? 1 : 0) + pairColumns.value.length + columns.value.length + props.level.rollups.length);
const span = computed(() => 2 + extra.value);   // the label, the columns, the filler
/** One line above the rows, only where it says something (see the header comment). */
const showHead = computed(() => extra.value > 0 || (props.depth > 0 && !props.alone));
const sz = (key: string) => props.sizers?.get(props.level.id)?.[key] ?? [];
/** The runs to draw: the groups when the level has them, else one unlabelled run of everything. */
const runs = computed(() => (props.section.groups ? props.section.groups.map((g, i) => ({ key: `g${i}`, label: g.label as string | null, nodes: g.nodes })) : [{ key: 'all', label: null, nodes: props.section.nodes }]));
const groupFieldName = computed(() => (props.level.groupBy ? props.fields.get(props.level.groupBy)?.name ?? '' : ''));
/** "2 deliverables" / "1 deliverable": a child section's count with its table's name. */
const countNoun = (s: ReportSection) => { const t = props.tables.get(s.tableId); const n = s.nodes.length; return (n === 1 ? t?.singular_name || t?.name : t?.name) ?? 'records'; };
</script>

<style scoped>
.ro { display: flex; flex-direction: column; }
.ro + .ro { margin-top: 4px; }
.ro-empty { margin: 0; padding: 1px 0; color: var(--text-faint); font-size: 11px; font-style: italic; }

/* ── bands: a BRANCH level's records (tinted by depth, as the grid's group headers) ── */
.ro-band { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 3px 10px; margin: 6px 0 2px; border-radius: 3px; cursor: pointer; flex-wrap: wrap;
  background: var(--bg-group-2); border-top: 1px solid var(--group-rule-2); }
.ro.d0 > .ro-band { background: var(--bg-group-0); border-top: 2px solid var(--group-rule-0); min-height: 38px; }
.ro.d1 > .ro-band { background: var(--bg-group-1); border-top: 1px solid var(--group-rule-1); }
.ro-band:hover { filter: brightness(1.12); }
/* PAINTED by a colour rule (contract/colorRules.ts): the tint's WASH over the depth
   tint, a stripe at the left, and the rule's label (if it has one) by the record's name.
   The depth tint still shows through, so a green band at depth 1 is still a depth-1 band. */
.ro-band.painted { box-shadow: inset 4px 0 0 var(--tint); background-image: linear-gradient(var(--tint-wash), var(--tint-wash)); padding-left: 14px; }
.ro-tint-label { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--tint); white-space: nowrap; }
/* A painted name·value pair on a band, or cell in a table: the tint's capsule. */
.ro-kv.cell-painted { background: var(--tint-cap); box-shadow: inset 0 0 0 1px var(--tint-ring); border-radius: 9px; padding: 0 7px; }
td.cell-painted { background: linear-gradient(var(--tint-cap), var(--tint-cap)), transparent; box-shadow: inset 0 0 0 1px var(--tint-ring); padding-left: 6px; padding-right: 6px !important; }
tr.ro-row.painted > td { background: var(--tint-wash); }
tr.ro-row.painted > td.c-label { box-shadow: inset 3px 0 0 var(--tint); padding-left: 8px; }
tr.ro-row.painted > td .ro-tint-label { margin-left: 8px; }
tr.ro-row.painted:hover td { background: linear-gradient(var(--bg-surface-hover), var(--bg-surface-hover)), var(--tint-wash); }
.ro-band .ro-level { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--group-text-2); }
.ro.d0 > .ro-band .ro-level { color: var(--group-text-0); }
.ro.d1 > .ro-band .ro-level { color: var(--group-text-1); }
.ro-band .ro-label { font-size: 14px; font-weight: 600; color: var(--group-label); }
.ro.d0 > .ro-band .ro-label { font-size: 15px; font-weight: 650; }
.ro-chip { font-size: 11px; border-radius: 9px; padding: 0 8px; line-height: 17px; background: var(--chip-bg); border: 1px solid var(--chip-line); color: var(--chip-text); white-space: nowrap; }
.ro-chip.none { background: none; border-color: var(--border-main); color: var(--text-muted); }
.ro-kv { font-size: 12px; color: var(--text-primary); white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.ro-kv .k, .ro-roll .k { font-size: 10.5px; color: var(--text-muted); margin-right: 5px; }
.ro-spacer { flex: 1; }
.ro-roll { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-primary); white-space: nowrap; }
.ro-roll.zero { color: var(--warning); }
.ro-roll.none { color: var(--text-faint); }
.ro-kids { margin-left: 14px; padding: 0 0 4px 12px; border-left: 2px solid var(--border-main); }

/* ── group runs ("STATUS · Accepted · 2"), in both shapes ── */
.ro-grp { display: flex; align-items: center; gap: 6px; padding: 6px 0 1px 6px; border-left: 3px solid var(--border-main); margin-top: 2px; }
.ro-grp-field { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
.ro-grp-label { font-weight: 650; font-size: 12.5px; color: var(--text-primary); }
.ro-grp.empty .ro-grp-label { color: var(--text-muted); font-style: italic; font-weight: 400; }
.ro-grp-count { font-size: 10px; color: var(--text-muted); background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 0 6px; }
.ro-grp-row > td { padding: 0 !important; }
.ro-row.grouped > td.c-label { padding-left: 9px; }

/* ── the table: a LEAF level's records ── */
.ro-table-el { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; vertical-align: top; white-space: nowrap; padding: 2px 28px 2px 0; }
th { font-weight: 600; color: var(--text-muted); font-size: 11px; padding-top: 1px; padding-bottom: 3px; border-bottom: 1px solid var(--border-main); }
/* The filler takes whatever width the columns do not need, so they hug their content. */
.c-fill { width: 100%; padding: 0; }
.ro-table { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); }
.ro-count { margin-left: 6px; font-weight: 400; font-size: 10px; color: var(--text-faint); background: var(--bg-app); border-radius: 8px; padding: 0 6px; }
.ro-row { cursor: pointer; }
tr.ro-row:hover td { background: var(--bg-surface-hover); }
/* Rules only between a leaf root's records (a table at the top): nesting elsewhere is drawn by the bands and the indent. */
.ro.root:not(.branch) > table > tbody > .ro-row:not(:first-child) > td { border-top: 1px solid color-mix(in srgb, var(--border-main) 60%, transparent); }
.ro.root:not(.branch) > table > tbody > .ro-row > td { padding-top: 5px; padding-bottom: 3px; }
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
</style>
