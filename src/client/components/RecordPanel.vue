<!--
  The expanded record: every field of ONE record, editable, in a side panel.

  Opened from the grid (Space on a selected cell, or the ⤢ by the row number) and
  from the canvas (double-click a card, Enter on a selected one, or right after
  creating one). It is the answer to two things at once: the grid's 30-pixel rows
  have no room for long values, and the canvas had no way to edit at all. Rather
  than teach cards to edit, a card OPENS — and what opens is the same editors the
  grid uses (CellEditor, LinkPicker), so a value is edited one way everywhere and
  a relational field is filled in from the canvas exactly as it is from a table.

  Same select-then-edit contract as the grid, turned vertical: click a value (or
  Enter on it) to edit; Enter / Tab commit and move to the NEXT field, Shift+Tab
  to the previous, Escape cancels. `long_text` is the exception — it is multi-
  line here, so Enter is a newline and Ctrl+Enter commits.

  It is a PANEL, not a modal: the grid or canvas stays live beside it, so you can
  click another row or card and the panel follows. Rich text (step 3 of the plan)
  lands here first.
-->
<template>
  <aside v-if="record" class="record-panel" tabindex="-1" @keydown.stop="onPanelKey"
         @pointerdown.stop @dblclick.stop @wheel.stop @contextmenu.stop>
    <header class="rp-head" :style="{ borderTopColor: tableColor }">
      <span class="rp-table">{{ table?.name ?? 'record' }}</span>
      <h2 class="rp-title" :class="{ empty: !title }">{{ title || 'untitled' }}</h2>
      <button v-if="table?.kind === 'canvas'" class="rp-open-board" title="This record is a canvas — open it" @click="$emit('open-board', recordId)">▦ open board</button>
      <button class="rp-close" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <div class="rp-body">
      <div v-for="f in fields" :key="f.id" class="rp-field" :class="{ editing: editingId === f.id, block: f.type === 'rich_text' }">
        <label class="rp-name">
          <span v-if="f.id === primaryId" class="star" title="Primary field — this record's name">★</span>{{ f.name }}
        </label>

        <!-- RICH TEXT is not a click-to-edit value like the rest: it is an editor that
             is simply THERE, full width, at a height that only the user changes. The
             wrapper reserves that height while TipTap loads (it is fetched on demand),
             so the fields below do not jump when it arrives. Keyed by record: a
             different record is a different document, not new content for this one. -->
        <div v-if="f.type === 'rich_text'" class="rp-rich" :style="{ minHeight: richReserve + 'px' }">
          <RichTextEditor :key="recordId + f.id" :store="store" :record-id="recordId" :field-key="f.key" :value="record.data[f.key]"
                          @set="setRich" @unset="unsetRich" />
        </div>

        <div v-else :ref="(el) => setValueEl(f.id, el)" class="rp-value" :class="{ readonly: READONLY(f) }"
             :tabindex="READONLY(f) ? -1 : 0"
             @click="startEdit(f)" @keydown.enter.prevent.stop="startEdit(f)">
          <!-- LINK -->
          <template v-if="f.type === 'link'">
            <span v-for="to in linksFrom(f.id)" :key="to" class="chip">
              {{ labelOfId(to) }}<button class="chip-open" tabindex="-1" :title="`Open ${labelOfId(to)}`"
                                         @mousedown.stop.prevent @click.stop="$emit('open', to)">⤢</button><button class="chip-x" tabindex="-1" title="Remove this link"
                                        @click.stop="removeLink(f.id, to)">×</button>
            </span>
            <span v-if="!linksFrom(f.id).length && editingId !== f.id" class="placeholder">add a link…</span>
            <LinkPicker v-if="editingId === f.id && targetOf(f)" :store="store" :target-table-id="targetOf(f)!"
                        :linked="linksFrom(f.id)" :anchor="valueEls.get(f.id)"
                        @add="(to) => addLink(f.id, to)" @remove="(to) => removeLink(f.id, to)" @done="onDone" />
          </template>

          <!-- CHECKBOX: toggles in place, as in the grid. false is stored, not unset. -->
          <input v-else-if="f.type === 'checkbox'" type="checkbox" :checked="record.data[f.key] === true"
                 @click.stop @change="setValue(f.key, !(record.data[f.key] === true))" />

          <!-- BACKLINK: links made on OTHER records, pointing here. Read-only; each
               chip opens the record that holds the link. -->
          <template v-else-if="f.type === 'backlink'">
            <span v-if="derived.backlinkOf(recordId, f) === null" class="broken">broken backlink</span>
            <button v-for="from in derived.backlinkOf(recordId, f) ?? []" v-else :key="from" class="chip back"
                    title="Open that record" @click.stop="$emit('open', from)">{{ labelOfId(from) }}</button>
            <span v-if="derived.backlinkOf(recordId, f)?.length === 0" class="placeholder">nothing links here</span>
          </template>

          <!-- ATTACHMENT: always live; every add/remove is written at once. -->
          <!-- STRUCTURED: a manifest, an audio layout… always live, like attachments. -->
          <StructuredField v-else-if="f.type === 'structured'" :store="store" :record-id="recordId" :field="f"
                           :value="record.data[f.key]" @set="setValue" @unset="unsetValue" />

          <AttachmentField v-else-if="f.type === 'attachment'" :store="store" :field-key="f.key"
                           :value="record.data[f.key]" @set="setValue" @unset="unsetValue" />

          <!-- LOOKUP: computed, read-only. -->
          <template v-else-if="f.type === 'lookup'">
            <span v-if="lookupOf(f) === null" class="broken">broken lookup</span>
            <span v-else class="looked-up">{{ lookupOf(f)!.join(', ') || '—' }}</span>
          </template>

          <CellEditor v-else-if="editingId === f.id" :field="f" :value="record.data[f.key]"
                      :multiline="f.type === 'long_text'"
                      @set="setValue" @unset="unsetValue" @done="onDone" @cancel="onDone('none')" />

          <template v-else>
            <span v-if="f.type === 'multi_select'" class="chips">
              <span v-for="c in asList(record.data[f.key])" :key="c" class="chip plain">{{ c }}</span>
            </span>
            <span v-else class="text" :class="{ pre: f.type === 'long_text' }">{{ formatNumberField(f, record.data[f.key]) ?? display(record.data[f.key]) }}</span>
            <span v-if="isEmpty(record.data[f.key])" class="placeholder">empty</span>
          </template>
        </div>
      </div>
      <!-- EVERYTHING that points at this record, whether or not the table has a
           backlink field for it. A record's role — output of what, input to what —
           is the set of links pointing at it, so this is never hidden behind
           configuration. -->
      <div v-if="referencedBy.length" class="rp-refs">
        <h3>Referenced by</h3>
        <div v-for="g in referencedBy" :key="g.field.id" class="rp-ref">
          <span class="rp-ref-via">{{ g.tableName }} · {{ g.field.name }}</span>
          <button v-for="from in g.from" :key="from" class="chip back" title="Open that record"
                  @click="$emit('open', from)">{{ labelOfId(from) }}</button>
        </div>
      </div>

      <p v-if="!fields.length" class="rp-note">This table has no fields yet — add some from the grid's “+” header.</p>
    </div>

    <footer class="rp-foot">
      <span class="rp-note mono" :title="record.id">{{ record.id.slice(0, 8) }}</span>
      <span class="spacer" />
      <button class="danger" @click="remove">Delete record…</button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, reactive, ref, watch } from 'vue';
