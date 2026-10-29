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
      <button v-if="table?.kind === 'report'" class="rp-open-board rp-open-report" title="This record is a report — open it" @click="$emit('open-report', recordId)">▤ open report</button>
      <button v-if="table?.kind === 'calendar'" class="rp-open-board rp-open-calendar" title="This record is a calendar — open it" @click="$emit('open-calendar', recordId)">▥ open calendar</button>
      <button v-if="table?.kind !== 'junction'" class="rp-dup" title="Duplicate this record (its values and links; created now, by you)" @click="duplicate">⧉ duplicate</button>
      <button class="rp-close" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <!-- COMPARISONS (COMPARE-BRIEF.md): for each comparing link this record has, and
         each record it links to through it — a verdict, "side by side", and "seed
         from". Derived, live; nothing here is stored. -->
    <div v-if="comparisons.length" class="rp-compare rp-well">
      <div v-for="c in comparisons" :key="c.link.id + c.target" class="rp-cmp" :class="{ same: c.result?.same }">
        <VerdictMark v-if="c.result" class="rp-cmp-verdict" :kind="c.result.same ? 'ok' : 'bad'" /><span v-else class="rp-cmp-verdict">…</span>
        <span class="rp-cmp-text"><b>{{ c.link.name }}</b> → {{ c.targetLabel }}<template v-if="c.result && !c.result.same">: {{ c.diffs }} difference{{ c.diffs === 1 ? '' : 's' }}</template></span>
        <button class="rp-cmp-btn sbs-btn" @click="sideBySide = sideBySide?.target === c.target && sideBySide.linkId === c.link.id ? null : { linkId: c.link.id, target: c.target }">side by side</button>
        <button class="rp-cmp-btn seed-btn" :title="`Copy ${c.targetLabel}'s paired values into this record's EMPTY fields (one Ctrl+Z)`" @click="seedFrom(c.link.id, c.target)">seed from</button>
      </div>
      <SideBySide v-if="sideBySide" :store="store" :link-id="sideBySide.linkId" :owner-id="recordId" :target-id="sideBySide.target" @close="sideBySide = null" />
    </div>

    <!-- The tray reads like the tree: each SECTION is a recessed WELL (the comparison
         strip; the record's own fields), and "Referenced by" — automatic, not the
         record's data — sits outside, below. The darker well behind the fields is
         what makes them read without a font change. -->
    <!-- SECTIONS (contract/fieldSections.ts): a table whose schema groups its fields gets
         one well PER GROUP — the unsectioned fields first, with no header, then each
         section under a fold row like the tree's (▾ name, how many fields, and how many
         of them fail a comparison — so folding a section cannot hide a QC problem).
         "Created" and "Created by" belong to no one's schema and close the list as a
         section of their own. A table with no sections is ONE well, as it always was. -->
    <!-- DENSITY (Oct 17–18): EVERY field is ONE ROW of a two-column table — its name in
         a label cell on the left, its value beside it, rows butted together under a
         hairline, as the canvas card lays its fields out. Every label cell is the
         SAME width (`labelW`, the widest field name on this record, measured), so
         the values line up down the whole tray, across sections.
         A field that needs room — an audio layout, a manifest, long or rich text,
         attachments, a junction's nested table — is a BLOCK: its row prints the
         one-line summary the card prints, and under the row, unless it is folded,
         hangs its full editor. The chip at the row's left folds it; the fold is this
         person's, per view (client/fieldFolds.ts). Sections remain the only grouping. -->
    <div class="rp-body" :style="{ '--label-w': labelW + 'px' }">
      <template v-for="g in groups" :key="g.key">
      <button v-if="g.head" class="rp-sec" :class="{ folded: !g.open }" :data-section="g.key" :aria-expanded="g.open"
              :title="g.open ? 'Fold this section (remembered in this browser)' : 'Unfold this section'" @click="toggleGroup(g)">
        <span class="tw">{{ g.open ? '▾' : '▸' }}</span><span class="rp-sec-name">{{ g.name }}</span>
        <span class="rp-sec-count">{{ g.fields.length }}</span>
        <span v-if="g.warn" class="rp-sec-warn" :title="`${g.warn} field${g.warn === 1 ? '' : 's'} in this section differ${g.warn === 1 ? 's' : ''} from what ${g.warn === 1 ? 'it is' : 'they are'} compared with`">⚠ {{ g.warn }}</span>
      </button>
      <div v-if="g.open" class="rp-well rp-fields" :class="{ sectioned: g.head }">
      <div v-for="f in g.fields" :key="f.id" class="rp-field" :class="{ editing: editingId === f.id, readonly: READONLY(f), row: isRow(f), block: !isRow(f), folded: !isRow(f) && folded(f), open: !isRow(f) && !folded(f) }">
        <!-- A <div>, not a <label>: a label activates its FIRST labelable descendant on
             any click inside it, so a second button in it (▶ md5 beside ⤴ show)
             clicked the first one too — the "manual hash also showed the file" bug. -->
        <div class="rp-name">
          <!-- A BLOCK's fold chip: a chevron, right when folded, down when open. -->
          <button v-if="!isRow(f)" class="fold-chip" :aria-expanded="!folded(f)" :title="folded(f) ? 'Unfold this field' : 'Fold this field to its one line (remembered in this browser, for this view)'" @click.stop="toggleFold(f)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="folded(f) ? 'M6 3.5 10.5 8 6 12.5' : 'M3.5 6 8 10.5 12.5 6'" /></svg>
          </button>
          <span class="rp-name-text" :title="f.name"><span v-if="f.id === primaryId" class="star" title="Primary field — this record's name">★</span>{{ f.name }}</span>
          <VerdictMark v-if="verdicts.get(f.id)" class="cmp-badge" :kind="verdicts.get(f.id)!.ok ? 'ok' : 'warn'" :title="verdicts.get(f.id)!.title" />
        </div>

        <!-- A BLOCK's row value: the one-line summary the canvas card prints (an audio
             layout's "2 tracks / 8 ch", a note's first line, "3 files"). A click here is
             a click on the value: it unfolds a folded block, and edits one that is open
             (as any row's value does) — only the chip folds. -->
        <div v-if="!isRow(f)" class="rp-value summary" :class="{ readonly: READONLY(f) }" tabindex="0"
             :title="folded(f) ? 'Unfold' : undefined" @click="summaryClick(f)" @keydown.enter.prevent.stop="summaryClick(f)">
          <span v-if="summaryOf(f)" class="text">{{ summaryOf(f) }}</span>
          <span v-else class="placeholder">empty</span>
          <span class="rp-tools end">{{ ' ' }}
            <!-- The recipe's MANUAL steps (an md5), on the field they write — the manifest. -->
            <template v-if="manualHome === f.id && !jobs.get(recordId)">
              <button v-for="m in manual" :key="m.index" class="reveal run-step" :title="`Run ${m.name} on this record's file now`"
                      @click.stop="runManualStep(store, recordId, m.index)">▶ {{ m.name }}</button>
            </template>
            <span v-if="jobHere(f)" class="job">{{ jobs.get(recordId)!.label }}…</span>
          </span>
        </div>

        <!-- RICH TEXT is not a click-to-edit value like the rest: it is an editor that
             is simply THERE, full width, at a height that only the user changes. The
             wrapper reserves that height while TipTap loads (it is fetched on demand),
             so the fields below do not jump when it arrives. Keyed by record: a
             different record is a different document, not new content for this one. -->
        <div v-if="f.type === 'rich_text' && !folded(f)" class="rp-rich rp-under" :style="{ minHeight: richReserve + 'px' }">
          <RichTextEditor :key="recordId + f.id" :store="store" :record-id="recordId" :field-key="f.key" :value="record.data[f.key]"
                          @set="setRich" @unset="unsetRich" />
        </div>

        <!-- The value cell of a ROW; the editor UNDER a block's row (gone while folded). -->
        <div v-else-if="isRow(f) || !folded(f)" :ref="(el) => setValueEl(f.id, el)" class="rp-value" :class="{ readonly: READONLY(f), nested: f.type === 'backlink' && !!junctionOf(f), 'rp-under': !isRow(f) }"
             :tabindex="READONLY(f) ? -1 : 0"
             @click="startEdit(f)" @keydown.enter.prevent.stop="startEdit(f)" @copy="onCopy(f, $event)" @paste="onPaste(f, $event)">
          <!-- LINK -->
          <template v-if="f.type === 'link'">
            <!-- DRAG a pill onto a canvas to place that record there. One that is ALREADY on the
                 open canvas says so with a → and a click on that goes to its card
                 (client/canvasJump.ts). A double-click opens it. client/recordDrag.ts tells a
                 press from a drag by movement. -->
            <span class="pills column">
              <RecordPill v-for="to in linksFrom(f.id)" :key="to" :text="labelOfId(to)" :title="pillTitle(to)" :jump="onCanvas(to)" :warn="derived.pillWarning(recordId, f.id, to)"
                          :color="derived.pillColorOf(f)" removable drag @down="dragPill(to, $event)" @open="$emit('open', to)" @jump="canvasJump?.jump(to)" @remove="removeLink(f.id, to)" />
            </span>
            <!-- The way IN, always there — as a junction's field has it: "add another
                 Deliverable…" under the links (a field that is full of links used to
                 offer nothing to click but the links). Editing, the search line takes
                 this line's place and the pills above stay exactly where they are. -->
            <span v-if="editingId !== f.id" class="placeholder add-link">{{ addLinkText(f) }}</span>
            <LinkPicker v-if="editingId === f.id && targetOf(f)" field :store="store" :target-table-id="targetOf(f)!"
                        :linked="linksFrom(f.id)" :anchor="valueEls.get(f.id)" :link-field="f.id" :from-record="recordId"
                        @add="(to) => addLink(f.id, to)" @remove="(to) => removeLink(f.id, to)" @done="onDone" />
          </template>

          <!-- CHECKBOX: toggles in place, as in the grid. false is stored, not unset. -->
          <input v-else-if="f.type === 'checkbox'" type="checkbox" :checked="record.data[f.key] === true"
                 @click.stop @change="setValue(f.key, !(record.data[f.key] === true))" />

          <!-- BACKLINK: the other face of a link held on the far record — written here the
               same way as a link (client/links.ts `addLinkThrough`): × removes the row, the
               line under the pills adds one. -->
          <template v-else-if="f.type === 'backlink'">
            <span v-if="derived.backlinkOf(recordId, f) === null" class="broken">broken backlink</span>
            <!-- A JUNCTION's column (sql/016): the pairs as a NESTED TABLE (JunctionTable.vue) —
                 the other end, then the pair's own fields in columns, edited in place. The line
                 under it (or Enter on the box) adds a pair, through the junction popup. -->
            <template v-else-if="junctionOf(f)">
              <JunctionTable :store="store" :record-id="recordId" :field="f" :table="junctionOf(f)!.table" :cfg="junctionOf(f)!.cfg" :side="junctionOf(f)!.side"
                             @open="(id: string) => $emit('open', id)" @add="startEdit(f)" @drag="dragPill" />
              <JunctionEditor v-if="editingId === f.id" :store="store" :table="junctionOf(f)!.table" :cfg="junctionOf(f)!.cfg"
                              :side="junctionOf(f)!.side" :from="recordId" :anchor="valueEls.get(f.id)"
                              @done="onDone('none')" @open="(id: string) => { onDone('none'); $emit('open', id); }" />
            </template>
            <template v-else>
              <span class="pills column">
                <RecordPill v-for="from in derived.backlinkOf(recordId, f) ?? []" :key="from" back :text="labelOfId(from)" :color="derived.pillColorOf(f)" removable
                            :title="pillTitle(from)" :jump="onCanvas(from)" drag @down="dragPill(from, $event)" @open="$emit('open', from)" @jump="canvasJump?.jump(from)" @remove="removeLinkThrough(store, f, recordId, from)" />
              </span>
              <span v-if="editingId !== f.id" class="placeholder add-link">{{ addLinkText(f) }}</span>
              <LinkPicker v-if="editingId === f.id && targetOf(f)" field :store="store" :target-table-id="targetOf(f)!"
                          :linked="derived.backlinkOf(recordId, f) ?? []" :anchor="valueEls.get(f.id)"
                          @add="(o) => addLinkThrough(store, f, recordId, o)" @remove="(o) => removeLinkThrough(store, f, recordId, o)" @done="onDone" />
            </template>
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
              <span v-for="c in asList(record.data[f.key])" :key="c" class="choice many">{{ c }}</span>
            </span>
            <!-- A select's value wears the capsule here as in the grid (App.vue, .choice). -->
            <span v-else-if="f.type === 'select' && !isEmpty(record.data[f.key])" class="text choice">{{ display(record.data[f.key]) }}</span>
            <span v-else class="text" :class="{ pre: f.type === 'long_text' }">{{ f.type === 'created_at' ? formatCreated(record.data[f.key]) : formatNumberField(f, record.data[f.key]) ?? display(record.data[f.key]) }}</span>
            <span v-if="isEmpty(record.data[f.key])" class="placeholder">empty</span>
          </template>

          <!-- A ROW field's tools (⤴ show, "ffprobe…"), at the right end of its value cell. -->
          <span v-if="isRow(f)" class="rp-tools end">
            <button v-if="desktop && f.type === 'file_path' && typeof record.data[f.key] === 'string'" class="reveal" title="Show in folder"
                    @click.stop="reveal(String(record.data[f.key]))">⤴ show</button>
            <template v-if="manualHome === f.id && !jobs.get(recordId)">
              <button v-for="m in manual" :key="m.index" class="reveal run-step" :title="`Run ${m.name} on this record's file now`"
                      @click.stop="runManualStep(store, recordId, m.index)">▶ {{ m.name }}</button>
            </template>
            <span v-if="jobHere(f)" class="job">{{ jobs.get(recordId)!.label }}…</span>
          </span>
        </div>
      </div>
      </div>
      </template>
      <!-- EVERYTHING that points at this record, whether or not the table has a
           backlink field for it. A record's role — output of what, input to what —
           is the set of links pointing at it, so this is never hidden behind
           configuration. -->
      <div v-if="referencedBy.length" class="rp-refs">
        <h3>Referenced by</h3>
        <div v-for="g in referencedBy" :key="g.field.id" class="rp-ref">
          <span class="rp-ref-via">{{ g.tableName }} · {{ g.field.name }}</span>
          <span class="pills">
            <RecordPill v-for="from in g.from" :key="from" back :text="labelOfId(from)" :title="pillTitle(from)" :jump="onCanvas(from)"
                        :color="derived.pillColorOf(g.field)" drag @down="dragPill(from, $event)" @open="$emit('open', from)" @jump="canvasJump?.jump(from)" />
          </span>
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
import { computed, defineAsyncComponent, inject, nextTick, reactive, ref, watch } from 'vue';
import { CANVAS_JUMP } from '../canvasJump';
import type { Store } from '../store';
import { fieldsOf, primaryKeys, type FieldRow } from '../state';
import { labelFrom } from '../../contract/labels';
import { useDerived } from '../derived';
import { confirmDialog } from '../dialogs';
import CellEditor, { type EditExit } from './CellEditor.vue';
import { invoke, isDesktop, jobs, notice } from '../desktop';
import { manualHomeField, manualSteps, pathKeyOf, runManualStep } from '../tools/fileDrop';
import LinkPicker from './LinkPicker.vue';
import VerdictMark from './VerdictMark.vue';
import JunctionEditor from './JunctionEditor.vue';
import RecordPill from './RecordPill.vue';
import { duplicateRecords } from '../duplicate';
import { clipFromPaste, clipOf, copyCell, pasteCell, uncopyable } from '../cellClipboard';
import AttachmentField from './AttachmentField.vue';
import StructuredField from './StructuredField.vue';
import { addLink as addLinkVia, addLinkThrough, removeLinkThrough } from '../links';
import { leadsTo } from '../../contract/backlinks';
import { beginRecordDrag } from '../recordDrag';
import { compareOf, seedValues } from '../../contract/compare';
import { SYSTEM_FIELD_TYPES, formatCreated, isSystemKey } from '../../contract/systemFields';
import SideBySide from './SideBySide.vue';
import JunctionTable from './JunctionTable.vue';
import { fieldSectionsOf, groupFields } from '../../contract/fieldSections';
import { isFolded, setFolded } from '../sectionFolds';
import { isFieldFolded, setFieldFolded } from '../fieldFolds';
import { formatNumberField, shapeOf, summarise } from '../../contract/shapes';
import { richTextToPlain } from '../../contract/richtext';

