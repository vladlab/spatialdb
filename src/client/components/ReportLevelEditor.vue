<!--
  ONE LEVEL of a report definition, edited (REPORTS-BRIEF.md §3, built as the brief's
  step 4). Every choice here is a pick from a closed set the schema enumerates —
  which link fields connect to the parent's table, which fields the level's table
  has, which ops a field's type allows, which ancestors a pin may name, which child
  levels a rollup may run over. Only roles and rollup labels are typed.

  The component edits a DRAFT (a plain object owned by ReportEditor) in place and
  emits `change` so the parent re-validates; nothing is written until Save. It
  draws itself for each child level, indented, so the tree of levels is the tree of
  components.

  The level's table is not stored on a descent (the walk derives it from `via`), so
  it is passed in as `table` — and is '' until a via is picked, at which point the
  choice of further vias narrows to links landing in the same table.
-->
<template>
  <div class="rl" :class="{ root: depth === 0 }">
    <div class="rl-head">
      <span class="rl-depth">{{ depth === 0 ? 'root' : '↳' }}</span>
      <template v-if="depth === 0">
        <select class="rl-table" :value="(level as RootLevel).table" @change="setRootTable(val($event))">
          <option value="" disabled>table…</option>
          <option v-for="t in tableChoices" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </template>
      <template v-else>
        <span class="rl-tname">{{ tableName || 'via…' }}</span>
        <button class="rl-x" title="Remove this level and everything under it" @click="$emit('remove')">×</button>
      </template>
      <span class="rl-id" :title="`level id: ${level.id} — what pins and rollups refer to`">{{ level.id }}</span>
    </div>

    <!-- VIA: which links this level descends through. Forward links live on the
         parent's table; backlinks are link fields elsewhere that target it. -->
    <div v-if="depth > 0" class="rl-block">
      <span class="rl-label">via</span>
      <div class="rl-rows">
        <label v-for="c in viaChoices" :key="c.fieldId" class="rl-via" :class="{ off: c.disabled }" :title="c.disabled ? 'lands in a different table than the links already chosen' : c.title">
          <input type="checkbox" :checked="viaIndex(c.fieldId) >= 0" :disabled="c.disabled" @change="toggleVia(c.fieldId, ($event.target as HTMLInputElement).checked)" />
          <span class="rl-via-name">{{ c.label }}</span>
          <span class="rl-via-dir">{{ c.dir === 'forward' ? '→' : '←' }} {{ c.tableName }}</span>
          <input v-if="viaIndex(c.fieldId) >= 0" class="rl-role" :value="d.via[viaIndex(c.fieldId)].role ?? ''" placeholder="role" title="Shown on every record reached through this link: 'bid', 'added'" @change="setRole(c.fieldId, val($event))" />
        </label>
        <p v-if="!viaChoices.length" class="rl-note">no link fields connect to {{ parentTableName }} — add one to a table first</p>
      </div>
    </div>

    <!-- PINS: the record must ALSO link to an ancestor two or more levels up. -->
    <div v-if="depth > 1 && table" class="rl-block">
      <span class="rl-label">pinned to</span>
      <div class="rl-rows">
        <label v-for="p in pinChoices" :key="p.key" class="rl-via" :title="`this ${singular} must also link, through ${p.fieldName}, to the ${p.ancestorTable} above`">
          <input type="checkbox" :checked="hasPin(p.fieldId, p.levelId)" @change="togglePin(p.fieldId, p.levelId, ($event.target as HTMLInputElement).checked)" />
          <span class="rl-via-name">{{ p.ancestorTable }}</span>
          <span class="rl-via-dir">through {{ p.fieldName }}</span>
        </label>
        <p v-if="!pinChoices.length" class="rl-note">no link joins {{ tableName }} to a level above the parent</p>
      </div>
    </div>

    <template v-if="table">
      <!-- FIELDS: explicit columns. -->
      <div class="rl-block">
        <span class="rl-label">show</span>
        <div class="rl-rows rl-fields">
          <label v-for="f in tableFields" :key="f.id" class="rl-field">
            <input type="checkbox" :checked="level.fields.includes(f.id)" @change="toggleField(f.id, ($event.target as HTMLInputElement).checked)" /> {{ f.name }}
          </label>
        </div>
      </div>

      <!-- FILTERS -->
      <div class="rl-block">
        <span class="rl-label">filter</span>
        <div class="rl-rows">
          <div v-for="(f, i) in level.filters" :key="i" class="rl-line">
            <select :value="f.fieldId" @change="changeFilterField(i, val($event))">
              <option v-for="fl in filterable" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
            </select>
            <select :value="f.op" @change="patchFilter(i, { op: val($event) as FilterOp })">
              <option v-for="op in opsOf(f.fieldId)" :key="op" :value="op">{{ OP_LABEL[op] }}</option>
            </select>
            <template v-if="f.op !== 'empty' && f.op !== 'notEmpty'">
              <select v-if="choicesOf(f.fieldId).length" :value="String(f.value ?? '')" @change="patchFilterValue(i, val($event))">
                <option value=""></option>
                <option v-for="c in choicesOf(f.fieldId)" :key="c" :value="c">{{ c }}</option>
              </select>
              <select v-else-if="typeOf(f.fieldId) === 'checkbox'" :value="String(f.value === true)" @change="patchFilter(i, { value: val($event) === 'true' })">
                <option value="true">ticked</option>
                <option value="false">not ticked</option>
              </select>
              <input v-else :type="typeOf(f.fieldId) === 'number' ? 'number' : typeOf(f.fieldId) === 'date' ? 'date' : 'text'" :value="f.value ?? ''" placeholder="value…" @change="patchFilterValue(i, val($event))" />
            </template>
            <button class="rl-x" @click="removeAt(level.filters, i)">×</button>
          </div>
          <button v-if="filterable.length" class="rl-add add-filter" @click="addFilter">+ filter</button>
        </div>
      </div>

      <!-- SORT -->
      <div class="rl-block">
        <span class="rl-label">sort</span>
        <div class="rl-rows">
          <div v-for="(s, i) in level.sort" :key="i" class="rl-line">
            <select :value="s.fieldId" @change="s.fieldId = val($event); changed()">
              <option v-for="fl in tableFields" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
            </select>
            <select :value="s.dir" @change="s.dir = val($event) as 'asc' | 'desc'; changed()">
              <option value="asc">ascending</option><option value="desc">descending</option>
            </select>
            <button class="rl-x" @click="removeAt(level.sort, i)">×</button>
          </div>
          <button v-if="tableFields.length" class="rl-add add-sort" @click="level.sort.push({ fieldId: tableFields[0].id, dir: 'asc' }); changed()">+ sort</button>
        </div>
      </div>

      <!-- ROLLUPS: over a direct child level. -->
      <div v-if="level.children.length" class="rl-block">
        <span class="rl-label">rollups</span>
        <div class="rl-rows">
          <div v-for="(r, i) in level.rollups" :key="r.id" class="rl-rollup">
            <div class="rl-line">
              <input class="rl-rlabel" :value="r.label" placeholder="label" @change="r.label = val($event); changed()" />
              <select :value="r.op" @change="setRollupOp(r, val($event) as RollupOp)">
                <option v-for="op in ROLLUP_OPS" :key="op" :value="op">{{ ROLLUP_LABELS[op] }}</option>
              </select>
              <select v-if="r.op !== 'count' && r.op !== 'countWhere'" :value="r.fieldId ?? ''" @change="r.fieldId = val($event); changed()">
                <option value="" disabled>field…</option>
                <option v-for="fl in rollupFields(r)" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
              </select>
              <select :value="r.over" @change="setRollupOver(r, val($event))" title="which child level">
                <option v-for="c in level.children" :key="c.id" :value="c.id">over {{ childTableName(c) }}</option>
              </select>
              <button class="rl-x" @click="removeAt(level.rollups, i)">×</button>
            </div>
            <div v-if="r.op === 'countWhere'" class="rl-line rl-where">
              <select :value="whereKind(r)" @change="setWhereKind(r, val($event) as 'field' | 'rollup')">
                <option value="field">where a field…</option>
                <option value="rollup" :disabled="!childRollups(r).length">where its rollup…</option>
              </select>
              <template v-if="Array.isArray(r.where)">
                <template v-if="r.where.length">
                  <select :value="r.where[0].fieldId" @change="r.where[0] = { fieldId: val($event), op: opsForId(val($event))[0] }; changed()">
                    <option v-for="fl in childFilterable(r)" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
                  </select>
                  <select :value="r.where[0].op" @change="r.where[0].op = val($event) as FilterOp; changed()">
                    <option v-for="op in opsForId(r.where[0].fieldId)" :key="op" :value="op">{{ OP_LABEL[op] }}</option>
                  </select>
                  <template v-if="r.where[0].op !== 'empty' && r.where[0].op !== 'notEmpty'">
                    <select v-if="choicesOf(r.where[0].fieldId).length" :value="String(r.where[0].value ?? '')" @change="r.where[0].value = val($event) || undefined; changed()">
                      <option value=""></option>
                      <option v-for="c in choicesOf(r.where[0].fieldId)" :key="c" :value="c">{{ c }}</option>
                    </select>
                    <select v-else-if="typeOf(r.where[0].fieldId) === 'checkbox'" :value="String(r.where[0].value === true)" @change="r.where[0].value = val($event) === 'true'; changed()">
                      <option value="true">ticked</option><option value="false">not ticked</option>
                    </select>
                    <input v-else :value="r.where[0].value ?? ''" placeholder="value…" @change="r.where[0].value = coerce(r.where[0].fieldId, val($event)); changed()" />
                  </template>
                </template>
              </template>
              <template v-else-if="r.where">
                <select :value="r.where.rollup" @change="r.where.rollup = val($event); changed()">
                  <option v-for="cr in childRollups(r)" :key="cr.id" :value="cr.id">{{ cr.label || cr.id }}</option>
                </select>
                <select :value="r.where.op" @change="r.where.op = val($event) as any; changed()">
                  <option value="gt">&gt;</option><option value="gte">≥</option><option value="eq">=</option><option value="lte">≤</option><option value="lt">&lt;</option>
                </select>
                <input type="number" class="rl-num" :value="r.where.value" @change="r.where.value = Number(val($event)); changed()" />
              </template>
            </div>
          </div>
          <button class="rl-add add-rollup" @click="addRollup">+ rollup</button>
        </div>
      </div>

      <!-- CHILDREN -->
      <div class="rl-children">
        <ReportLevelEditor v-for="(c, i) in level.children" :key="c.id" :store="store" :level="c" :table="childTable(c)" :parent-table="table"
                           :ancestors="[...ancestors, { id: level.id, table }]" :depth="depth + 1" :used-ids="usedIds"
                           @change="changed()" @remove="level.children.splice(i, 1); dropRollupsOver(c.id); changed()" />
        <button v-if="depth < MAX_DEPTH - 1" class="rl-add add-level" @click="addChild">+ descend into…</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { choicesOf as contractChoices } from '../../contract/values';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { opsFor, type FilterOp } from '../../contract/views';
