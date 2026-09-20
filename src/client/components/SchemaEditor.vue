<!--
  The schema designer: every table and every field, on one page.

  It is the EXPLICIT half of two schema UIs. The other is in the grid — a "+"
  column header and a menu on each header — which is where day-to-day changes
  happen. This one stays because seeing the whole structure at once is worth
  having, and it stays on one condition: that it costs nothing to keep. So it
  contains no schema logic at all. Operations are `schemaActions.ts`; the add form
  is `FieldForm.vue`; a field's controls are `FieldSettings.vue`. The grid uses
  the same three. Anything added to them appears in both places.

  By default it shows ONE table — the one open in the grid — because every table
  at once does not scale past a handful ("all tables" is still one click away).

  What none of this does, deliberately: change a field's key or type after
  creation. Those are data migrations wearing an edit's clothes — the contract
  omits them from field.update on purpose.

  Deletion is undoable (field.delete strips values but captures them;
  table.delete captures everything), so the confirms say what will happen rather
  than begging. An honest sentence beats a scary one.
-->
<template>
  <section class="panel schema">
    <div class="new-table">
      <input v-model="tableDraft" placeholder="new table name…" @keydown.enter="addTable" />
      <label class="muted boards" title="Every record in a table of boards IS a canvas: it has fields and links like any record, and opens as a board. Set when the table is made; it cannot be changed later.">
        <input v-model="asBoards" type="checkbox" /> a table of boards
      </label>
      <button @click="addTable">add table</button>
      <span class="spacer" />
      <label v-if="tables.length > 1" class="muted all">
        <input v-model="showAll" type="checkbox" /> all tables
      </label>
    </div>

    <div v-for="t in visible" :key="t.id" class="table-block">
      <div class="head">
        <input class="inline-name" :value="t.name"
               @change="actions.renameTable(t.id, ($event.target as HTMLInputElement).value)" />
        <span v-if="t.kind === 'canvas'" class="kind" title="Every record in this table is a canvas">▦ boards</span>
        <span class="muted">{{ fieldsOf(t.id).length }} fields, {{ recordCount(t.id) }} loaded records</span>
        <span class="spacer" />
        <button class="danger" @click="actions.deleteTable(t.id)">delete table</button>
      </div>

      <FieldSettings v-for="(f, i) in fieldsOf(t.id)" :key="f.id" class="field-row" layout="row"
                     :store="store" :actions="actions" :field="f" :index="i" :count="fieldsOf(t.id).length" />
      <p v-if="!fieldsOf(t.id).length" class="muted">No fields yet. The first plain-valued field names the table's records.</p>

      <FieldForm class="new-field" layout="row" :store="store" :actions="actions" :table-id="t.id" />
    </div>

    <p v-if="!tables.length" class="muted">
      No tables yet — this is a genuinely empty database. Add one above.
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { fieldsOf as stateFieldsOf, recordsOf, tablesSorted, type TableRow } from '../state';
import type { Store } from '../store';
import { useSchemaActions } from '../schemaActions';
import FieldForm from './FieldForm.vue';
import FieldSettings from './FieldSettings.vue';

const props = defineProps<{
  store: Store; tableId?: string;
  /** The tables to offer — the current SECTION's. Omitted: every table. */
  tables?: TableRow[];
}>();
const emit = defineEmits<{ 'update:tableId': [id: string]; created: [id: string] }>();
const store = props.store;
const actions = useSchemaActions(store);

const tables = computed(() => props.tables ?? tablesSorted(store.state));
const fieldsOf = (tableId: string) => stateFieldsOf(store.state, tableId);
const recordCount = (tableId: string) => recordsOf(store.state, tableId).length;

const showAll = ref(false);
const visible = computed(() => {
  if (showAll.value) return tables.value;
  const current = tables.value.find((t) => t.id === props.tableId) ?? tables.value[0];
  return current ? [current] : [];
});

const tableDraft = ref('');
const asBoards = ref(false);
function addTable() {
  const id = actions.createTable(tableDraft.value, asBoards.value ? 'canvas' : 'records');
  if (!id) return;
  tableDraft.value = '';
  asBoards.value = false;
  emit('created', id);          // so the app can file it under the current section
  emit('update:tableId', id);   // show the table you just made, here and in the grid
}
</script>

<style scoped>
.schema { max-width: 1000px; }
.new-table { display: flex; gap: 6px; align-items: center; margin: 8px 0; }
.new-table input:not([type='checkbox']) {
  background: var(--controls-bg); border: 1px solid var(--border-main);
  color: inherit; border-radius: 4px; padding: 4px 8px; font: inherit;
}
.spacer { flex: 1; }
.boards { display: flex; gap: 4px; align-items: center; cursor: pointer; font-size: 12px; }
.kind { color: var(--accent); font-size: 11px; }
.all { display: flex; gap: 4px; align-items: center; cursor: pointer; font-size: 12px; }
.table-block { margin: 14px 0; border: 1px solid var(--border-main); border-radius: 6px; padding: 8px 10px; }
.head { display: flex; gap: 10px; align-items: center; padding-bottom: 6px; }
.inline-name { background: none; border: none; color: inherit; font: inherit; font-weight: 600; width: 220px; }
.field-row { padding: 3px 0; border-top: 1px solid var(--border-main); }
.new-field { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-main); }
.muted { color: var(--text-muted); }
button {
  background: var(--controls-bg); border: 1px solid var(--border-main);
  color: var(--text-secondary); border-radius: 4px; padding: 2px 8px; cursor: pointer;
}
.danger { color: var(--danger); }
</style>