// Loaded ON DEMAND. TipTap + ProseMirror are most of a megabyte of source, and
// nothing needs them until a record with a rich_text field is opened — so they
// stay out of the bundle the app starts with.
const RichTextEditor = defineAsyncComponent(() => import('./RichTextEditor.vue'));

const desktop = isDesktop();
const reveal = (path: string) => invoke<string>('reveal', { path })
  .then((r) => { if (r === 'folder') notice('The file is not there any more — its folder was opened.', 'info'); })
  .catch((e) => notice(String(e), 'error'));

const props = defineProps<{ store: Store; recordId: string; /** What is open behind the tray (App.vue): the key a field fold is remembered under. */ viewKey?: string }>();
const emit = defineEmits<{ close: []; open: [recordId: string]; 'open-board': [recordId: string]; 'open-report': [recordId: string]; 'open-calendar': [recordId: string] }>();
const store = props.store;
// Declared FIRST: an `immediate` watcher below calls into it during setup, and a
// `const` used before its declaration line is a runtime error typecheck cannot see.
const derived = useDerived(store);

const record = computed(() => store.state.records.get(props.recordId));
const table = computed(() => store.state.tables.get(record.value?.table_id ?? ''));
/** The recipe's manual steps on this table — offered beside the path, in the desktop app. */
const manual = computed(() => (desktop && table.value ? manualSteps(store, table.value.id) : []));
/** The field the ▶ buttons sit on: the Manifest the recipe maps (where a hash lands), else the first mapped hash field. */
const jobHere = (f: { id: string; type: string }) => {
  const j = jobs.get(props.recordId);
  return !!j && (j.manual ? manualHome.value === f.id : f.type === 'file_path');
};
const manualHome = computed(() => (manual.value.length && table.value && record.value && typeof record.value.data[pathKeyOf(store, table.value.id) ?? ''] === 'string' ? manualHomeField(store, table.value.id) : null));
const tableColor = computed(() => table.value?.color || 'var(--card-head-bg)');
const fields = computed(() => (record.value ? fieldsOf(store.state, record.value.table_id) : []));