import type { Store } from '../store';
import { fieldsOf, primaryKeys, type FieldRow } from '../state';
import { labelFrom } from '../../contract/labels';
import { useDerived } from '../derived';
import { confirmDialog } from '../dialogs';
import CellEditor, { type EditExit } from './CellEditor.vue';
import LinkPicker from './LinkPicker.vue';
import AttachmentField from './AttachmentField.vue';
import StructuredField from './StructuredField.vue';
import { formatNumberField } from '../../contract/shapes';

// Loaded ON DEMAND. TipTap + ProseMirror are most of a megabyte of source, and
// nothing needs them until a record with a rich_text field is opened — so they
// stay out of the bundle the app starts with.
const RichTextEditor = defineAsyncComponent(() => import('./RichTextEditor.vue'));

const props = defineProps<{ store: Store; recordId: string }>();
const emit = defineEmits<{ close: []; open: [recordId: string]; 'open-board': [recordId: string] }>();
const store = props.store;
// Declared FIRST: an `immediate` watcher below calls into it during setup, and a
// `const` used before its declaration line is a runtime error typecheck cannot see.
const derived = useDerived(store);

const record = computed(() => store.state.records.get(props.recordId));
const table = computed(() => store.state.tables.get(record.value?.table_id ?? ''));
const tableColor = computed(() => table.value?.color || 'var(--card-head-bg)');
const fields = computed(() => (record.value ? fieldsOf(store.state, record.value.table_id) : []));