import { MAX_DEPTH, ROLLUP_LABELS, ROLLUP_OPS, resolveVia, type Descent, type ReportField, type Rollup, type RollupOp, type RootLevel } from '../../contract/reports';

const props = defineProps<{
  store: Store;
  level: RootLevel | Descent;
  /** The table this level's records come from ('' until a via is picked). */
  table: string;
  parentTable: string;
  ancestors: Array<{ id: string; table: string }>;
  depth: number;
  /** Every level id in the whole draft, so a new one can be made unique. */
  usedIds: Set<string>;
}>();
const emit = defineEmits<{ change: []; remove: [] }>();
const changed = () => emit('change');
const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;

const OP_LABEL: Record<FilterOp, string> = { contains: 'contains', eq: 'is', neq: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', has: 'has', empty: 'is empty', notEmpty: 'is not empty' };

const store = props.store;
const d = computed(() => props.level as Descent);
const tableName = computed(() => store.state.tables.get(props.table)?.name ?? '');
const singular = computed(() => store.state.tables.get(props.table)?.singular_name || tableName.value || 'record');
const parentTableName = computed(() => store.state.tables.get(props.parentTable)?.name ?? 'the parent');
const tableChoices = computed(() => [...store.state.tables.values()].filter((t) => !t.kind || t.kind === 'records').sort((a, b) => a.name.localeCompare(b.name)));
const tableFields = computed(() => (props.table ? fieldsOf(store.state, props.table) : []));
const filterable = computed(() => tableFields.value.filter((f) => opsFor(f.type).length));
const fieldById = (id: string) => store.state.fields.get(id);
const typeOf = (id: string) => fieldById(id)?.type ?? 'text';
const opsOf = (id: string) => opsFor(typeOf(id));
const opsForId = opsOf;
const choicesOf = (id: string): string[] => contractChoices(fieldById(id)?.options) ?? [];

/** A unique level id from a table name: 'files', then 'files2'. */
function idFor(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'level';
  let id = base, n = 2;
  while (props.usedIds.has(id)) id = `${base}${n++}`;
  props.usedIds.add(id);
  return id;
}

function setRootTable(id: string) {
  const r = props.level as RootLevel;
  r.table = id; r.fields = []; r.filters = []; r.sort = []; r.rollups = []; r.children = [];
  props.usedIds.delete(r.id); r.id = idFor(store.state.tables.get(id)?.name ?? 'root');
  changed();
}

/* ── via ──────────────────────────────────────────────────────────────── */
const viaChoices = computed(() => {
  if (!props.parentTable) return [];
  const out: Array<{ fieldId: string; label: string; title: string; dir: 'forward' | 'backlink'; table: string; tableName: string; disabled: boolean }> = [];
  for (const f of store.state.fields.values()) {
    if (f.type !== 'link') continue;
    const r = resolveVia(props.parentTable, { fieldId: f.id }, f as ReportField);
    if (typeof r === 'string') continue;
    const owner = store.state.tables.get(f.table_id)?.name ?? '?';
    const landing = store.state.tables.get(r.table)?.name ?? '?';
    out.push({
      fieldId: f.id, dir: r.dir, table: r.table, tableName: landing,
      label: r.dir === 'forward' ? f.name : `${owner}.${f.name}`,
      title: r.dir === 'forward' ? `${parentTableName.value}.${f.name} → ${landing}` : `${owner}.${f.name} points at ${parentTableName.value}: follow it back to ${owner}`,
      disabled: !!props.table && r.table !== props.table && viaIndex(f.id) < 0,
    });
  }
  return out.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.label.localeCompare(b.label));
});
const viaIndex = (fieldId: string) => (props.depth > 0 ? d.value.via.findIndex((v) => v.fieldId === fieldId) : -1);
function toggleVia(fieldId: string, on: boolean) {
  const i = viaIndex(fieldId);
  if (on && i < 0) {
    const first = d.value.via.length === 0;
    d.value.via.push({ fieldId });
    if (first) {
      // The level's table is now known: give it a proper id.
      const c = viaChoices.value.find((v) => v.fieldId === fieldId);
      props.usedIds.delete(d.value.id); d.value.id = idFor(c?.tableName ?? 'level');
    }
  } else if (!on && i >= 0) {
    d.value.via.splice(i, 1);
    if (!d.value.via.length) { d.value.fields = []; d.value.filters = []; d.value.sort = []; d.value.rollups = []; d.value.children = []; d.value.pins = undefined; }
  }
  changed();
}
function setRole(fieldId: string, role: string) {
  const v = d.value.via[viaIndex(fieldId)];
  if (role.trim()) v.role = role.trim(); else delete v.role;
  changed();
}