/* ── comparison ── */
const comparisons = computed(() => derived.comparisonsOf(props.recordId).flatMap((c) => c.targets.map((target) => {
  const result = derived.compare(c.link.id, props.recordId, target);
  return { link: c.link, target, targetLabel: derived.labelOfId(target), result, diffs: result?.results.filter((r) => r.status === 'differ' || r.status === 'missing').length ?? 0 };
})));
// The target's table must be loaded for its values (and label) to be here.
watch(() => derived.comparisonsOf(props.recordId).map((c) => derived.compareTargetTable(c.link) ?? ''), (ids) => { for (const t of new Set(ids)) if (t) void store.loadTable(t); }, { immediate: true });
const verdicts = computed(() => derived.fieldVerdicts(props.recordId));
const sideBySide = ref<{ linkId: string; target: string } | null>(null);
watch(() => props.recordId, () => { sideBySide.value = null; });

/* ── sections ─────────────────────────────────────────────────────────────
   The fields as the tray draws them: groups, each a well. `open` is this person's
   own folding (client/sectionFolds.ts) over the schema's "starts folded". */
interface Group { key: string; head: boolean; name: string; startsFolded: boolean; open: boolean; fields: FieldRow[]; warn: number }
const groups = computed<Group[]>(() => {
  const all = fields.value;
  const sections = fieldSectionsOf(table.value);
  if (!sections.length) return [{ key: 'all', head: false, name: '', startsFolded: false, open: true, fields: all, warn: 0 }];
  const warnIn = (fs: FieldRow[]) => fs.filter((f) => { const v = verdicts.value.get(f.id); return !!v && !v.ok; }).length;
  const out: Group[] = [];
  for (const g of groupFields(all.filter((f) => !SYSTEM_FIELD_TYPES.has(f.type)), sections)) {
    if (!g.fields.length) continue;                      // an empty section is the editor's business, not the reader's
    if (!g.section) { out.push({ key: 'top', head: false, name: '', startsFolded: false, open: true, fields: g.fields, warn: 0 }); continue; }
    const startsFolded = g.section.folded === true;
    out.push({ key: g.section.id, head: true, name: g.section.name, startsFolded, open: !isFolded(g.section.id, startsFolded), fields: g.fields, warn: warnIn(g.fields) });
  }
  const system = all.filter((f) => SYSTEM_FIELD_TYPES.has(f.type));
  if (system.length) {
    const key = `created:${record.value?.table_id ?? ''}`;
    out.push({ key, head: true, name: 'Created', startsFolded: false, open: !isFolded(key, false), fields: system, warn: 0 });
  }
  return out;
});
/* ── rows and tabs ────────────────────────────────────────────────────────
   Which fields are ONE ROW (label cell | value cell) and which keep the tab on a
   box with their full height. By TYPE, not by what the value happens to hold: a
   row must stay a row when its text gets longer (it ellipsizes; the full value is
   there on edit), or the tray would reshape itself under the reader. */
