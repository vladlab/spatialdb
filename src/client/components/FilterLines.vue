<!--
  The filter lines of a view — field, op, value, × — and "+ filter…". One component,
  so the grid's filter menu and a canvas stack's definition (contract/canvasStack.ts)
  are the same editor over the same contract (contract/views.ts). It edits a LIST it
  is given and hands the new list back; where that list is saved (a view, a canvas's
  config) is the caller's business.
-->
<template>
  <div class="filter-lines">
    <div v-for="(f, i) in filters" :key="i" class="line">
      <select :value="f.fieldId" @change="changeField(i, val($event))">
        <option v-for="fl in filterable" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
      </select>
      <select :value="f.op" @change="patch(i, { op: val($event) as FilterOp })">
        <option v-for="op in opsOf(f.fieldId)" :key="op" :value="op">{{ OP_LABEL[op] }}</option>
      </select>
      <template v-if="f.op !== 'empty' && f.op !== 'notEmpty'">
        <!-- `is` on a link: the record itself, by name — identity, not text. -->
        <RecordSelect v-if="f.op === 'is' && targetOf(f.fieldId)" :store="store" :table-id="targetOf(f.fieldId)!"
                      :model-value="typeof f.value === 'string' ? f.value : undefined" @update:model-value="patch(i, { value: $event })" />
        <select v-else-if="choicesOf(f.fieldId).length" :value="String(f.value ?? '')" @change="patch(i, { value: val($event) })">
          <option value=""></option>
          <option v-for="c in choicesOf(f.fieldId)" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-else-if="typeOf(f.fieldId) === 'checkbox'" :value="String(f.value === true)" @change="patch(i, { value: val($event) === 'true' })">
          <option value="true">ticked</option>
          <option value="false">not ticked</option>
        </select>
        <input v-else :type="inputType(f.fieldId)" :value="f.value ?? ''" placeholder="value…" @change="patchValue(i, val($event))" />
      </template>
      <button class="x" title="Remove this condition" @click="emit('update:filters', filters.filter((_, j) => j !== i))">×</button>
    </div>
    <button v-if="filterable.length" class="ghost add-filter" @click="add">+ filter…</button>
    <p v-if="note !== ''" class="note">{{ note ?? 'All conditions must match.' }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { choicesOf as contractChoices } from '../../contract/values';
import { OP_LABEL, linkTargetOf, opsFor, type FilterOp, type ViewConfig } from '../../contract/views';
import RecordSelect from './RecordSelect.vue';

type Filters = ViewConfig['filters'];
const props = defineProps<{ store: Store; tableId: string; filters: Filters; /** The line under the list; '' for none. */ note?: string }>();
const emit = defineEmits<{ 'update:filters': [filters: Filters] }>();

const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
const fields = computed(() => fieldsOf(props.store.state, props.tableId));
const filterable = computed(() => fields.value.filter((f) => opsFor(f.type).length));
const fieldById = (id: string) => props.store.state.fields.get(id);
const typeOf = (id: string) => fieldById(id)?.type ?? 'text';
const opsOf = (id: string) => opsFor(typeOf(id));
const targetOf = (id: string) => { const f = fieldById(id); return f ? linkTargetOf(f) : undefined; };
function choicesOf(id: string): string[] {
  const f = fieldById(id);
  if (!f || (f.type !== 'select' && f.type !== 'multi_select')) return [];
  return contractChoices(f.options) ?? [];
}
const inputType = (id: string) => ({ number: 'number', date: 'date' } as Record<string, string>)[typeOf(id)] ?? 'text';

function add() {
  const f = filterable.value[0];
  if (f) emit('update:filters', [...props.filters, { fieldId: f.id, op: opsFor(f.type)[0] }]);
}
function patch(i: number, p: Partial<Filters[number]>) {
  emit('update:filters', props.filters.map((f, j) => (j === i ? { ...f, ...p } : f)));
}
/** A new field may not support the old op, and the old value is for the old type. */
function changeField(i: number, fieldId: string) {
  emit('update:filters', props.filters.map((f, j) => (j === i ? { fieldId, op: opsOf(fieldId)[0] } : f)));
}
/** The filter value keeps the field's type, so `> 100` compares numbers. */
function patchValue(i: number, raw: string) {
  const f = props.filters[i];
  if (raw === '') {
    // Clearing the box removes the value rather than storing '' — a filter with
    // no value is inert (see `matches`), which is what an empty box should mean.
    const { fieldId, op } = f;
    return emit('update:filters', props.filters.map((x, j) => (j === i ? { fieldId, op } : x)));
  }
  if (typeOf(f.fieldId) === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    return patch(i, { value: n });
  }
  patch(i, { value: raw });
}
</script>

<style scoped>
.filter-lines { display: flex; flex-direction: column; gap: 4px; }
.line { display: flex; gap: 4px; align-items: center; }
.line select, .line input { font: inherit; font-size: 12px; background: var(--bg-app); color: inherit; border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 4px; min-width: 0; }
.line input { flex: 1; }
.x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 4px; font: inherit; }
.x:hover { color: var(--danger); }
.ghost { align-self: flex-start; background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.ghost:hover { color: var(--accent); border-color: var(--accent); }
.note { margin: 2px 0 0; color: var(--text-faint); font-size: 11px; }
</style>