/* ── pins ─────────────────────────────────────────────────────────────── */
const pinChoices = computed(() => {
  const out: Array<{ key: string; fieldId: string; fieldName: string; levelId: string; ancestorTable: string }> = [];
  // Ancestors ABOVE the parent — pinning to the parent is what `via` already means.
  for (const a of props.ancestors.slice(0, -1)) {
    for (const f of store.state.fields.values()) {
      if (f.type !== 'link') continue;
      const t = String(f.options?.target_table_id ?? '');
      const joins = (f.table_id === props.table && t === a.table) || (f.table_id === a.table && t === props.table);
      if (!joins) continue;
      const owner = store.state.tables.get(f.table_id)?.name ?? '?';
      out.push({ key: f.id + a.id, fieldId: f.id, fieldName: `${owner}.${f.name}`, levelId: a.id, ancestorTable: store.state.tables.get(a.table)?.singular_name || store.state.tables.get(a.table)?.name || a.id });
    }
  }
  return out;
});
const hasPin = (fieldId: string, levelId: string) => !!d.value.pins?.some((p) => p.fieldId === fieldId && p.levelId === levelId);
function togglePin(fieldId: string, levelId: string, on: boolean) {
  const pins = (d.value.pins ??= []);
  const i = pins.findIndex((p) => p.fieldId === fieldId && p.levelId === levelId);
  if (on && i < 0) pins.push({ fieldId, levelId });
  if (!on && i >= 0) pins.splice(i, 1);
  if (!pins.length) d.value.pins = undefined;
  changed();
}