const ROW_TYPES = new Set<string>(['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'link', 'backlink', 'file_path', 'dimensions', 'lookup', 'created_at', 'created_by']);
/** A junction's backlink is a nested table — a block, however short. */
const isRow = (f: FieldRow) => ROW_TYPES.has(f.type) && !(f.type === 'backlink' && !!junctionOf(f));

/** A block's one line: what the canvas card prints for it (CanvasView.cardRow). */
function summaryOf(f: FieldRow): string {
  const v = record.value?.data[f.key];
  if (f.type === 'structured') return summarise(shapeOf(f), v);
  if (f.type === 'rich_text') return richTextToPlain(v).split('\n', 1)[0];
  if (f.type === 'attachment') { const n = Array.isArray(v) ? v.length : 0; return n ? `${n} file${n === 1 ? '' : 's'}` : ''; }
  if (f.type === 'backlink') { const { texts, broken } = derived.textOf(props.recordId, f); return broken ? 'broken backlink' : texts.join(', '); }
  return isEmpty(v) ? '' : String(v).split('\n', 1)[0];
}
/** A block folded to its line — this person's, for the view behind the tray (client/fieldFolds.ts). */
const folded = (f: FieldRow) => isFieldFolded(props.viewKey ?? '', f.id);
function summaryClick(f: FieldRow) {
  if (folded(f)) setFieldFolded(props.viewKey ?? '', f.id, false); else startEdit(f);
}
function toggleFold(f: FieldRow) {
  const now = !folded(f);
  if (now && editingId.value === f.id) editingId.value = '';   // its editor is about to go
  setFieldFolded(props.viewKey ?? '', f.id, now);
}

/** The one label-cell width for every row on this record: the widest field name
    (plus its ★, verdict mark or fold chip), measured in the label's font — so the value
    column is straight down the tray, across sections, and no label is cut unless it
    is past the cap (then it ellipsizes with the full name in its title). Measured
    with a canvas; where there is none (tests), a per-character guess. */
const LABEL_FONT = '12px';
const measurer = (() => { let ctx: CanvasRenderingContext2D | null | undefined; return (text: string) => {
  if (ctx === undefined) { try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; } }
  if (!ctx) return text.length * 6.6;
  try { ctx.font = `${LABEL_FONT} ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`; return ctx.measureText(text).width; } catch { return text.length * 6.6; }
}; })();
const labelW = computed(() => {
  let w = 0;
  for (const f of fields.value) {
    const marks = (f.id === primaryId.value ? 14 : 0) + (verdicts.value.get(f.id) ? 21 : 0) + (isRow(f) ? 0 : 21);   // a block's fold chip
    
    w = Math.max(w, Math.ceil(measurer(f.name)) + marks);
  }
  return Math.min(180, Math.max(64, w + 17));   // 7px + 8px padding, 2px spare
});

/** The fields on screen, in the order they are on screen: what Enter and Tab walk. */
const shownFields = computed(() => groups.value.filter((g) => g.open).flatMap((g) => g.fields));
function toggleGroup(g: Group) {
  if (g.open && g.fields.some((f) => f.id === editingId.value)) editingId.value = '';   // its editor is about to go
  setFolded(g.key, g.open, g.startsFolded);
}

/** ⧉: the copy opens in this tray in the original's place. */
function duplicate() {
  const [id] = duplicateRecords(store, [props.recordId]);
  if (id) emit('open', id); else notice('Nothing to duplicate here', 'warn');
}
/** Ctrl+C / Ctrl+V on a focused field (cellClipboard.ts) — the browser's copy/paste events, while it is not being edited. */
/** A copy or paste INSIDE a structured editor's own input (a timecode, a track name) is that input's: the field's value box stays out of it. */
const inOwnEditor = (e: ClipboardEvent) => { const t = e.target as Element | null; return !!t && typeof t.matches === 'function' && t.matches('input, textarea, [contenteditable=""], [contenteditable="true"]'); };
function onCopy(f: FieldRow, e: ClipboardEvent) {
  if (editingId.value === f.id || inOwnEditor(e)) return;
  const lookupText = f.type === 'lookup' ? (lookupOf(f) ?? []).join(', ') : undefined;
  if (!copyCell(e, clipOf(store, props.recordId, f, labelOfId, lookupText))) notice(`${f.name} cannot be copied: ${uncopyable(store, f) ?? 'nothing there'}`, 'warn');
}
function onPaste(f: FieldRow, e: ClipboardEvent) {
  if (editingId.value === f.id || inOwnEditor(e)) return;
  const clip = clipFromPaste(e);
  if (!clip) return;
  e.preventDefault();
  const err = pasteCell(store, props.recordId, f, clip);
  if (err) notice(`Not pasted: ${err}`, 'warn');
}

/* A pill whose record has a card on the OPEN canvas wears a → that goes to it
   (client/canvasJump.ts, provided by the shell; absent — no arrow — anywhere else). */
const canvasJump = inject(CANVAS_JUMP, null);
const onCanvas = (id: string) => canvasJump?.placed(id) === true;
const pillTitle = (id: string) => (onCanvas(id) ? 'Double-click opens it · → goes to its card on this canvas' : 'Double-click opens it · drag onto a canvas to place it');

/** A pill: drag it onto a canvas. A still press does nothing — a double-click opens. */
function dragPill(recordId: string, e: PointerEvent) {
  const rec = store.state.records.get(recordId);
  if (!rec) return;
  beginRecordDrag(() => [rec], e, () => derived.labelOfId(recordId));
}

/** Copy the paired values from a target into this record's EMPTY fields — one batch, one Ctrl+Z. */
async function seedFrom(linkId: string, targetId: string) {
  const link = store.state.fields.get(linkId), owner = record.value, target = store.state.records.get(targetId);
  const pairs = link ? compareOf(link)?.pairs : undefined;
  if (!link || !pairs || !owner || !target) return;
  const plan = seedValues(pairs, store.state.fields, owner, target, derived.linksFrom);
  const n = Object.keys(plan.set).length + plan.links.length;
  if (!n) {
    if (plan.skipped.length && await confirmDialog({ title: 'Seed from', body: `Every paired field already has a value (${plan.skipped.join(', ')}). Overwrite them with ${derived.labelOfId(targetId)}'s?`, okText: 'Overwrite', danger: true })) {
      const all = seedValues(pairs, store.state.fields, owner, target, derived.linksFrom, true);
      applySeed(all.set, all.links, owner.id);
    }
    return;
  }
  applySeed(plan.set, plan.links, owner.id);
}
function applySeed(set: Record<string, unknown>, links: Array<{ fieldId: string; toRecords: string[] }>, ownerId: string) {
  if (Object.keys(set).length) store.mutate({ type: 'record.update', id: ownerId, set, unset: [] });
  for (const l of links) {
    for (const old of derived.linksFrom(ownerId, l.fieldId)) if (!l.toRecords.includes(old)) store.mutate({ type: 'link.remove', fieldId: l.fieldId, fromRecord: ownerId, toRecord: old });
    for (const to of l.toRecords) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: l.fieldId, fromRecord: ownerId, toRecord: to });
  }
}

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
/** The table a link OR backlink leads to (contract/backlinks.ts): what its picker lists, what its "add a …" line is named by. */
const targetOf = (f: FieldRow) => leadsTo(f, (id) => store.state.fields.get(id)) ?? undefined;
/**
 * "add a Deliverable…" / "add another Deliverable…" — named by what the field links
 * TO (the target table's singular name), as a junction's line is named by its pair.
 * A link ticked "single" holds one: adding replaces it (client/links.ts), so say so.
 */
