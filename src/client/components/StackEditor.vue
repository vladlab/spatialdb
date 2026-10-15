<!--
  Making or editing a STACK (contract/canvasStack.ts): which table, which filter,
  in what order, under what name — with a PREVIEW of what that matches right now,
  before anything is placed. The preview is the warning-and-continue: "412
  Files" from a filter meant to match six is cancelled here, not cleaned up after.

  Matching records already placed on the canvas by hand are listed as such and
  left alone unless "gather" is ticked — a stack never moves a card you placed
  yourself on its own say-so.
-->
<template>
  <div class="dlg-backdrop stack-editor" @mousedown.self="emit('cancel')">
    <div class="stack-dlg" role="dialog" aria-modal="true" @keydown.stop="onKey">
      <h2>{{ editing ? 'Edit stack' : 'New stack' }}</h2>
      <p class="dlg-body">A column of every record that matches a filter, kept current: one added later appears here too.</p>

      <label class="dlg-field">
        <span>Table</span>
        <select v-model="draft.tableId" class="dlg-select stack-table" :disabled="editing" @change="draft.filters = []; draft.sort = []">
          <option value="" disabled>choose a table…</option>
          <option v-for="t in tables" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>

      <template v-if="draft.tableId">
        <div class="dlg-field">
          <span>Filter</span>
          <FilterLines :store="store" :table-id="draft.tableId" :filters="draft.filters" note="" @update:filters="draft.filters = $event" />
        </div>
        <div class="dlg-field">
          <span>Order</span>
          <div class="sort-lines">
            <div v-for="(s, i) in draft.sort" :key="i" class="line">
              <select :value="s.fieldId" @change="draft.sort[i] = { fieldId: val($event), dir: s.dir }">
                <option v-for="f in sortable" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
              <select :value="s.dir" @change="draft.sort[i] = { fieldId: s.fieldId, dir: val($event) as 'asc' | 'desc' }">
                <option value="asc">A → Z</option><option value="desc">Z → A</option>
              </select>
              <button class="x" @click="draft.sort.splice(i, 1)">×</button>
            </div>
            <button v-if="sortable.length && draft.sort.length < 8" class="ghost add-sort" @click="draft.sort.push({ fieldId: sortable[0].id, dir: 'asc' })">+ sort…</button>
            <span v-if="!draft.sort.length" class="hint">as created</span>
          </div>
        </div>
        <label class="dlg-field">
          <span>Name <i>(optional — else the filter is the label)</i></span>
          <input v-model="draft.name" class="dlg-input stack-name" :placeholder="description" />
        </label>

        <!-- THE PREVIEW: what this matches now, and what making the stack would do about it. -->
        <div class="preview">
          <p class="preview-line" :class="{ warn: census.total > STACK_MAX }">
            <template v-if="!loaded">loading {{ tableName }}…</template>
            <template v-else-if="!census.total">Matches nothing right now — the stack will fill as records come to match.</template>
            <template v-else>
              <b>{{ census.total.toLocaleString() }}</b> {{ census.total === 1 ? 'record matches' : 'records match' }}<template v-if="census.total > STACK_MAX"> — only the first {{ STACK_MAX }} will be placed; narrow the filter</template>:
              <span class="preview-new" :title="census.missing.length ? `${census.missing.length} not on the canvas yet: placed into the stack` : ''">{{ census.missing.length }} new to the canvas</span>
              <template v-if="census.inStack.length"> · {{ census.inStack.length }} already in this stack</template>
              <template v-if="census.elsewhere.length"> · <span class="preview-elsewhere">{{ census.elsewhere.length }} placed elsewhere</span></template>
            </template>
          </p>
          <ul v-if="loaded && census.total" class="preview-list">
            <li v-for="id in census.matching.slice(0, 40)" :key="id" :class="tagOf(id)">
              <span class="preview-name">{{ labelOf(id) }}</span>
              <span class="preview-tag">{{ tagOf(id) === 'missing' ? 'new' : tagOf(id) === 'elsewhere' ? 'placed elsewhere' : 'in stack' }}</span>
            </li>
            <li v-if="census.matching.length > 40" class="preview-more">…and {{ census.matching.length - 40 }} more</li>
          </ul>
          <label v-if="census.elsewhere.length" class="dlg-check gather-check">
            <input v-model="gather" type="checkbox" /> Also gather the {{ census.elsewhere.length }} placed elsewhere into the stack
            <span class="dlg-hint">Otherwise they stay where you put them; the stack says they are elsewhere, and can gather them later.</span>
          </label>
        </div>
      </template>

      <footer>
        <button class="dlg-cancel" @click="emit('cancel')">Cancel</button>
        <button class="dlg-ok stack-ok" :disabled="!draft.tableId" @click="save">{{ editing ? 'Save' : 'Make stack' }}</button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf, placementKey, recordsOf, tablesSorted } from '../state';
import { useDerived } from '../derived';
import { STACK_MAX, describeFilters, stackCensus, type StackDef } from '../../contract/canvasStack';
import FilterLines from './FilterLines.vue';

