<!--
  A junction's configuration (sql/016, contract/junction.ts), in Table settings:
  which select is the STATUS (the row's verb), and which link fields on the two
  connected tables SHOULD agree (the MATCH — "a file's Work, a deliverable's Work"),
  which is how the picker knows to offer the right deliverables first.

  The endpoints themselves are not editable here: they were made with the table
  and they are what makes it a junction. The status choices are edited where every
  select's are — the column header in the grid — so the vocabulary is the owner's.

  Writes at once through setJunction, which runs the same rule the server does.
-->
<template>
  <div v-if="cfg" class="js">
    <p class="info">
      <b>⋈ A junction.</b> Every record pairs one <b>{{ nameOf(cfg.a) }}</b> with one <b>{{ nameOf(cfg.b) }}</b>
      and carries the pair's status. Pairs are made from the columns this table put on
      <b>{{ tableName(endA) }}</b> and <b>{{ tableName(endB) }}</b>; nothing is added here directly.
      This is set when a table is made and cannot be changed.
    </p>

    <label class="fld">Status field <span class="hint">a select on this table — its choices are the verbs (“Uploaded”, “Rejected”, “Accepted”); add them from its column header</span>
      <select :value="cfg.status ?? ''" @change="setStatus(val($event))">
        <option value="">(none)</option>
        <option v-for="f in selects" :key="f.id" :value="f.id">{{ f.name }}</option>
      </select>
    </label>

    <div class="fld">
      <span>Match <span class="hint">link fields that should agree — the picker offers records with the same link first, and keeps “show all”</span></span>
      <div v-for="([fa, fb], i) in cfg.match ?? []" :key="i" class="pair">
        <span class="pair-text">{{ tableName(endA) }}.{{ nameOf(fa) }} = {{ tableName(endB) }}.{{ nameOf(fb) }}</span>
        <button class="plain rm" title="Remove this pair" @click="removePair(i)">×</button>
      </div>
      <div class="pair add">
        <select v-model="draftA"><option value="">{{ tableName(endA) }} link…</option><option v-for="f in linksA" :key="f.id" :value="f.id">{{ f.name }} → {{ tableName(String(f.options.target_table_id)) }}</option></select>
        <span>=</span>
        <select v-model="draftB"><option value="">{{ tableName(endB) }} link…</option><option v-for="f in linksB" :key="f.id" :value="f.id">{{ f.name }} → {{ tableName(String(f.options.target_table_id)) }}</option></select>
        <button class="plain add-pair" :disabled="!draftA || !draftB" @click="addPair">Add</button>
      </div>
      <p v-if="!linksA.length || !linksB.length" class="hint">Both tables need a link field to the same table (a Work, a Show) for a match to be possible.</p>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { useSchemaActions } from '../schemaActions';
import { junctionOf, type JunctionConfig } from '../../contract/junction';

const props = defineProps<{ store: Store; tableId: string }>();
const actions = useSchemaActions(props.store);
const val = (e: Event) => (e.target as HTMLSelectElement).value;

const cfg = computed(() => junctionOf(props.store.state.tables.get(props.tableId)));
const nameOf = (id: string) => props.store.state.fields.get(id)?.name ?? '?';
const tableName = (id: string) => props.store.state.tables.get(id)?.name ?? '?';
const endA = computed(() => String(props.store.state.fields.get(cfg.value?.a ?? '')?.options?.target_table_id ?? ''));
const endB = computed(() => String(props.store.state.fields.get(cfg.value?.b ?? '')?.options?.target_table_id ?? ''));
const selects = computed(() => fieldsOf(props.store.state, props.tableId).filter((f) => f.type === 'select'));
const linksA = computed(() => fieldsOf(props.store.state, endA.value).filter((f) => f.type === 'link'));
const linksB = computed(() => fieldsOf(props.store.state, endB.value).filter((f) => f.type === 'link'));

const error = ref('');
const draftA = ref(''), draftB = ref('');

function write(next: JunctionConfig) { error.value = actions.setJunction(props.tableId, next) ?? ''; }
function setStatus(id: string) {
  if (!cfg.value) return;
  const { status: _s, ...rest } = cfg.value;
  write(id ? { ...rest, status: id } : rest);
}
function addPair() {
  if (!cfg.value || !draftA.value || !draftB.value) return;
  write({ ...cfg.value, match: [...(cfg.value.match ?? []), [draftA.value, draftB.value]] });
  if (!error.value) { draftA.value = ''; draftB.value = ''; }
}
function removePair(i: number) {
  if (!cfg.value) return;
  const match = (cfg.value.match ?? []).filter((_, j) => j !== i);
  const { match: _m, ...rest } = cfg.value;
  write(match.length ? { ...rest, match } : rest);
}
</script>

<style scoped>
.js { margin: 8px 0; }
.info { margin: 6px 0 10px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.fld { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; font-size: 12px; }
.hint { color: var(--text-muted); font-weight: 400; }
select { font: inherit; }
.pair { display: flex; gap: 6px; align-items: center; }
.pair-text { flex: 1; }
.plain { background: none; border: 1px solid var(--border-main); border-radius: 4px; color: var(--text-secondary); cursor: pointer; font: inherit; padding: 2px 8px; }
.plain:hover:not([disabled]) { color: var(--text-primary); border-color: var(--text-muted); }
.plain[disabled] { opacity: 0.5; cursor: default; }
.err { color: var(--danger); font-size: 12px; }
</style>
