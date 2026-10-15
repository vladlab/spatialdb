<!--
  A `<select>` of one table's records, by name — the VALUE of an `is` filter
  (contract/views.ts): "Work is Episode 101". A plain select, not the link picker,
  because a filter line is one row of small controls and the tables `is` is used
  against (Works, Projects, Deliverables) are short lists. The table is loaded so
  the list is complete; while it loads, what is chosen already is still named.
-->
<template>
  <select class="record-select" :value="modelValue ?? ''" :title="`a ${tableName} record`" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || undefined)">
    <option value="">{{ loading ? 'loading…' : `choose a ${tableName}…` }}</option>
    <option v-for="r in options" :key="r.id" :value="r.id">{{ r.label }}</option>
  </select>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import type { Store } from '../store';
import { recordsOf } from '../state';
import { useDerived } from '../derived';

const props = defineProps<{ store: Store; tableId: string; modelValue?: string }>();
const emit = defineEmits<{ 'update:modelValue': [id: string | undefined] }>();
const derived = useDerived(props.store);

watch(() => props.tableId, (t) => { if (t) void props.store.loadTable(t); }, { immediate: true });
const loading = computed(() => props.store.tableLoads.get(props.tableId)?.state !== 'loaded');
const tableName = computed(() => { const t = props.store.state.tables.get(props.tableId); return t?.singular_name || t?.name || 'record'; });
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const options = computed(() => {
  const rows = recordsOf(props.store.state, props.tableId).map((r) => ({ id: r.id, label: derived.plainLabelOfId(r.id) }));
  rows.sort((a, b) => collator.compare(a.label, b.label));
  // The chosen record, even if it is not (yet) in the loaded rows: a filter must not look blank.
  if (props.modelValue && !rows.some((r) => r.id === props.modelValue)) rows.unshift({ id: props.modelValue, label: derived.plainLabelOfId(props.modelValue) });
  return rows;
});
</script>

<style scoped>
.record-select { max-width: 220px; }
</style>