/* ── fields, filters, sort ────────────────────────────────────────────── */
function toggleField(id: string, on: boolean) {
  const i = props.level.fields.indexOf(id);
  if (on && i < 0) { props.level.fields.push(id); props.level.fields.sort((a, b) => (fieldById(a)?.position ?? 0) - (fieldById(b)?.position ?? 0)); }
  if (!on && i >= 0) props.level.fields.splice(i, 1);
  changed();
}
function removeAt(arr: unknown[], i: number) { arr.splice(i, 1); changed(); }
function addFilter() { const f = filterable.value[0]; props.level.filters.push({ fieldId: f.id, op: opsFor(f.type)[0] }); changed(); }
function patchFilter(i: number, p: Partial<RootLevel['filters'][number]>) { Object.assign(props.level.filters[i], p); changed(); }
function changeFilterField(i: number, fieldId: string) { props.level.filters[i] = { fieldId, op: opsOf(fieldId)[0] }; changed(); }
function coerce(fieldId: string, raw: string): string | number | undefined {
  if (raw === '') return undefined;
  if (typeOf(fieldId) === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : undefined; }
  return raw;
}
function patchFilterValue(i: number, raw: string) {
  const f = props.level.filters[i];
  const v = coerce(f.fieldId, raw);
  if (v === undefined) delete f.value; else f.value = v;
  changed();
}