const props = defineProps<{ store: Store; canvasId: string; /** The stack being edited, or a fresh one (its id, x and y set). */ initial: StackDef; editing: boolean }>();
const emit = defineEmits<{ save: [def: StackDef, gather: boolean]; cancel: [] }>();
const store = props.store;
const derived = useDerived(store);

const draft = reactive<StackDef>({ ...props.initial, filters: props.initial.filters.map((f) => ({ ...f })), sort: props.initial.sort.map((s) => ({ ...s })) });
const gather = ref(false);
const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;

const tables = computed(() => tablesSorted(store.state).filter((t) => t.kind !== 'junction'));
const tableName = computed(() => store.state.tables.get(draft.tableId)?.name ?? '');
const fields = computed(() => fieldsOf(store.state, draft.tableId));
const sortable = computed(() => fields.value.filter((f) => f.type !== 'attachment' && f.type !== 'rich_text'));
const loaded = computed(() => store.tableLoads.get(draft.tableId)?.state === 'loaded');
const labelOf = (id: string) => derived.plainLabelOfId(id);
const description = computed(() => describeFilters(draft.filters, (id) => store.state.fields.get(id)?.name, labelOf));

/** Where each record's card is on THIS canvas: a stack's id, '' by hand, undefined not here. */
function placedIn(recordId: string): string | undefined {
  const p = store.state.placements.get(placementKey(props.canvasId, recordId));
  if (!p) return undefined;
  const s = p.style?.stack;
  return typeof s === 'string' ? s : '';
}
const linkLabels = (recordId: string, fieldId: string) => { const f = store.state.fields.get(fieldId); return f ? derived.textOf(recordId, f).texts : []; };
const census = computed(() => stackCensus(draft, recordsOf(store.state, draft.tableId), fields.value, placedIn, linkLabels, derived.linksFrom));
const tagOf = (id: string) => (census.value.missing.includes(id) ? 'missing' : census.value.elsewhere.includes(id) ? 'elsewhere' : 'in');

function save() {
  if (!draft.tableId) return;
  const name = draft.name?.trim();
  emit('save', { ...draft, name: name || undefined, filters: draft.filters.map((f) => ({ ...f })), sort: draft.sort.map((s) => ({ ...s })) }, gather.value);
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel'); }
  if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); save(); }
}
</script>

<style scoped>
.dlg-backdrop { position: fixed; inset: 0; z-index: 400; background: rgba(0, 0, 0, 0.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 10vh; }
/* The app's dialog look (DialogHost.vue), which is scoped there — the same numbers. Not
   `.dlg`: the UI suites' autopilot answers any `.dlg` it sees, and this one is driven by hand. */
.stack-dlg { width: min(560px, 94vw); max-height: 84vh; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
h2 { margin: 0 0 12px; font-size: 15px; }
.dlg-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; color: var(--text-muted); font-size: 11px; }
.dlg-input, .dlg-select { background: var(--controls-bg); border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 6px 8px; font: inherit; font-size: 13px; }
.dlg-input:focus, .dlg-select:focus { outline: none; border-color: var(--accent); }
.dlg-check { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; cursor: pointer; font-size: 12px; color: var(--text-secondary); }
.dlg-hint { flex-basis: 100%; color: var(--text-muted); font-size: 11px; padding-left: 22px; }
.dlg-body { margin: 0 0 14px; color: var(--text-secondary); line-height: 1.45; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
footer button { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 5px 14px; cursor: pointer; font: inherit; }
footer button:focus { outline: none; border-color: var(--accent); }
.dlg-ok { color: var(--accent); border-color: var(--accent); }
.dlg-ok:disabled { opacity: 0.4; cursor: not-allowed; }
.dlg-field i { color: var(--text-faint); font-style: normal; font-weight: 400; }
.sort-lines { display: flex; flex-direction: column; gap: 4px; }
.line { display: flex; gap: 4px; align-items: center; }
.line select { font: inherit; font-size: 12px; background: var(--bg-app); color: inherit; border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 4px; }
.x { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 4px; font: inherit; }
.x:hover { color: var(--danger); }
.ghost { align-self: flex-start; background: none; border: 1px dashed var(--border-main); color: var(--text-muted); border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.ghost:hover { color: var(--accent); border-color: var(--accent); }
.hint { color: var(--text-faint); font-size: 11px; }
.preview { margin-top: 10px; padding: 8px 10px; background: rgba(0, 0, 0, 0.22); border: 1px solid var(--border-main); border-radius: 6px; }
.preview-line { margin: 0; font-size: 12px; color: var(--text-secondary); }
.preview-line.warn { color: var(--warning); }
.preview-new { color: var(--accent); }
.preview-elsewhere { color: var(--warning); }
.preview-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 180px; overflow-y: auto; font-size: 11.5px; }
.preview-list li { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
.preview-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.preview-tag { flex: none; color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.preview-list li.missing .preview-tag { color: var(--accent); }
.preview-list li.elsewhere .preview-tag { color: var(--warning); }
.preview-more { color: var(--text-faint); font-style: italic; }
.gather-check { margin-top: 8px; }
</style>
