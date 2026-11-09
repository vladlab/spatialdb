<!--
  A note, as a page — ONE rich text field of one record, filling the window.

  The tray's editor is a box among other fields; some notes are the whole job (a
  deliverable spec pasted from three emails, with screenshots) and want the screen.
  This is that: opened in its own browser tab from the tray ("open ↗" on the field)
  or from a row's or card's menu, at an address of its own (router.ts `NoteRoute`).
  The app draws it INSTEAD of the shell — no tree, no tray, no bars — so what is on
  screen is the context line, the toolbar and the text.

  IT IS THE SAME EDITOR (RichTextEditor, `page`): same Save button and Ctrl+Enter,
  same "someone else saved this" question, same paste and uploads. And the same
  field: the tray in another tab and this page are two editors on one value, which
  the editor already handles — a save in one appears in the other unless that one
  has unsaved words, and then it asks.

  WHAT A TAB CANNOT DO is save on the way out. The tray's editor saves when it goes
  away (a record closed is not words thrown away); a browser tab being closed gives
  a page no time to write anything. So with unsaved words the browser's own "leave
  this page?" prompt is raised — the only thing a page may show at that moment.

  It takes a store, a record and a field and nothing else, on purpose: when the app
  grows tabs of its own, this is what one of them mounts.

  NOT in the desktop client for now: its shell has one window, and the native calls
  are granted to that window alone. The entry points are hidden there.
-->
<template>
  <div class="note-page">
    <!-- The context line when there is no editor to carry it. -->
    <div v-if="problem" class="note-bare">
      <header class="note-context solo">
        <a class="crumb home-crumb" href="#/" title="Home — all sections">spatialdb</a>
      </header>
      <p class="note-problem" :class="{ waiting: problem === WAIT }">{{ problem }}</p>
    </div>

    <RichTextEditor v-else :key="recordId + fieldId" page :store="store" :record-id="recordId" :field-key="field!.key" :value="record!.data[field!.key]"
                    @set="setRich" @unset="unsetRich" @dirty="dirty = $event">
      <template #context>
        <nav class="note-context" aria-label="Which note this is">
          <a class="crumb home-crumb" href="#/" title="Home — all sections">spatialdb</a>
          <span class="sep">›</span>
          <a class="crumb table-crumb" :href="tableHref" :title="`Open the table ${table!.name}`">{{ table!.name }}</a>
          <span class="sep">›</span>
          <a class="crumb record-crumb" :href="recordHref" title="Open this record in the app">{{ label }}</a>
          <span class="sep">›</span>
          <span class="crumb field-crumb">{{ field!.name }}</span>
        </nav>
        <span v-if="store.streamState.value !== 'connected'" class="note-offline" title="Not connected to the server: a save waits until it is">{{ store.streamState.value }}</span>
      </template>
    </RichTextEditor>

    <div v-if="store.errors.value.length" class="note-errors">
      <div v-for="(e, i) in store.errors.value.slice(0, 5)" :key="i" title="Click to dismiss" @click="store.errors.value.splice(i, 1)">{{ e }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Store } from '../store';
import { useDerived } from '../derived';
// Not lazy, unlike in the tray: this page IS the editor.
import RichTextEditor from './RichTextEditor.vue';

const props = defineProps<{ store: Store; recordId: string; fieldId: string }>();
const store = props.store;
const derived = useDerived(store);

const field = computed(() => store.state.fields.get(props.fieldId));
const table = computed(() => store.state.tables.get(field.value?.table_id ?? ''));
const record = computed(() => store.state.records.get(props.recordId));

// The client holds whole tables or nothing (store.loadTable): the note's record
// arrives with its table, and from then on the stream keeps it current.
watch(() => table.value?.id, (id) => { if (id) void store.loadTable(id); }, { immediate: true });

const WAIT = 'Loading…';
/** Why there is no editor, or '' when there is one. */
const problem = computed(() => {
  if (!field.value || !table.value) return 'This address does not lead to a field — it may have been deleted.';
  if (field.value.type !== 'rich_text') return `“${field.value.name}” is not a rich text field.`;
  if (record.value) return record.value.table_id === table.value.id ? '' : `This record is not in ${table.value.name}.`;
  const load = store.tableLoads.get(table.value.id)?.state;
  if (load === 'failed') return `Could not load ${table.value.name}.`;
  return load === 'loaded' ? 'This record no longer exists.' : WAIT;
});

const label = computed(() => derived.labelOfId(props.recordId) || 'untitled');
// Under "Everything": a table can sit in several sections or none, and this is the
// one address that is right for all of them.
const tableHref = computed(() => `#/all/table/${table.value?.id ?? ''}`);
const recordHref = computed(() => `${tableHref.value}?r=${props.recordId}`);

function setRich(recordId: string, key: string, value: unknown) {
  store.mutate({ type: 'record.update', id: recordId, set: { [key]: value }, unset: [] });
}
function unsetRich(recordId: string, key: string) {
  store.mutate({ type: 'record.update', id: recordId, set: {}, unset: [key] });
}

/* ── the browser tab's name: which note, so several open notes can be told apart ── */
const before = typeof document === 'undefined' ? '' : document.title;
watch([label, () => field.value?.name, problem], () => {
  document.title = problem.value ? before : `${label.value} — ${field.value!.name}`;
}, { immediate: true });
onUnmounted(() => { document.title = before; });

/* ── unsaved words and a closing tab ── */
const dirty = ref(false);
const onBeforeUnload = (e: Event) => {
  if (!dirty.value) return;
  e.preventDefault();
  (e as BeforeUnloadEvent).returnValue = '';
};
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload));
</script>

<style scoped>
/* The PAGE scrolls (not the editor): the editor's top lines are sticky inside it. */
.note-page { height: 100%; overflow-y: auto; background: var(--bg-canvas); color: var(--text-primary); display: flex; flex-direction: column; }
.note-page > :deep(.rte) { flex: 1 0 auto; }
.note-context { display: flex; align-items: center; gap: 6px; min-width: 0; }
.note-context.solo { height: 38px; padding: 0 12px; background: var(--bg-chrome); border-bottom: 1px solid var(--border-main); }
.crumb { color: var(--text-secondary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
a.crumb:hover { color: var(--accent); }
.home-crumb { color: var(--text-primary); font-weight: 600; flex: none; }
.sep { color: var(--text-faint); flex: none; }
.record-crumb { color: var(--text-primary); }
.field-crumb { color: var(--text-primary); font-weight: 600; }
.note-offline { font-size: 11px; color: var(--warning); margin-left: 10px; white-space: nowrap; }
.note-problem { margin: 48px auto; max-width: 750px; padding: 0 28px; color: var(--text-secondary); font-size: 14px; }
.note-problem.waiting { color: var(--text-faint); }
.note-errors { position: sticky; bottom: 0; padding: 8px 12px; background: var(--bg-error); color: var(--text-error); font-size: 11px; max-height: 120px; overflow: auto; cursor: pointer; }
</style>