function addLinkText(f: FieldRow): string {
  const t = store.state.tables.get(targetOf(f) ?? '');
  const noun = t?.singular_name || t?.name || 'link';
  const n = (f.type === 'backlink' ? derived.backlinkOf(props.recordId, f)?.length ?? 0 : linksFrom(f.id).length);
  if (!n) return `add ${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}…`;
  return f.options?.single === true ? `change the ${noun}…` : `add another ${noun}…`;
}
const referencedBy = computed(() => derived.referencedBy(props.recordId));
/** A backlink mirroring a junction's endpoint is WRITABLE (contract/junction.ts) — the one backlink that is. */
const junctionOf = (f: FieldRow) => derived.junctionOfBacklink(f);
const READONLY = (f: FieldRow) => f.type === 'lookup' || (f.type === 'backlink' && !junctionOf(f) && derived.backlinkOf(props.recordId, f) === null) || SYSTEM_FIELD_TYPES.has(f.type);

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
  if (!isRow(f) && folded(f)) setFieldFolded(props.viewKey ?? '', f.id, false);   // its editor lives under the row
  editingId.value = f.id;
}

/** Enter/Tab move to the next field you can type in; Shift+Tab to the previous. */
function onDone(exit: EditExit) {
  const from = editingId.value;
  editingId.value = '';
  const list = shownFields.value.filter((f) => EDITABLE(f) && (isRow(f) || !folded(f)));   // (a folded section's, or a folded block's, editor is not there to move to)
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

const addLink = (fieldId: string, toRecord: string) => addLinkVia(store, fieldId, props.recordId, toRecord);
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
    if (!r || Object.keys(r.data).some((k) => !isSystemKey(k))) return;   // (the folded-in system keys do not count as data)
    // Straight to its NAME — and if the name's section is folded here, nowhere: the next
    // field along is not where a new record's name should land.
    const named = fields.value.some((f) => f.id === primaryId.value);
    const first = shownFields.value.find((f) => f.id === primaryId.value) ?? (named ? undefined : shownFields.value.find(EDITABLE));
    if (first) startEdit(first);
  });
}, { immediate: true });
</script>