const labelKeys = computed(() => primaryKeys(store.state));
const primaryId = computed(() => {
  const key = labelKeys.value.get(record.value?.table_id ?? '');
  return fields.value.find((f) => f.key === key)?.id;
});
const title = computed(() =>
  (record.value ? labelFrom(record.value.data, labelKeys.value.get(record.value.table_id), '') : ''));

// The record vanished — deleted here, by a peer, or undone out of existence.
watch(record, (r) => { if (!r) emit('close'); });

/* ── what the panel needs loaded ──────────────────────────────────────────

   Opened from the CANVAS, the store holds only what the scene brought: records
   placed on that canvas, and links with BOTH ends on it. This record's other
   links are simply absent, so its link fields would look empty — and editing
   them would look like adding the first link to a field that already has five.
   Walking the record's table brings every link touching it. Lookups additionally
   read the far table. `loadTable` is a no-op for anything already loaded. */
watch(() => [record.value?.table_id, fields.value.map((f) => f.id).join()], () => {
  if (!record.value) return;
  void store.loadTable(record.value.table_id);
  for (const t of derived.tablesNeededBy(fields.value)) void store.loadTable(t);
}, { immediate: true });

/* ── values as text ───────────────────────────────────────────────────── */

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const display = (v: unknown) => (isEmpty(v) ? '' : String(v));
const asList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const labelOfId = derived.labelOfId;
const linksFrom = (fieldId: string) => derived.linksFrom(props.recordId, fieldId);
const lookupOf = (f: FieldRow) => derived.lookupOf(props.recordId, f);
const targetOf = (f: FieldRow) => f.options?.target_table_id as string | undefined;
const referencedBy = computed(() => derived.referencedBy(props.recordId));
const READONLY = (f: FieldRow) => f.type === 'lookup' || f.type === 'backlink';

/* ── editing ──────────────────────────────────────────────────────────── */

const editingId = ref('');
const valueEls = reactive(new Map<string, HTMLElement>());
function setValueEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) valueEls.set(id, el); else valueEls.delete(id);
}
// `attachment` and `rich_text` are always live (no edit mode), like a checkbox.
const EDITABLE = (f: FieldRow) => !READONLY(f) && !['checkbox', 'attachment', 'rich_text', 'structured'].includes(f.type);

function startEdit(f: FieldRow) {
  if (!EDITABLE(f) || editingId.value === f.id) return;
  editingId.value = f.id;
}

/** Enter/Tab move to the next field you can type in; Shift+Tab to the previous. */
function onDone(exit: EditExit) {
  const from = editingId.value;
  editingId.value = '';
  const list = fields.value.filter(EDITABLE);
  const i = list.findIndex((f) => f.id === from);
  const next = exit === 'down' || exit === 'right' ? list[i + 1] : exit === 'left' ? list[i - 1] : undefined;
  if (next) void nextTick(() => startEdit(next));
  else void nextTick(() => valueEls.get(from)?.focus());
}

function onPanelKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !editingId.value) emit('close');
}

function setValue(key: string, value: unknown) {
  store.mutate({ type: 'record.update', id: props.recordId, set: { [key]: value }, unset: [] });
}
function unsetValue(key: string) {
  store.mutate({ type: 'record.update', id: props.recordId, set: {}, unset: [key] });
}
// Rich text names its OWN record (see RichTextEditor's `recordId` prop): it can
// save while unmounting, when `props.recordId` is already the next record.
function setRich(recordId: string, key: string, value: unknown) {
  store.mutate({ type: 'record.update', id: recordId, set: { [key]: value }, unset: [] });
}
function unsetRich(recordId: string, key: string) {
  store.mutate({ type: 'record.update', id: recordId, set: {}, unset: [key] });
}
/** The editor's remembered height + its toolbar: reserved while TipTap loads, so nothing below jumps. */
const richReserve = (() => { try { return Math.max(140, Number(localStorage.getItem('spatialdb.rte.height')) || 340) + 34; } catch { return 374; } })();

