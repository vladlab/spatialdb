<!--
  The PAIRS of a comparing link (COMPARE-BRIEF.md §3), edited in the link field's ⚙.

  Ticking "compare" pre-fills every same-name pair with a legal rule — a convenience;
  what is saved is the explicit list below, and you edit it: which field on THIS
  table is checked against which field on the target, and how. Every change is one
  field.update (undoable). The server refuses a pair that names the wrong table or
  an illegal rule, so nothing bad can be saved from anywhere.
-->
<template>
  <div class="cp" @keydown.stop>
    <p class="cp-head">Compare <b>{{ ownerTable }}</b> (found) against <b>{{ targetTable }}</b> (expected):</p>
    <table v-if="cfg.pairs.length" class="cp-table">
      <tbody>
        <tr v-for="(p, i) in cfg.pairs" :key="i" class="cp-pair">
          <td><select class="cp-from" :value="p.from" @change="setPair(i, { from: ($event.target as HTMLSelectElement).value })">
            <option v-for="f in ownerFields" :key="f.id" :value="f.id">{{ f.name }}</option></select></td>
          <td><select class="cp-rule" :value="p.rule" @change="setPair(i, { rule: ($event.target as HTMLSelectElement).value as Rule })">
            <option v-for="r in rulesOf(p)" :key="r" :value="r">{{ RULE_LABELS[r] }}</option>
            <option v-if="!rulesOf(p).includes(p.rule)" :value="p.rule" disabled>{{ p.rule }} (not valid here)</option></select></td>
          <td><select class="cp-to" :value="p.to" @change="setPair(i, { to: ($event.target as HTMLSelectElement).value })">
            <option v-for="f in targetFields" :key="f.id" :value="f.id">{{ f.name }}</option></select></td>
          <td class="cp-params">
            <input v-if="p.rule === 'within'" class="cp-tol" type="number" min="0" step="any" placeholder="±" :value="p.params?.tolerance ?? ''" title="Tolerance"
                   @change="setPair(i, { params: { ...p.params, tolerance: Number(($event.target as HTMLInputElement).value) || 0 } })" />
            <label v-else-if="p.rule === 'equals' && isText(p)" class="cp-ci" title="Ignore case and outer spaces"><input type="checkbox" :checked="p.params?.caseInsensitive === true"
                   @change="setPair(i, { params: { ...p.params, caseInsensitive: ($event.target as HTMLInputElement).checked } })" /> Aa</label>
          </td>
          <td><button class="x" title="Remove this pair" @click="save(cfg.pairs.filter((_, k) => k !== i))">×</button></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="cp-empty">No pairs yet. Nothing is compared until you add one.</p>
    <div class="cp-actions">
      <button class="cp-add" :disabled="!candidates.length" @click="addPair">+ pair</button>
      <button class="cp-suggest" title="Add every same-name pair that is not already here" @click="suggest">suggest by name</button>
      <span class="cp-hint">Rules depend on the two field types. An empty expected value means “not specified”.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { RULE_LABELS, compareOf, rulesFor, suggestPairs, type ComparePair, type Rule } from '../../contract/compare';

const props = defineProps<{ store: Store; field: FieldRow }>();
const cfg = computed(() => compareOf(props.field) ?? { pairs: [] });
const targetId = computed(() => String(props.field.options?.target_table_id ?? ''));
const ownerTable = computed(() => props.store.state.tables.get(props.field.table_id)?.name ?? '');
const targetTable = computed(() => props.store.state.tables.get(targetId.value)?.name ?? '');
const ownerFields = computed(() => fieldsOf(props.store.state, props.field.table_id).filter((f) => f.id !== props.field.id));
const targetFields = computed(() => fieldsOf(props.store.state, targetId.value));
const byId = (id: string) => props.store.state.fields.get(id);
const rulesOf = (p: ComparePair) => { const a = byId(p.from), b = byId(p.to); return a && b ? rulesFor(a, b) : []; };
const isText = (p: ComparePair) => ['text', 'select'].includes(byId(p.from)?.type ?? '');
/** Owner fields that could pair with SOMETHING on the target. */
const candidates = computed(() => ownerFields.value.filter((o) => targetFields.value.some((t) => rulesFor(o, t).length)));

function save(pairs: ComparePair[]) {
  props.store.mutate({ type: 'field.update', id: props.field.id, options: { ...(props.field.options ?? {}), compare: { pairs } } });
}
function setPair(i: number, patch: Partial<ComparePair>) {
  const pairs = cfg.value.pairs.map((p, k) => (k === i ? { ...p, ...patch } : p));
  const p = pairs[i];
  // Changing a field may make the rule illegal: fall to the first legal one.
  const legal = rulesOf(p);
  if (legal.length && !legal.includes(p.rule)) pairs[i] = { ...p, rule: legal[0], params: undefined };
  save(pairs);
}
function addPair() {
  const o = candidates.value.find((f) => !cfg.value.pairs.some((p) => p.from === f.id)) ?? candidates.value[0];
  const t = targetFields.value.find((x) => rulesFor(o, x).length)!;
  save([...cfg.value.pairs, { from: o.id, to: t.id, rule: rulesFor(o, t)[0] }]);
}
function suggest() {
  const have = new Set(cfg.value.pairs.map((p) => p.from + p.to));
  const extra = suggestPairs(ownerFields.value, targetFields.value, [fieldsOf(props.store.state, props.field.table_id)[0]?.id ?? '']).filter((p) => !have.has(p.from + p.to));
  if (extra.length) save([...cfg.value.pairs, ...extra]);
}
</script>

<style scoped>
.cp { font-size: 12px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border-main); }
.cp-head { margin: 0 0 4px; color: var(--text-muted); }
.cp-table { border-collapse: collapse; }
.cp-table td { padding: 2px 3px; }
.cp select, .cp input[type="number"] { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 3px; padding: 1px 4px; font: inherit; font-size: 11px; }
.cp-tol { width: 60px; }
.cp-ci { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
.cp-ci input { margin: 0 2px 0 0; }
.x { background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; }
.x:hover { color: var(--danger); }
.cp-empty { margin: 2px 0; color: var(--text-faint); font-style: italic; }
.cp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
.cp-add, .cp-suggest { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.cp-add:hover:not(:disabled), .cp-suggest:hover { color: var(--accent); border-color: var(--accent); }
.cp-hint { color: var(--text-faint); font-size: 11px; }
</style>
