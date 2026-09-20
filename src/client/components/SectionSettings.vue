<!--
  Everything about ONE section: name, look, which tables and canvases it holds,
  and its scope table. Opened from a home card's ⚙ and from the breadcrumb.

  Every control writes immediately (each is its own small, undoable mutation), so
  there is no Save button and nothing to lose by closing.

  TABLES are a list on the section (a table can be in several). CANVASES need
  nothing of their own: a canvas is a record in a table of boards (sql/010), so a
  section's canvases are simply the boards in its tables.
-->
<template>
  <div class="ss-backdrop" @mousedown.self="$emit('close')">
    <div v-if="section" class="ss" @keydown.stop="onKey">
      <header>
        <h2>Section settings</h2>
        <button class="x" title="Close (Esc)" @click="$emit('close')">×</button>
      </header>

      <div class="row">
        <input class="icon-in" :value="section.icon" maxlength="4" placeholder="▦" title="An emoji, or a letter"
               @change="upd({ icon: val($event) })" />
        <input ref="nameInput" class="name-in" :value="section.name" placeholder="name" @change="val($event).trim() && upd({ name: val($event).trim() })" />
        <input type="color" :value="section.color || '#4a4a4a'" title="Accent colour" @change="upd({ color: val($event) })" />
      </div>
      <input class="desc-in" :value="section.description" placeholder="what is this section for? (shown on the home page)"
             @change="upd({ description: val($event) })" />

      <h3>Tables in this section</h3>
      <p class="note">A table can be in several sections. Unticking one here hides it from this section — it is still under Everything, and its data is untouched.</p>
      <div class="checks">
        <label v-for="t in allTables" :key="t.id">
          <input type="checkbox" :checked="section.table_ids.includes(t.id)" @change="toggleTable(t.id)" /> {{ t.kind === 'canvas' ? '▦ ' : '' }}{{ t.name }}
        </label>
        <p v-if="!allTables.length" class="note">No tables exist yet.</p>
      </div>

      <h3>Scope</h3>
      <p class="note">Optional. Name one of this section's tables as its scope — for a Projects section, the Projects table. You can then narrow the whole section to one of its records (one project).</p>
      <div class="row">
        <select class="scope-table" :value="section.scope_table_id ?? ''" @change="setScope(val($event))">
          <option value="">not scoped</option>
          <option v-for="t in ownTables" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <select v-if="section.scope_table_id" class="archived-field" :value="section.archived_field_id ?? ''"
                title="A checkbox field that marks a record of the scope table as archived"
                @change="upd({ archivedFieldId: val($event) || null })">
          <option value="">no "archived" checkbox</option>
          <option v-for="f in checkboxFields" :key="f.id" :value="f.id">archived = {{ f.name }}</option>
        </select>
      </div>

      <h3>Canvases</h3>
      <p class="note">A canvas is a record in a table of boards (marked ▦ above). Put that table in this section and its boards are this section's canvases — nothing to file one by one. "+" beside the canvas picker makes a boards table here if there is none.</p>

      <footer>
        <button class="danger" @click="remove">Delete section…</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf, tablesOfSection, tablesSorted } from '../state';
import { confirmDialog } from '../dialogs';

const props = defineProps<{ store: Store; sectionId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = props.store;
const nameInput = ref<HTMLInputElement>();

const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
const section = computed(() => store.state.sections.get(props.sectionId));
const allTables = computed(() => tablesSorted(store.state));
const ownTables = computed(() => tablesOfSection(store.state, section.value));
const checkboxFields = computed(() =>
  (section.value?.scope_table_id ? fieldsOf(store.state, section.value.scope_table_id) : []).filter((f) => f.type === 'checkbox'));

type Patch = Omit<Extract<Parameters<Store['mutate']>[0], { type: 'section.update' }>, 'type' | 'id'>;
const upd = (patch: Patch) => store.mutate({ type: 'section.update', id: props.sectionId, ...patch });

function toggleTable(tableId: string) {
  const s = section.value!;
  const has = s.table_ids.includes(tableId);
  const tableIds = has ? s.table_ids.filter((x) => x !== tableId) : [...s.table_ids, tableId];
  // The scope table must be one of the section's tables (the server insists), so
  // removing it un-scopes the section in the same mutation.
  upd(has && s.scope_table_id === tableId ? { tableIds, scopeTableId: null } : { tableIds });
}
const setScope = (tableId: string) => upd({ scopeTableId: tableId || null });

async function remove() {
  if (!await confirmDialog({ title: `Delete the section “${section.value?.name}”?`, danger: true, okText: 'Delete section',
    body: 'Its tables, records and canvases are NOT deleted — they stay under Everything. It can be restored from History.' })) return;
  store.mutate({ type: 'section.delete', id: props.sectionId });
  emit('close');
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
onMounted(() => void nextTick(() => nameInput.value?.focus()));
</script>

<style scoped>
.ss-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.4); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
.ss { width: min(560px, 92vw); max-height: 82vh; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
header { display: flex; align-items: center; margin-bottom: 10px; }
h2 { margin: 0; font-size: 15px; flex: 1; }
h3 { margin: 16px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
input:not([type='checkbox']):not([type='color']), select {
  background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 8px; font: inherit; min-width: 0;
}
.icon-in { width: 44px; text-align: center; }
.name-in { flex: 1; font-weight: 600; }
.desc-in { width: 100%; box-sizing: border-box; }
input[type='color'] { width: 30px; height: 26px; padding: 0; border: 1px solid var(--border-main); background: none; }
.checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 2px 12px; }
.checks label { display: flex; gap: 6px; align-items: center; cursor: pointer; padding: 2px 0; }
.note { color: var(--text-muted); font-size: 11px; margin: 0 0 6px; }
label .note { margin: 0; }
footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--border-main); }
button.danger { background: none; border: 1px solid var(--border-main); color: var(--danger); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
</style>
