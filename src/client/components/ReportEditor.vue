<!--
  The REPORT DEFINITION editor (REPORTS-BRIEF.md, step 4): mounted by
  StructuredField for a `structured` field of shape 'report', in the record tray.

  It edits a DRAFT — a deep copy of the stored definition (or an empty root) —
  through ReportLevelEditor, one component per level. Every change re-runs the
  same validation the server runs (`reportDefError`, over the whole schema) and the
  first problem is shown; Save is enabled only when there is none, and writes the
  definition ONCE (one mutation, one Ctrl+Z) — not on every tick of a checkbox,
  which would spray mutations and, worse, half-built definitions the server would
  refuse. A stored definition that changes underneath (a peer, or Ctrl+Z) replaces
  an UNTOUCHED draft; a touched one is kept, with "revert" offered.

  "edit as JSON…" (StructuredField) stays underneath as the escape hatch.
-->
<template>
  <div class="re" @keydown.stop>
    <ReportLevelEditor :store="store" :level="draft.root" :table="draft.root.table" parent-table="" :ancestors="[]" :depth="0" :used-ids="usedIds" @change="dirty = true" />
    <p v-if="error" class="re-error">{{ error }}</p>
    <p v-else-if="!draft.root.table" class="re-note">Pick the table the report starts from.</p>
    <div class="re-bar">
      <button class="re-btn primary save-report" :disabled="!dirty || !!error" @click="save">save</button>
      <button class="re-btn revert-report" :disabled="!dirty" @click="revert">revert</button>
      <span v-if="dirty" class="re-note">unsaved changes</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Store } from '../store';
import type { FieldRow } from '../state';
import { EMPTY_REPORT, ReportDef, reportDefError, type ReportField, type RootLevel, type Descent } from '../../contract/reports';
import ReportLevelEditor from './ReportLevelEditor.vue';

const props = defineProps<{ store: Store; recordId: string; field: FieldRow; value: unknown }>();
const emit = defineEmits<{ set: [value: unknown] }>();
const store = props.store;

const fresh = (): ReportDef => {
  const r = ReportDef.safeParse(props.value);
  return r.success ? JSON.parse(JSON.stringify(r.data)) : EMPTY_REPORT('');
};
const draft = ref<ReportDef>(fresh());
const dirty = ref(false);
const error = ref('');
const usedIds = new Set<string>();
const collectIds = () => { usedIds.clear(); const walk = (l: RootLevel | Descent) => { usedIds.add(l.id); l.children.forEach(walk); }; walk(draft.value.root); };
collectIds();

function validate() {
  if (!draft.value.root.table) { error.value = ''; return; }
  const err = reportDefError(draft.value, [...store.state.fields.values()] as ReportField[], [...store.state.tables.values()]);
  error.value = err ? err.replace(/^report: /, '') : '';
}
watch(draft, validate, { deep: true, immediate: true });

// The stored value moved (a peer's save, Ctrl+Z, the JSON editor): take it, unless
// the draft has edits of its own — then keep them and let "revert" fetch it.
watch(() => props.value, () => { if (!dirty.value) { draft.value = fresh(); collectIds(); } });

function save() {
  validate();
  if (error.value) return;
  emit('set', JSON.parse(JSON.stringify(draft.value)));
  dirty.value = false;
}
function revert() { draft.value = fresh(); collectIds(); dirty.value = false; }
</script>

<style scoped>
.re { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; }
.re-error { margin: 0; color: var(--warning); font-size: 11px; white-space: normal; }
.re-note { margin: 0; color: var(--text-faint); font-size: 11px; font-style: italic; }
.re-bar { display: flex; align-items: center; gap: 6px; }
.re-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; font-size: 11px; }
.re-btn.primary { border-color: var(--accent); color: var(--accent); }
.re-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.re-btn:disabled { opacity: 0.35; cursor: default; }
</style>