/* ── rollups ──────────────────────────────────────────────────────────── */
const childTable = (c: Descent): string => {
  for (const v of c.via) { const r = resolveVia(props.table, v, store.state.fields.get(v.fieldId) as ReportField | undefined); if (typeof r !== 'string') return r.table; }
  return '';
};
const childTableName = (c: Descent) => store.state.tables.get(childTable(c))?.name ?? c.id;
const childOf = (r: Rollup) => props.level.children.find((c) => c.id === r.over);
const childFields = (r: Rollup): FieldRow[] => { const c = childOf(r); return c ? fieldsOf(store.state, childTable(c)) : []; };
const childFilterable = (r: Rollup) => childFields(r).filter((f) => opsFor(f.type).length);
const childRollups = (r: Rollup) => childOf(r)?.rollups ?? [];
const rollupFields = (r: Rollup) => childFields(r).filter((f) => r.op === 'sum' ? f.type === 'number' : r.op === 'min' || r.op === 'max' ? f.type === 'number' || f.type === 'date' : f.type !== 'attachment');
function addRollup() {
  const c = props.level.children[0];
  const base = childTableName(c).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  let id = base, n = 2; while (props.level.rollups.some((r) => r.id === id)) id = `${base}${n++}`;
  props.level.rollups.push({ id, label: childTableName(c).toLowerCase(), op: 'count', over: c.id });
  changed();
}
function setRollupOp(r: Rollup, op: RollupOp) {
  r.op = op;
  if (op === 'count') { delete r.where; delete r.fieldId; }
  else if (op === 'countWhere') { delete r.fieldId; if (!r.where) { const f = childFilterable(r)[0]; r.where = f ? [{ fieldId: f.id, op: opsFor(f.type)[0] }] : []; } }
  else { delete r.where; if (!rollupFields(r).some((f) => f.id === r.fieldId)) r.fieldId = rollupFields(r)[0]?.id; }
  changed();
}
function setRollupOver(r: Rollup, over: string) { r.over = over; setRollupOp(r, r.op); }
const whereKind = (r: Rollup) => (r.where && !Array.isArray(r.where) ? 'rollup' : 'field');
function setWhereKind(r: Rollup, kind: 'field' | 'rollup') {
  if (kind === 'rollup') { const cr = childRollups(r)[0]; if (cr) r.where = { rollup: cr.id, op: 'gt', value: 0 }; }
  else { const f = childFilterable(r)[0]; r.where = f ? [{ fieldId: f.id, op: opsFor(f.type)[0] }] : []; }
  changed();
}
function dropRollupsOver(levelId: string) { props.level.rollups = props.level.rollups.filter((r) => r.over !== levelId); }