function addLink(fieldId: string, toRecord: string) {
  store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId, fromRecord: props.recordId, toRecord });
}
function removeLink(fieldId: string, toRecord: string) {
  store.mutate({ type: 'link.remove', fieldId, fromRecord: props.recordId, toRecord });
}
async function remove() {
  if (!await confirmDialog({ title: `Delete “${title.value || 'this record'}” everywhere?`, body: 'It can be restored from History.', danger: true, okText: 'Delete record' })) return;
  store.mutate({ type: 'record.delete', id: props.recordId });
}

/* A record opened EMPTY is one that was just created (on the canvas, or "+ add
   record"): go straight to typing its name. Re-evaluated when the panel is
   pointed at a different record. */
watch(() => props.recordId, () => {
  editingId.value = '';
  void nextTick(() => {
    const r = record.value;
    if (!r || Object.keys(r.data).length) return;
    const first = fields.value.find((f) => f.id === primaryId.value) ?? fields.value.find(EDITABLE);
    if (first) startEdit(first);
  });
}, { immediate: true });
</script>

<style scoped>
.record-panel {
  /* A TRAY: a flex sibling of the viewport (App.vue sets its width and the
     splitter beside it resizes it). It used to be `position: absolute` over the
     right edge, where it covered the grid's "+" column and made "fit" fit a
     viewport you could not fully see. */
  position: relative; flex: none; min-width: 320px; max-width: 70vw;
  display: flex; flex-direction: column; outline: none;
  background: var(--bg-app); font-size: 13px;
}
.rp-head {
  flex: none; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center;
  padding: 10px 12px; border-top: 3px solid; border-bottom: 1px solid var(--border-main);
}
.rp-table { grid-column: 1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.rp-title { grid-column: 1; margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-title.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }
.rp-head { grid-template-columns: 1fr auto auto !important; }
.rp-open-board { grid-row: 1 / span 2; background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; font-size: 12px; }
.rp-close { grid-column: 3; grid-row: 1 / span 2; background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.rp-close:hover { color: var(--text-primary); }

.rp-body { flex: 1; overflow-y: auto; padding: 8px 12px; }
.rp-field { padding: 6px 0; }
.rp-field.block { padding: 10px 0; }
/* min-height is set inline (richReserve): the editor's place, held while it loads. */
.rp-rich { display: flex; }
.rp-name { display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
.star { color: var(--warning); margin-right: 3px; }
.rp-value {
  position: relative; min-height: 28px; box-sizing: border-box; padding: 4px 8px;
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  border: 1px solid var(--border-main); border-radius: 4px; cursor: text; outline: none;
}
.rp-value:focus { border-color: var(--accent); }
.rp-field.editing .rp-value { border-color: var(--success); }
.rp-value.readonly { border-style: dashed; cursor: default; }
.text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text.pre { white-space: pre-wrap; overflow: visible; }
.placeholder { color: var(--text-faint); font-style: italic; }
.looked-up { color: var(--text-secondary); font-style: italic; }
.broken { color: var(--danger); font-size: 11px; }
/* These chips are <button>s (they open the record they name), and a button does
   NOT inherit `color` — left unset, the browser paints its default near-black
   text, which on this background was unreadable. Same chip, explicit colours;
   accent-coloured because they are the only chips in the panel you can click. */
.chip.back {
  font: inherit; font-size: 11px; font-style: italic; cursor: pointer;
  color: var(--accent); background: var(--controls-bg); border: 1px solid var(--border-main);
  padding: 1px 8px;
}
.chip.back:hover { border-color: var(--accent); color: var(--text-primary); }
.rp-refs { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-main); }
.rp-refs h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.rp-ref { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 3px 0; }
.rp-ref-via { color: var(--text-muted); font-size: 11px; margin-right: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.rp-value :deep(textarea.multi) { height: 160px; }

.rp-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-main); }
.rp-note { color: var(--text-muted); font-size: 11px; margin: 0; }
.mono { font-family: ui-monospace, monospace; }
.spacer { flex: 1; }
.rp-foot button { background: none; border: 1px solid var(--border-main); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
.danger { color: var(--danger); }
</style>
