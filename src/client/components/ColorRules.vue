<!--
  The COLOUR RULES of one home — a view, a canvas's table, a report level — edited
  (contract/colorRules.ts). One component, so all three homes are the same editor
  over the same contract, as FilterLines is for filters: a rule is a tint swatch, its
  conditions (FilterLines, the very same lines as a filter), what it paints (the row,
  or one field), and a legend label. Ordered — drag the ⋮⋮, or ↑↓ — because the first
  match wins per target. It edits a LIST it is given and hands the new list back;
  where that list is saved is the caller's business.

  A report level's rules may also test a ROLLUP ("Accepted ≥ 1"): `rollups` lists
  them, and such a condition is one more kind of line, before the field lines.
-->
<template>
  <div class="color-rules">
    <div v-for="(r, i) in rules" :key="r.id" class="cr-rule" :class="{ 'cr-over': dragOver === i }" :data-rule="r.id"
         draggable="true" @dragstart="dragFrom = i" @dragover.prevent="dragOver = i" @dragleave="dragOver = null" @drop.prevent="drop(i)" @dragend="dragFrom = null; dragOver = null">
      <div class="cr-head">
        <span class="cr-grip" title="Drag to reorder — the first rule that matches wins">⋮⋮</span>
        <!-- THE TINT: six named swatches, no colour picker. A rule's colour is a STATE, not
             an identity; the six are told apart at a glance, and from any table's hex. -->
        <span class="cr-swatches">
          <button v-for="t in TINTS" :key="t" type="button" class="cr-swatch" :class="[`tint-${t}`, { 'cr-on': r.tint === t }]" :title="t" @click="patch(i, { tint: t })" />
        </span>
        <input class="cr-label" :value="r.label ?? ''" placeholder="legend label" title="Shown in the legend — blank for no chip" @change="setLabel(i, val($event))" />
        <span class="cr-muted">paint</span>
        <select class="cr-paint" :value="paintKey(r)" @change="setPaint(i, val($event))" title="The whole row, card or band — or one field only">
          <option value="row">{{ rowWord }}</option>
          <option v-for="f in paintable" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <button class="cr-mv" :disabled="i === 0" title="Earlier — checked before the rules below it" @click="move(i, i - 1)">↑</button>
        <button class="cr-mv" :disabled="i === rules.length - 1" title="Later" @click="move(i, i + 1)">↓</button>
        <button class="cr-x" title="Remove this rule" @click="emit('update:rules', rules.filter((_, j) => j !== i))">×</button>
      </div>
      <div class="cr-when">
        <span class="cr-muted cr-whenword">when</span>
        <div class="cr-lines">
          <!-- Rollup conditions (reports): their own lines, above the field lines. -->
          <div v-for="(t, k) in rollupTests(r)" :key="'ru' + k" class="cr-line">
            <select :value="t.rollup" @change="patchRollup(i, k, { rollup: val($event) })">
              <option v-for="ru in rollups" :key="ru.id" :value="ru.id">{{ ru.label || ru.id }}</option>
            </select>
            <select :value="t.op" @change="patchRollup(i, k, { op: val($event) as RollupTest['op'] })">
              <option value="gt">&gt;</option><option value="gte">≥</option><option value="eq">=</option><option value="lte">≤</option><option value="lt">&lt;</option>
            </select>
            <input type="number" class="cr-num" :value="t.value" @change="patchRollup(i, k, { value: Number(val($event)) })" />
            <button class="cr-x" title="Remove this condition" @click="removeRollup(i, k)">×</button>
          </div>
          <FilterLines :store="store" :table-id="tableId" :extra-table-id="pairTableId" :filters="fieldTests(r)" note="" @update:filters="setFieldTests(i, $event)" />
          <button v-if="rollups?.length" class="cr-ghost" @click="addRollup(i)">+ rollup…</button>
          <p v-if="!r.when.length" class="cr-note">No conditions: this rule matches everything the rules above it did not.</p>
        </div>
      </div>
    </div>
    <div class="cr-foot">
      <button class="cr-ghost cr-add" @click="add">+ rule…</button>
      <span v-if="rules.length" class="cr-note">First match wins — per {{ rowWord }}, and per field. Identity colours (the table's, a link's) stay where they are; these are states.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { TINTS, isRollupTest, newRuleId, type ReportColorRule, type RollupTest } from '../../contract/colorRules';
import type { ViewConfig } from '../../contract/views';
import FilterLines from './FilterLines.vue';

type Rule = ReportColorRule;
const props = defineProps<{
  store: Store;
  tableId: string;
  rules: Rule[];
  /** The word for the whole thing: "row" (grid), "card" (canvas), "band" or "row" (report). */
  rowWord: string;
  /** A report level through a junction: the PAIR's table, whose fields a rule may read too. */
  pairTableId?: string;
  /** A report level's rollups, which its rules may test. */
  rollups?: Array<{ id: string; label: string }>;
}>();
const emit = defineEmits<{ 'update:rules': [rules: Rule[]] }>();