/* ── children ─────────────────────────────────────────────────────────── */
function addChild() {
  props.level.children.push({ id: idFor('level'), via: [], fields: [], filters: [], sort: [], rollups: [], children: [] });
  changed();
}
</script>

<style scoped>
.rl { display: flex; flex-direction: column; gap: 6px; font-size: 12px; min-width: 0; }
.rl:not(.root) { border-left: 2px solid var(--border-main); padding-left: 10px; margin-top: 4px; }
.rl-head { display: flex; align-items: center; gap: 6px; }
.rl-depth { color: var(--text-faint); font-size: 11px; }
.rl-tname { font-weight: 600; color: var(--text-primary); }
.rl-id { margin-left: auto; color: var(--text-faint); font-size: 10px; font-family: monospace; }
.rl-block { display: flex; gap: 8px; align-items: flex-start; }
.rl-label { flex: 0 0 60px; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 3px; }
.rl-rows { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.rl-fields { flex-direction: row; flex-wrap: wrap; gap: 2px 10px; }
.rl-field, .rl-via { display: flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-secondary); min-width: 0; }
.rl-via.off { opacity: 0.4; cursor: default; }
.rl-via-name { color: var(--text-primary); }
.rl-via-dir { color: var(--text-faint); font-size: 11px; white-space: nowrap; }
.rl-role { width: 64px; margin-left: 4px; }
.rl-line { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.rl-where { padding-left: 12px; }
.rl-rollup { display: flex; flex-direction: column; gap: 2px; }
.rl-rlabel { width: 90px; }
.rl-num { width: 56px; }
select, input { background: var(--bg-app); color: var(--text-primary); border: 1px solid var(--border-main); border-radius: 3px; font: inherit; font-size: 11px; padding: 1px 4px; min-width: 0; max-width: 100%; }
input[type="checkbox"] { width: auto; margin: 0; }
.rl-add { align-self: flex-start; background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 3px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.rl-add:hover { color: var(--accent); border-color: var(--accent); }
.rl-x { background: none; border: none; color: var(--text-faint); cursor: pointer; font: inherit; font-size: 13px; padding: 0 3px; }
.rl-x:hover { color: var(--danger); }
.rl-note { margin: 0; color: var(--text-faint); font-style: italic; font-size: 11px; }
.rl-children { display: flex; flex-direction: column; gap: 4px; }
</style>
