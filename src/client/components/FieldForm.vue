<!--
  "Add a field" — the ONE form for it, used by the grid's "+" column header and
  by each table block on the schema tab. See schemaActions.ts for why there is
  exactly one.

  The KEY is behind "advanced" and derived from the name. It is the immutable
  property name values are stored under (API.md), and nearly nobody needs to
  think about it — but anyone scripting against the data does, so it is one click
  away rather than hidden.
-->
<template>
  <div class="field-form" :class="layout" @keydown.enter.prevent="submit">
    <input ref="nameInput" v-model="d.name" class="name" placeholder="field name…" />
    <select v-model="d.type" class="type">
      <option v-for="ty in CREATABLE_TYPES" :key="ty" :value="ty">{{ ty }}</option>
    </select>
    <select v-if="d.type === 'link'" v-model="d.target" class="target">
      <option value="" disabled>links to which table…</option>
      <option v-for="t in tables" :key="t.id" :value="t.id">{{ t.name }}</option>
    </select>
    <!-- BACKLINK: the other end of a link field that points at this table. -->
    <!-- STRUCTURED: which shape its values take. Chosen once — every stored value is
         validated against it, so it cannot be changed afterwards. -->
    <select v-if="d.type === 'structured'" v-model="d.shape" class="shape" title="What kind of structured value this field holds. It cannot be changed later.">
      <option value="" disabled>shape…</option>
      <option v-for="sh in SHAPES" :key="sh" :value="sh">{{ SHAPE_LABELS[sh] }}</option>
    </select>
    <select v-if="d.type === 'backlink'" v-model="d.source" class="source">
      <option value="" disabled>{{ linksIn.length ? 'other end of which link…' : 'no link field points at this table yet' }}</option>
      <option v-for="l in linksIn" :key="l.field.id" :value="l.field.id">{{ l.label }}</option>
    </select>
    <!-- LOOKUP: follow one of THIS table's link fields, show one field from the far
         table. The second list depends on the first. -->
    <template v-if="d.type === 'lookup'">
      <select v-model="d.via" class="via" @change="d.show = ''">
        <option value="" disabled>{{ linkFields.length ? 'follow which link…' : 'this table has no link fields yet' }}</option>
        <option v-for="f in linkFields" :key="f.id" :value="f.id">{{ f.name }}</option>
      </select>
      <select v-model="d.show" class="show" :disabled="!d.via">
        <option value="" disabled>show which field…</option>
        <option v-for="f in lookupTargets" :key="f.id" :value="f.id">{{ f.name }}</option>
      </select>
    </template>
    <input v-if="d.type === 'select' || d.type === 'multi_select'" v-model="d.choices"
           class="choices" placeholder="choices, comma separated" />
    <label class="adv"><input v-model="advanced" type="checkbox" /> advanced</label>
    <input v-if="advanced" v-model="d.key" class="key mono" :placeholder="derived || 'key'"
           title="The property name values are stored under. lowercase_snake_case; cannot be changed later." />
    <button class="add" @click="submit">add field</button>
    <span v-if="error" class="error">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import type { Store } from '../store';
import { tablesSorted } from '../state';
import { CREATABLE_TYPES, deriveKey, emptyDraft, type SchemaActions } from '../schemaActions';
import { SHAPES, SHAPE_LABELS } from '../../contract/shapes';

const props = defineProps<{
  store: Store; actions: SchemaActions; tableId: string;
  /** `row` for the schema tab's one-line form, `stack` for the grid's popover. */
  layout?: 'row' | 'stack';
  autofocus?: boolean;
}>();
const emit = defineEmits<{ created: [fieldId: string] }>();

const d = reactive(emptyDraft());
const advanced = ref(false);
const error = ref('');
const nameInput = ref<HTMLInputElement>();

const tables = computed(() => tablesSorted(props.store.state));
const derived = computed(() => deriveKey(d.name));
const linksIn = computed(() => props.actions.linkFieldsInto(props.tableId));
const linkFields = computed(() => props.actions.linkFieldsOf(props.tableId));
const lookupTargets = computed(() => props.actions.lookupTargetsOf(d.via));

function submit() {
  const result = props.actions.createField(props.tableId, d);
  if ('error' in result) { error.value = result.error; return; }
  error.value = '';
  // Keep type and target: adding five text fields, or three links to the same
  // table, is the common run.
  Object.assign(d, emptyDraft(), { type: d.type, target: d.target, via: d.via });
  emit('created', result.id);
  void nextTick(() => nameInput.value?.focus());
}

onMounted(() => { if (props.autofocus) void nextTick(() => nameInput.value?.focus()); });
</script>

<style scoped>
.field-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.field-form.stack { flex-direction: column; align-items: stretch; min-width: 260px; }
input:not([type='checkbox']), select {
  background: var(--bg-app); border: 1px solid var(--border-main); color: inherit;
  border-radius: 4px; padding: 3px 6px; font: inherit; min-width: 0;
}
input[type='checkbox'] { width: auto; flex: none; margin: 0; }
.field-form.stack .adv { align-self: flex-start; }
.adv { color: var(--text-muted); font-size: 11px; display: flex; gap: 4px; align-items: center; cursor: pointer; }
.mono { font-family: ui-monospace, monospace; }
.error { color: var(--danger); font-size: 11px; }
button.add {
  background: none; border: 1px solid var(--border-main); color: var(--accent);
  border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit;
}
</style>