const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
const paintable = computed(() => [
  ...fieldsOf(props.store.state, props.tableId).map((f) => ({ id: f.id, name: f.name })),
  ...(props.pairTableId ? fieldsOf(props.store.state, props.pairTableId).map((f) => ({ id: f.id, name: `${f.name} (of the pair)` })) : []),
]);

const paintKey = (r: Rule) => (r.paint === 'row' || !r.paint ? 'row' : r.paint.field);
const fieldTests = (r: Rule) => r.when.filter((t): t is ViewConfig['filters'][number] => !isRollupTest(t));
const rollupTests = (r: Rule) => r.when.filter(isRollupTest);

function put(rules: Rule[]) { emit('update:rules', rules); }
function patch(i: number, p: Partial<Rule>) { put(props.rules.map((r, j) => (j === i ? { ...r, ...p } : r))); }
function setLabel(i: number, s: string) { const { label: _, ...rest } = props.rules[i]; put(props.rules.map((r, j) => (j === i ? (s.trim() ? { ...rest, label: s.trim() } : rest) : r))); }
function setPaint(i: number, key: string) { patch(i, { paint: key === 'row' ? 'row' : { field: key } }); }
/** The field lines replaced; the rollup lines kept, first. */
function setFieldTests(i: number, lines: ViewConfig['filters']) { patch(i, { when: [...rollupTests(props.rules[i]), ...lines] }); }
function patchRollup(i: number, k: number, p: Partial<RollupTest>) {
  const r = props.rules[i];
  const rus = rollupTests(r).map((t, j) => (j === k ? { ...t, ...p } : t));
  patch(i, { when: [...rus, ...fieldTests(r)] });
}
function removeRollup(i: number, k: number) {
  const r = props.rules[i];
  patch(i, { when: [...rollupTests(r).filter((_, j) => j !== k), ...fieldTests(r)] });
}
function addRollup(i: number) {
  const ru = props.rollups?.[0];
  if (!ru) return;
  const r = props.rules[i];
  patch(i, { when: [...rollupTests(r), { rollup: ru.id, op: 'gte', value: 1 }, ...fieldTests(r)] });
}
function add() {
  put([...props.rules, { id: newRuleId(props.rules), when: [], tint: TINTS[props.rules.length % TINTS.length], paint: 'row' }]);
}
function move(from: number, to: number) {
  if (to < 0 || to >= props.rules.length) return;
  const next = props.rules.slice();
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r);
  put(next);
}
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);
function drop(to: number) { if (dragFrom.value !== null && dragFrom.value !== to) move(dragFrom.value, to); dragFrom.value = null; dragOver.value = null; }
</script>

<style scoped>
.color-rules { display: flex; flex-direction: column; gap: 6px; min-width: 420px; }
.cr-rule { display: flex; flex-direction: column; gap: 4px; padding: 5px 6px; border-radius: 5px; background: var(--bg-app); border: 1px solid var(--border-main); }
.cr-rule.cr-over { border-color: var(--accent); }
.cr-head { display: flex; gap: 6px; align-items: center; }
.cr-grip { color: var(--text-faint); cursor: grab; letter-spacing: -2px; font-size: 12px; user-select: none; }
.cr-swatches { display: flex; gap: 3px; }
.cr-swatch { width: 16px; height: 16px; border-radius: 4px; border: 1px solid transparent; padding: 0; cursor: pointer; background: var(--tint); opacity: 0.45; }
.cr-swatch:hover { opacity: 0.8; }
.cr-swatch.cr-on { opacity: 1; border-color: var(--swatch-ring); box-shadow: 0 0 0 1px var(--tint); }
.cr-label { flex: 1; min-width: 60px; max-width: 150px; }
.cr-paint { max-width: 150px; }
.cr-when { display: flex; gap: 6px; align-items: flex-start; }
.cr-whenword { padding-top: 3px; width: 32px; flex: none; }
.cr-lines { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.cr-line { display: flex; gap: 4px; align-items: center; }
.cr-muted { color: var(--text-muted); font-size: 11px; }
select, input { font: inherit; font-size: 12px; background: var(--bg-app); color: inherit; border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 4px; min-width: 0; }
.cr-num { width: 56px; }
.cr-x, .cr-mv { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 3px; font: inherit; }
.cr-x { margin-left: auto; font-size: 14px; }
.cr-x:hover { color: var(--danger); }
.cr-mv { font-size: 11px; }
.cr-mv:disabled { opacity: 0.3; cursor: default; }
.cr-mv:not(:disabled):hover { color: var(--accent); }
.cr-ghost { align-self: flex-start; background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.cr-ghost:hover { color: var(--accent); border-color: var(--accent); }
.cr-foot { display: flex; align-items: center; gap: 10px; }
.cr-note { margin: 0; color: var(--text-faint); font-size: 11px; }
</style>