<style scoped>
.record-panel {
  /* A TRAY: a cell of App's stage grid, beside the view's BODY and under its bars
     (App.vue sets its width and the splitter beside it resizes it). It used to be
     `position: absolute` over the right edge, where it covered the grid's "+" column
     and made "fit" fit a viewport you could not fully see. */
  position: relative; min-width: 320px; max-width: 70vw; min-height: 0;
  display: flex; flex-direction: column; outline: none;
  background: var(--bg-app); font-size: 13px;
}
.rp-head {
  flex: none; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center;
  padding: 10px 12px; border-top: 3px solid; border-bottom: 1px solid var(--border-main); background: var(--bg-chrome);
}
.rp-table { grid-column: 1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.rp-title { grid-column: 1; margin: 0; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-title.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }
.rp-head { grid-template-columns: 1fr auto auto auto !important; }
.rp-open-board { grid-row: 1 / span 2; background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; font-size: 12px; }
.rp-dup { grid-row: 1 / span 2; justify-self: end; background: none; border: 1px solid var(--border-main); border-radius: 4px; color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 11px; padding: 1px 7px; }
.rp-dup:hover { color: var(--text-primary); border-color: var(--text-muted); }
.rp-close { grid-column: 4; grid-row: 1 / span 2; background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.rp-close:hover { color: var(--text-primary); }

.rp-body { flex: 1; overflow-y: auto; padding: 8px 10px; }
/* A WELL, as in the tree (NavTree.vue): recessed, an accent rule down the left. */
.rp-well { background: var(--bg-well); border-radius: 6px; border-left: 2px solid var(--accent); padding: 6px 10px 8px; }
.rp-compare { margin: 8px 10px 0; }
.rp-fields { }
/* A SECTION's fold row — the tree's row (NavTree.vue): a ▾, the name, and the well of
   what is inside directly under it. Folded, the row is all there is. */
.rp-sec {
  display: flex; align-items: center; gap: 4px; width: 100%; box-sizing: border-box; margin-top: 8px; padding: 3px 6px 3px 2px;
  background: none; border: none; border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600; text-align: left;
  color: var(--text-primary); user-select: none;
}
.rp-sec:hover { background: var(--bg-surface-hover); }
.rp-sec:focus-visible { outline: 1px solid var(--accent); }
.rp-sec .tw { width: 14px; flex: none; color: var(--text-faint); font-size: 10px; text-align: center; }
.rp-sec.folded { color: var(--text-secondary); }
.rp-sec-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-sec-count { color: var(--text-faint); font-weight: 400; font-size: 11px; margin-left: 4px; }
.rp-sec-warn { color: var(--warning); font-weight: 600; font-size: 11px; margin-left: 6px; white-space: nowrap; }
.rp-fields.sectioned { margin-top: 2px; }
.rp-cmp { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
.rp-cmp-verdict { width: 16px; flex: none; }
.rp-cmp-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-cmp-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 0 7px; cursor: pointer; font: inherit; font-size: 11px; white-space: nowrap; }
.rp-cmp-btn:hover { color: var(--accent); border-color: var(--accent); }
.cmp-badge { margin-left: 5px; }
.reveal { margin-left: 8px; font-size: 10px; background: none; border: 1px solid var(--border-main); color: var(--text-muted); border-radius: 3px; padding: 0 5px; cursor: pointer; }
.reveal:hover { color: var(--accent); border-color: var(--accent); }
.run-step { margin-left: 4px; }
.job { margin-left: 8px; font-size: 10px; color: var(--accent); }
/* min-height is set inline (richReserve): the editor's place, held while it loads. */
.rp-rich { display: flex; }
.star { color: var(--warning); margin-right: 3px; }
.rp-value { position: relative; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; cursor: text; outline: none; }
.rp-value.readonly { cursor: default; }
/* A junction's nested table fills its box edge to edge: its own cells carry the padding. */
.rp-value.nested { display: block; padding: 0; overflow: hidden; }
/* Links one per LINE in the tray: the vertical room is there, and a long deliverable
   name is readable only when it has the whole line. (The "referenced by" list below
   the fields stays a flow — short names, many of them.) */
.rp-value .pills.column { width: 100%; }
.rp-value .pills.column .pill { justify-content: flex-start; }
.rp-tools { display: inline-flex; align-items: center; }
.rp-tools:empty { display: none; }

/* ── ROWS ────────────────────────────────────────────────────────────────
   Every field is a row of a two-column table: the label cell, the same width for
   every row (`--label-w`, set on .rp-body), then the value cell; a hairline under
   each; no gap between rows, no box around a value. The label column is the
   LIGHTER one (the grid's header shade), the value column is the well — the two
   read apart at a glance. Editing is a wash on the value cell — nothing else:
   the line down a row's left edge means ONE thing, "this block is open" (below). */
.rp-field { display: grid; grid-template-columns: var(--label-w, 96px) minmax(0, 1fr); padding: 0; margin: 0; }
.rp-well.rp-fields { padding-left: 0; padding-right: 0; }
.rp-name {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 12px; line-height: 16px; color: var(--head-text);
  padding: 5px 8px 5px 10px; border-bottom: 1px solid var(--border-main);
  background: var(--bg-head);
}
.rp-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmp-badge { margin-left: 0; flex: none; }
.rp-value { min-height: 27px; padding: 3px 10px; gap: 4px 8px; border-bottom: 1px solid var(--border-main); }
.rp-value:focus { background: var(--bg-surface-hover); }
.rp-field.editing .rp-value:not(.rp-under) { background: var(--bg-surface-hover); }
.rp-field.readonly .rp-name { color: var(--text-muted); }
/* The well's last row carries no hairline into its bottom padding. */
.rp-well.rp-fields > .rp-field:last-child > .rp-name, .rp-well.rp-fields > .rp-field:last-child > .rp-value:last-child { border-bottom: 0; }
/* A LINK row: the pills one per line down the left; "add another…" at the right end of
   the last line — on one link, the same line as the pill. Several links: the pills
   stack, the label stays at the top of the cell. */
.rp-value .pills.column { flex: 1 1 auto; width: auto; min-width: 0; }
.rp-value .add-link { margin-left: auto; align-self: flex-end; font-size: 11px; }
.rp-value:has(.pills.column) { flex-wrap: nowrap; align-items: flex-end; }
.rp-field:has(.pill ~ .pill) > .rp-name { align-items: flex-start; }
.rp-tools.end { margin-left: auto; gap: 4px; }
.rp-tools.end .reveal, .rp-tools.end .job { margin-left: 0; }

/* ── BLOCKS ──────────────────────────────────────────────────────────────
   A field that needs room: folded, its row is label + one-line SUMMARY, with a
   fold chip at the label's left. OPEN, the label bar runs the full width (the
   summary cell takes the label shade and its text wipes out to the right), and the
   editor hangs under it in a BOX — the rich-text editor's box, for every kind of
   block: the controls shade, a hairline, rounded corners, a gap from the bar and
   from the well's edges, the text one step lighter than a row's. Down the open
   block's left runs a thin accent line with rounded ends, apart from the well's
   own rule — the tell for where the block ends and the next row begins. */
.fold-chip {
  flex: none; width: 16px; height: 16px; padding: 1px; box-sizing: border-box; margin-left: -4px;
  background: var(--card-head-bg); border: 0; border-radius: 3px; cursor: pointer; color: var(--text-secondary);
}
.fold-chip:hover { background: var(--border-main); color: var(--text-primary); }
.fold-chip:focus-visible { outline: 1px solid var(--accent); }
.fold-chip svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.rp-value.summary { cursor: pointer; flex-wrap: nowrap; overflow: hidden; transition: background-color 0.18s ease; }
.rp-value.summary .text, .rp-value.summary .placeholder { color: var(--text-primary); min-width: 0; transition: opacity 0.18s ease, transform 0.18s ease; }
.rp-value.summary .placeholder { color: var(--text-faint); }
.rp-field.block.open { position: relative; border-bottom: 1px solid var(--border-main); }
.rp-field.block.open::before {
  content: ''; position: absolute; left: 2px; top: 3px; bottom: 3px; width: 2px;
  border-radius: 1px; background: var(--accent); pointer-events: none;
}
.rp-well.rp-fields > .rp-field.block.open:last-child { border-bottom: 0; }
.rp-field.block.open > .rp-name { border-bottom-color: transparent; }
.rp-field.block.open > .rp-value.summary { background: var(--bg-head); border-bottom-color: transparent; cursor: default; }
.rp-field.block.open > .rp-value.summary .text, .rp-field.block.open > .rp-value.summary .placeholder { opacity: 0; transform: translateX(10px); }
@media (prefers-reduced-motion: reduce) { .rp-value.summary, .rp-value.summary .text, .rp-value.summary .placeholder { transition: none; } }
/* The box. It is the value cell itself, so what hangs under a row keeps its class
   (.rp-under) for the tests and the keyboard; the gap is its margin, and the rule
   under the block is the field's (above), not the cell's. */
.rp-value.rp-under {
  grid-column: 1 / -1; display: block; min-height: 0; cursor: text;
  margin: 6px 10px 10px; padding: 0; overflow: hidden;
  border: 1px solid var(--border-main); border-radius: 6px; background: var(--controls-bg);
  color: var(--text-secondary);
}
.rp-value.rp-under:focus { background: var(--controls-bg); }
.rp-under.readonly, .rp-under.nested { cursor: default; }
/* What is drawn straight into the box carries its own padding; a structured value
   (StructuredField) and a junction's table (JunctionTable) fill it edge to edge. */
.rp-under > .attach, .rp-under > .editor, .rp-under > .text.pre, .rp-under > .placeholder, .rp-under > .looked-up { display: block; padding: 8px 12px; box-sizing: border-box; }
.rp-under > .text.pre:empty { display: none; }
.rp-under > .jt-wrap { padding-bottom: 8px; }
/* Rich text IS its own box (RichTextEditor .rte): the cell around it stays plain. */
.rp-rich.rp-under { grid-column: 1 / -1; display: flex; margin: 0; padding: 6px 10px 10px; border: 0; border-radius: 0; background: none; overflow: visible; }
.rp-rich :deep(.rte) { flex: 1; border-radius: 6px; }
.text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text.pre { white-space: pre-wrap; overflow: visible; }
.placeholder { color: var(--text-faint); font-style: italic; }
.looked-up { color: var(--text-secondary); font-style: italic; }
.broken { color: var(--danger); font-size: 11px; }
.rp-refs { margin-top: 14px; padding: 0 2px; }
.rp-refs h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.rp-ref { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 3px 0; }
.rp-ref-via { color: var(--text-muted); font-size: 11px; margin-right: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.rp-value :deep(textarea.multi) { height: 160px; }

.rp-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-main); background: var(--bg-chrome); }
.rp-note { color: var(--text-muted); font-size: 11px; margin: 0; }
.mono { font-family: ui-monospace, monospace; }
.spacer { flex: 1; }
.rp-foot button { background: none; border: 1px solid var(--border-main); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
.danger { color: var(--danger); }
</style>
