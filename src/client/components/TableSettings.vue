<!--
  Everything about ONE table that is not a field: its name, how it looks, and
  deleting it. Opened from the ⚙ on a table's row in the tree.

  This is where the Schema tab's table-level controls went when that tab was
  removed (fields are edited in the grid's column headers — ⚙ and +). Colour and
  icon were in the database from the first migration and never had a UI.

  Every control writes at once; each is its own small undoable mutation.
-->
<template>
  <div class="ts-backdrop" @mousedown.self="$emit('close')">
    <div v-if="table" class="ts" @keydown.stop="onKey">
      <header><h2>Table settings</h2><button class="x" title="Close (Esc)" @click="$emit('close')">×</button></header>

      <div class="line">
        <input class="icon-in" :value="table.icon" maxlength="4" placeholder="▦" title="An emoji, or a letter" @change="upd({ icon: val($event) })" />
        <input ref="nameInput" class="name-in" :value="table.name" @change="actions.renameTable(table.id, val($event))" />
        <input type="color" :value="table.color || '#4a4a4a'" title="Card colour for this table's records" @change="upd({ color: val($event) })" />
      </div>
      <label class="fld">Singular name <span class="hint">shown on cards — “Deliverable”, not “Deliverables”</span>
        <input :value="table.singular_name" placeholder="(optional)" @change="upd({ singularName: val($event) })" />
      </label>

      <p class="info">
        <template v-if="table.kind === 'canvas'"><b>▦ A table of boards.</b> Every record in it is a canvas. This is set when a table is made and cannot be changed.</template>
        <template v-else>An ordinary table. (Tables of boards — where each record is a canvas — are made with the tick box in the new-table dialog.)</template>
      </p>
      <p class="info">{{ nFields }} field{{ nFields === 1 ? '' : 's' }} — edit them from the grid's column headers (⚙ on a column, + to add one).</p>

      <footer><button class="danger" @click="remove">Delete table…</button></footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { useSchemaActions } from '../schemaActions';

const props = defineProps<{ store: Store; tableId: string }>();
const emit = defineEmits<{ close: [] }>();
const actions = useSchemaActions(props.store);
const nameInput = ref<HTMLInputElement>();

const val = (e: Event) => (e.target as HTMLInputElement).value;
const table = computed(() => props.store.state.tables.get(props.tableId));
const nFields = computed(() => fieldsOf(props.store.state, props.tableId).length);
const upd = (patch: { icon?: string; color?: string; singularName?: string }) =>
  props.store.mutate({ type: 'table.update', id: props.tableId, ...patch });

async function remove() { if (await actions.deleteTable(props.tableId)) emit('close'); }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
onMounted(() => void nextTick(() => nameInput.value?.focus()));
</script>

<style scoped>
.ts-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.4); display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; }
.ts { width: min(480px, 92vw); background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
header { display: flex; align-items: center; margin-bottom: 10px; }
h2 { margin: 0; font-size: 15px; flex: 1; }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.line { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; }
input:not([type='color']) { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 8px; font: inherit; min-width: 0; }
.icon-in { width: 44px; text-align: center; }
.name-in { flex: 1; font-weight: 600; }
input[type='color'] { width: 30px; height: 26px; padding: 0; border: 1px solid var(--border-main); background: none; }
.fld { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px; }
.hint { color: var(--text-faint); }
.info { color: var(--text-muted); font-size: 12px; margin: 0 0 8px; line-height: 1.4; }
footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-main); }
.danger { background: none; border: 1px solid var(--border-main); color: var(--danger); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
</style>
