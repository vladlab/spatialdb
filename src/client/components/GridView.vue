<!--
  The grid: one table, through one saved view.

  Everything here renders from the local store. Sorting and filtering are
  `applyView` from contract/views.ts, run over the WHOLE table — which is why the
  first thing this does is ask the store to walk the table to the end. Until that
  finishes, the sort is a sort of a prefix, so the toolbar says so.

  SELECT, THEN EDIT — Airtable's model, because arrow keys cannot both move
  between cells and move a caret inside one:

    click / arrows / Tab    move the SELECTION (a ring on the cell; no input exists)
    Enter, F2, double-click start EDITING the selected cell (mounts a CellEditor)
    typing a character      starts editing AND replaces the value with it
    Delete / Backspace      clears the selected cell
    Space                   ticks a checkbox (Enter does too — it has no edit mode);
                            on any other cell it OPENS the record in the side panel
    while editing           Enter commits + moves down · Tab commits + moves right
                            Shift+Tab left · Escape cancels · see CellEditor.vue

  Enter on the LAST row commits and stays put. It does not create a record:
  that was asked about and decided. "+ add record" does, and drops you straight
  into editing the new row's first cell.

  The selection is (record id, field id), not (row, column) — so it stays on the
  same DATA when a sort reorders rows, a peer inserts one above, or a column is
  hidden. If the record or field goes away, the selection goes with it.

  ROWS are selected separately from cells, by their NUMBER (the first column):
  click, Shift+click for a range, Ctrl+click to toggle, Ctrl+A for every row in
  the view. A selected row is something you can DRAG (client/recordDrag.ts) onto
  anything registered as a drop target — today only a canvas, and nothing shows a
  grid and a canvas at once since the docked grid was removed, so dragging has no
  visible destination until split panes exist. Row selection and the drag service
  are kept for that; they are tested and cost nothing meanwhile.

  Things that are deliberate rather than missing:

  - ROWS ARE WINDOWED. Only the rows in (and just around) the viewport are in the
    DOM; two spacer rows stand in for the rest. 50,000 rows of editors is ~half a
    million DOM nodes otherwise. The price is a FIXED ROW HEIGHT: cells clip
    rather than wrap, because the window maths is `index * ROW_H`. The expanded
    record view (step 4) is where long values get room.
  - A VIEW'S CONFIG IS SHARED AND SAVED ON EVERY CHANGE, like Airtable: there is
    no "unsaved filter" state. It travels as a `view.update`, so a colleague
    looking at the same view sees the filter change. A table with no views shows
    everything; the first sort/filter/hide creates a view to hold it.
  - A ROW YOU JUST CREATED IGNORES THE FILTER until you switch view or table.
    Otherwise "add record" under `status = done` creates a row that vanishes
    before you can type in it — it is blank, so it does not match.
  - The quick-search box is NOT part of the view. It is "find that file", not
    "this view shows QC failures", and it is not saved or shared.
-->
<template>
  <section ref="scrollerRoot" class="gridview">
    <div class="bar">
      <!-- VIEWS: one control that NAMES the view you are in and, opened, LISTS them
           all. It was a row of tabs that looked like any other buttons in this bar,
           so "which view am I in" and "what views exist" were both unanswered — the
           owner could make a view and then not find it. Not in the navigation tree:
           the tree is WHERE you are; a view is HOW you are looking at this table,
           and belongs to the table's own toolbar. -->
      <details ref="viewMenu" class="menu view-menu">
        <summary :title="`You are in the view “${viewName}”. Sort, filter and hidden fields below belong to it — and are saved to it, for everyone.`">
          <span class="view-label">view</span> <b class="view-name">{{ viewName }}</b>
        </summary>
        <div class="pop view-pop">
          <div v-for="v in views" :key="v.id" class="view-row" :class="{ on: v.id === active?.id }" @click="pickView(v.id)">
            <span class="view-tick">{{ v.id === active?.id ? '✓' : '' }}</span>
            <span class="view-title">{{ v.name }}</span>
            <span class="view-sum">{{ summarise(v.config) }}</span>
            <button class="view-act" title="Rename" @click.stop="renameView(v.id, v.name)">✎</button>
            <button class="view-act" title="Duplicate — a new view starting from this one" @click.stop="duplicateView(v.id, v.name)">⧉</button>
            <button class="view-act danger" title="Delete this view (records are not affected)" @click.stop="deleteView(v.id, v.name)">×</button>
          </div>
          <!-- A table with no saved view still HAS one, as far as anyone looking at it
               is concerned: the real row is created lazily, on the first sort, filter
               or hide. Shown as such, or a fresh table's list would be empty. -->
          <div v-if="!views.length" class="view-row on">
            <span class="view-tick">✓</span><span class="view-title">Grid</span>
            <span class="view-sum">the default — saved when you first sort, filter or hide</span>
          </div>
          <button class="add-line new-view" @click="newView">+ new view <span class="muted">— starts from this one</span></button>
          <p class="hint-line">A view is a saved way of looking at this table: its sort, filters and hidden fields. Views are shared, and every change is saved as you make it.</p>
        </div>
      </details>

      <details ref="sortMenu" class="menu">
        <summary :class="{ active: config.sort.length }">
          sort<template v-if="config.sort.length"> · {{ config.sort.length }}</template>
        </summary>
        <div class="pop">
          <div v-for="(s, i) in config.sort" :key="i" class="line">
            <select :value="s.fieldId" @change="patchSort(i, { fieldId: val($event) })">
              <option v-for="f in sortable" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <select :value="s.dir" @change="patchSort(i, { dir: val($event) as 'asc' | 'desc' })">
              <option value="asc">A → Z, 1 → 9</option>
              <option value="desc">Z → A, 9 → 1</option>
            </select>
            <button class="x" @click="save({ sort: config.sort.filter((_, j) => j !== i) })">×</button>
          </div>
          <button v-if="sortable.length" class="ghost" @click="addSort">+ sort by…</button>
          <p class="note">Empty cells always sort last.</p>
        </div>
      </details>

      <details class="menu">
        <summary :class="{ active: config.filters.length }">
          filter<template v-if="config.filters.length"> · {{ config.filters.length }}</template>
        </summary>
        <div class="pop">
          <div v-for="(f, i) in config.filters" :key="i" class="line">
            <select :value="f.fieldId" @change="changeFilterField(i, val($event))">
              <option v-for="fl in filterable" :key="fl.id" :value="fl.id">{{ fl.name }}</option>
            </select>
            <select :value="f.op" @change="patchFilter(i, { op: val($event) as FilterOp })">
              <option v-for="op in opsOf(f.fieldId)" :key="op" :value="op">{{ OP_LABEL[op] }}</option>
            </select>
            <template v-if="f.op !== 'empty' && f.op !== 'notEmpty'">
              <select v-if="choicesOf(f.fieldId).length" :value="String(f.value ?? '')"
                      @change="patchFilter(i, { value: val($event) })">
                <option value=""></option>
                <option v-for="c in choicesOf(f.fieldId)" :key="c" :value="c">{{ c }}</option>
              </select>
              <select v-else-if="typeOf(f.fieldId) === 'checkbox'" :value="String(f.value === true)"
                      @change="patchFilter(i, { value: val($event) === 'true' })">
                <option value="true">ticked</option>
                <option value="false">not ticked</option>
              </select>
              <input v-else :type="inputType(f.fieldId)" :value="f.value ?? ''"
                     placeholder="value…" @change="patchFilterValue(i, val($event))" />
            </template>
            <button class="x" @click="save({ filters: config.filters.filter((_, j) => j !== i) })">×</button>
          </div>
          <button v-if="filterable.length" class="ghost" @click="addFilter">+ filter…</button>
          <p class="note">All conditions must match.</p>
        </div>
      </details>

      <!-- GROUP: rows gathered under a header per value, each header with a count and
           its own "+". A record added under a header INHERITS that group — adding a
           file under "Ep 101" links it to Ep 101 (client/scope.ts, createRecord). -->
      <details class="menu group-menu">
        <summary :class="{ active: groupBy.length }">
          group<template v-if="groupBy.length"> · {{ groupBy.map((id) => fieldName(id)).join(' › ') }}</template>
        </summary>
        <div class="pop">
          <div v-for="(gid, gi) in groupBy" :key="gid" class="line">
            <span class="muted">{{ gi === 0 ? 'by' : 'then by' }}</span>
            <select :value="gid" @change="setGroup(gi, ($event.target as HTMLSelectElement).value)">
              <option v-for="f in groupable" :key="f.id" :value="f.id" :disabled="groupBy.includes(f.id) && f.id !== gid">{{ f.name }}</option>
            </select>
            <button class="x" title="Remove this level" @click="setGroup(gi, '')">×</button>
          </div>
          <!-- Choosing a level does NOT group by anything until you pick the field. It
               used to grab the first free one — usually Name — and for a moment the grid
               was one group per record. -->
          <div v-if="addingGroup" class="line">
            <span class="muted">{{ groupBy.length ? 'then by' : 'by' }}</span>
            <select class="pending-group" value="" @change="chooseGroup(($event.target as HTMLSelectElement).value)">
              <option value="" disabled>choose a field…</option>
              <option v-for="f in groupable" :key="f.id" :value="f.id" :disabled="groupBy.includes(f.id)">{{ f.name }}</option>
            </select>
            <button class="x" title="Never mind" @click="addingGroup = false">×</button>
          </div>
          <button v-else-if="groupBy.length < 2 && groupable.length > groupBy.length" class="add-line add-group" @click="addingGroup = true">+ {{ groupBy.length ? 'then group by…' : 'group by…' }}</button>
          <p v-if="groupBy.length" class="hint-line">Each group has its own “+”: a record added there gets that group's value. Rows keep the view's sort inside each group.</p>
        </div>
      </details>

      <details class="menu">
        <summary :class="{ active: hiddenCount }">
          fields<template v-if="hiddenCount"> · {{ hiddenCount }} hidden</template>
        </summary>
        <div class="pop">
          <label v-for="f in allFields" :key="f.id" class="line check">
            <input type="checkbox" :checked="!config.hidden.includes(f.id)"
                   @change="toggleHidden(f.id)" />
            {{ f.name }}
          </label>
        </div>
      </details>

      <input v-model="search" class="search" type="search" placeholder="search…" />

      <!-- WHY the grid shows what it shows under the current scope: "in Duke", or —
           for a table with no membership link — that it is NOT scoped and is shown
           whole. Never silent: three layers of narrowing can hide a record. -->
      <span v-if="scopeInfo.note" class="scope-note" :class="{ unscoped: !scopeInfo.scoped }" :title="scopeInfo.note">{{ scopeInfo.scoped ? scopeInfo.note : 'not scoped' }}</span>

      <span class="spacer" />
      <span class="count" :class="{ warn: load?.state !== 'loaded' }">
        <template v-if="load?.state === 'loading'">
          loading… {{ fmtN(load.rows) }} rows — sort and filter are partial until this finishes
        </template>
        <template v-else-if="load?.state === 'failed'">load failed — see errors below</template>
        <template v-else>
          {{ fmtN(matched.length) }}<template v-if="matched.length !== total"> of {{ fmtN(total) }}</template>
          {{ total === 1 ? 'record' : 'records' }}
        </template>
      </span>
    </div>

    <div ref="scroller" class="scroller" tabindex="0" @scroll.passive="onScroll" @keydown="onGridKey">
      <table class="grid">
        <thead>
          <tr>
            <th class="num">#</th>
            <th v-for="f in shown" :key="f.id" :ref="(el) => setHeaderEl(f.id, el)"
                :title="'Click to sort · shift-click to add a sort'"
                class="sortable" @click="headerSort(f, $event)">
              <span v-if="schema.isPrimary(f.id)" class="star" title="Primary field: records in this table are named by it">★</span>
              <span class="th-name">{{ f.name }}</span>
              <span v-if="sortMark(f.id)" class="mark">{{ sortMark(f.id) }}</span>
              <button class="th-menu" title="Field settings" @click.stop="menuFor = menuFor === f.id ? '' : f.id">⚙</button>
              <!-- The SAME controls as the schema tab's rows — see schemaActions.ts. -->
              <Popover v-if="menuFor === f.id" :anchor="headerEls.get(f.id)" @close="menuFor = ''">
                <FieldSettings layout="stack" :store="store" :actions="schema" :field="f"
                               :index="allFields.findIndex((x) => x.id === f.id)" :count="allFields.length"
                               @deleted="menuFor = ''" />
                <button class="ghost hide" @click="toggleHidden(f.id); menuFor = ''">hide in this view</button>
              </Popover>
            </th>
            <th class="add-field" :ref="(el) => setHeaderEl('+', el)" title="Add a field">
              <button class="th-add" @click.stop="menuFor = menuFor === '+' ? '' : '+'">+</button>
              <Popover v-if="menuFor === '+'" :anchor="headerEls.get('+')" align="right" @close="menuFor = ''">
                <FieldForm layout="stack" autofocus :store="store" :actions="schema" :table-id="tableId" />
              </Popover>
            </th>
            <th class="act" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="padTop" aria-hidden="true"><td :colspan="shown.length + 3" :style="{ height: padTop + 'px', padding: 0, border: 0 }" /></tr>
          <template v-for="it in windowed" :key="it.kind === 'group' ? 'g' + it.path : it.record.id">
          <!-- A GROUP HEADER. Same height as a row — the window maths is `index × ROW_H`
               and a taller header would put every row below it in the wrong place. -->
          <tr v-if="it.kind === 'group'" class="group-row" :class="`level-${it.level}`" :data-path="it.path">
            <td :colspan="shown.length + 3">
              <div class="group-head" :style="{ paddingLeft: 8 + it.level * 18 + 'px' }">
                <button class="group-fold" :title="collapsed.has(it.path) ? 'Expand' : 'Collapse'" @click="toggleGroup(it.path)">{{ collapsed.has(it.path) ? '▸' : '▾' }}</button>
                <span class="group-field">{{ fieldName(it.fieldId) }}</span>
                <span class="group-label" :class="{ empty: it.value.kind === 'empty' }">{{ it.label }}</span>
                <span class="group-count">{{ fmtN(it.count) }}</span>
                <button class="group-add" :title="addTitle(it)" @click="createIn(it)">+</button>
              </div>
            </td>
          </tr>
          <!-- `v-for … in [it.record]` is only a way to NAME the record `r` for the row's
               (long) body below; it always renders exactly one row. -->
          <template v-else>
          <tr v-for="r in [it.record]" :key="r.id" class="row"
              :class="{ pending: store.unconfirmed.value.has(r.id), fresh: fresh.has(r.id), rowsel: rowSel.has(r.id) }">
            <!-- The row's HANDLE: click to select the row, drag to carry the selection
                 somewhere (a canvas). The ⤢ keeps to the right edge so it never sits
                 under a press meant for the handle. -->
            <td class="num" title="Click to select this row"
                @pointerdown="onRowHandleDown(r.id, rowIndex.get(r.id) ?? 0, $event)">
              <span class="n">{{ (rowIndex.get(r.id) ?? 0) + 1 }}</span>
              <button class="expand" tabindex="-1" title="Open record (Space)" @pointerdown.stop @mousedown.prevent @click="$emit('open-record', r.id)">⤢</button>
            </td>
            <td v-for="f in shown" :key="f.id"
                :class="{ sel: isSel(r.id, f.id), editing: isSel(r.id, f.id) && editing }"
                @mousedown="onCellDown(r.id, f, $event)" @dblclick="startEdit(r.id, f)">
              <div class="cell">
                <!-- LINK: rows in `links`, so edited here rather than in CellEditor. -->
                <template v-if="f.type === 'link'">
                  <span v-for="to in linksFrom(r.id, f.id)" :key="to" class="chip">
                    {{ labelFor(to) }}
                    <!-- FOLLOW the link: opens the linked record in the tray. Appears on
                         hover; it stops the press so the cell is not also selected/edited. -->
                    <button class="chip-open" tabindex="-1" :title="`Open ${labelFor(to)}`"
                            @mousedown.stop.prevent @click.stop="$emit('open-record', to)">⤢</button>
                    <button class="chip-x" tabindex="-1" title="Remove this link"
                            @mousedown.stop.prevent @click.stop="removeLink(f.id, r.id, to)">×</button>
                  </span>
                  <!-- Mounted for the ONE cell being edited; see LinkPicker.vue. -->
                  <LinkPicker v-if="isSel(r.id, f.id) && editing && targetOf(f)"
                              :store="store" :target-table-id="targetOf(f)!" :linked="linksFrom(r.id, f.id)"
                              :anchor="anchorEl" :seed="seed"
                              @add="(to) => addLink(f, r.id, to)" @remove="(to) => removeLink(f.id, r.id, to)"
                              @done="stopEdit" />
                </template>

                <!-- CHECKBOX: no edit mode. A real box, so a click on it toggles; a
                     click beside it only selects. tabindex -1: focus stays on the
                     grid, or the arrow keys stop working after every tick. -->
                <input v-else-if="f.type === 'checkbox'" type="checkbox" tabindex="-1"
                       :checked="r.data[f.key] === true"
                       @mousedown.stop="select(r.id, f.id)" @change="onBoxClick(r.id, f)" />

                <!-- Everything else: the VALUE is always rendered, and the editor is
                     laid over it. The value keeps holding the column's width while
                     hidden — this is an auto-layout table, and an <input> has a
                     built-in preferred width (about 20 characters) that is wider
                     than most values, so swapping one for the other made the whole
                     column jump wider on Enter and snap back on commit. -->
                <template v-else>
                  <span class="shown" :class="{ under: isSel(r.id, f.id) && editing }">
                    <template v-if="f.type === 'multi_select'">
                      <span v-for="c in asList(r.data[f.key])" :key="c" class="chip plain">{{ c }}</span>
                    </template>
                    <!-- RICH TEXT / ATTACHMENT: a summary. Neither fits a 30px row, so
                         Enter (or a double-click) opens the record panel instead. -->
                    <span v-else-if="f.type === 'rich_text'" class="value note" title="Enter opens the record to read or edit this">{{ notePreview(r.data[f.key]) }}</span>
                    <span v-else-if="f.type === 'structured'" class="value note" title="Enter opens the record to view or edit this">{{ summariseValue(shapeOf(f), r.data[f.key]) }}</span>
                    <span v-else-if="f.type === 'attachment'" class="value note" title="Enter opens the record">{{ attachSummary(r.data[f.key]) }}</span>
                    <!-- BACKLINK: the other end of a link made elsewhere. Read-only here —
                         the link belongs to the record that holds it. -->
                    <template v-else-if="f.type === 'backlink'">
                      <span v-if="derived.backlinkOf(r.id, f) === null" class="broken" title="This backlink is broken: the link field it mirrored was deleted.">broken backlink</span>
                      <span v-for="from in derived.backlinkOf(r.id, f) ?? []" v-else :key="from" class="chip plain back" title="Linked from that record — edit the link there">{{ labelFor(from) }}<button class="chip-open" tabindex="-1" :title="`Open ${labelFor(from)}`" @mousedown.stop.prevent @click.stop="$emit('open-record', from)">⤢</button></span>
                    </template>
                    <!-- LOOKUP: computed, read-only. Broken (its link field or far field
                         was deleted) is shown as such, not as an empty cell. -->
                    <template v-else-if="f.type === 'lookup'">
                      <span v-if="lookupOf(r.id, f) === null" class="broken" title="This lookup is broken: the link field it follows, or the field it shows, was deleted. Undo that delete, or delete this field.">broken lookup</span>
                      <span v-else class="value looked-up" title="Looked up — edit it on the linked record">{{ lookupOf(r.id, f)!.join(', ') }}</span>
                    </template>
                    <span v-else class="value" :class="{ num: f.type === 'number' }">{{ formatNumberField(f, r.data[f.key]) ?? display(r.data[f.key]) }}</span>
                  </span>
                  <CellEditor v-if="isSel(r.id, f.id) && editing" class="over" :field="f" :value="r.data[f.key]" :seed="seed"
                              @set="(k, v) => setValue(r.id, k, v)" @unset="(k) => unsetValue(r.id, k)"
                              @done="stopEdit" @cancel="stopEdit('none')" />
                </template>
              </div>
            </td>
            <td class="add-field" />
            <td class="act">
              <!-- In a table of BOARDS every row is a canvas: this goes to it. -->
              <button v-if="isBoards" class="open-board" title="Open this board" @click="$emit('open-board', r.id)">▦ open</button>
              <button class="x" :title="isBoards ? 'Delete this board and everything placed on it (undoable)' : 'Delete record (undoable)'" @click="remove(r.id)">×</button>
            </td>
          </tr>
          </template>
          </template>
          <tr v-if="padBottom" aria-hidden="true"><td :colspan="shown.length + 3" :style="{ height: padBottom + 'px', padding: 0, border: 0 }" /></tr>
        </tbody>
      </table>
      <p v-if="!allFields.length" class="hint">This table has no fields yet — press + in the header to add one.</p>
      <p v-else-if="!matched.length && load?.state === 'loaded'" class="hint">
        <template v-if="total">No records match this view.</template>
        <template v-else-if="scopeInfo.scoped && everything.length">Nothing {{ scopeInfo.note }} — {{ everything.length.toLocaleString() }} across all of them. Widen the scope in the breadcrumb.</template>
        <template v-else>No records yet.</template>
      </p>
    </div>

    <div class="foot">
      <button class="ghost" :disabled="!allFields.length" @click="create()">+ add record</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { SCOPE } from '../scope';
import type { Store } from '../store';
import { fieldsOf, recordsOf, viewsOf, type FieldRow } from '../state';
import {
  applyView, quickSearch, opsFor, ViewConfig, EMPTY_VIEW, type FilterOp,
} from '../../contract/views';
import CellEditor from './CellEditor.vue';
import LinkPicker from './LinkPicker.vue';
import Popover from './Popover.vue';
import FieldForm from './FieldForm.vue';
import FieldSettings from './FieldSettings.vue';
import { useSchemaActions } from '../schemaActions';
import { useDerived } from '../derived';
import { ancestorsOf, groupRows, type GroupHeader } from '../../contract/views';
import { ask, confirmDialog } from '../dialogs';
import { richTextToPlain } from '../../contract/richtext';
import { formatNumberField, shapeOf, summarise as summariseValue } from '../../contract/shapes';   // (`summarise` here is the VIEW's summary)
import { beginRecordDrag } from '../recordDrag';

const props = defineProps<{
  store: Store; tableId: string;
}>();
const emit = defineEmits<{ 'open-record': [recordId: string]; 'open-board': [recordId: string] }>();
const store = props.store;

/* ── schema, in place ─────────────────────────────────────────────────────

   Column headers carry a ⚙ menu (FieldSettings) and the header row ends in a "+"
   (FieldForm). Both are the components the schema tab is made of, over the same
   schemaActions — this file adds no schema logic of its own. */
const schema = useSchemaActions(store);
/** Which header popover is open: a field id, '+', or ''. */
const menuFor = ref('');
const headerEls = reactive(new Map<string, HTMLElement>());
function setHeaderEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) headerEls.set(id, el); else headerEls.delete(id);
}

const OP_LABEL: Record<FilterOp, string> = {
  contains: 'contains', eq: 'is', neq: 'is not',
  gt: '>', gte: '≥', lt: '<', lte: '≤',
  has: 'has', empty: 'is empty', notEmpty: 'is not empty',
};

const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;
const fmtN = (n: number) => n.toLocaleString();

/* ── table, fields, views ─────────────────────────────────────────────────*/

const allFields = computed(() => fieldsOf(store.state, props.tableId));
const isBoards = computed(() => store.state.tables.get(props.tableId)?.kind === 'canvas');
const fieldById = computed(() => new Map(allFields.value.map((f) => [f.id, f])));
const views = computed(() => viewsOf(store.state, props.tableId));
const load = computed(() => store.tableLoads.get(props.tableId));

const activeId = ref('');
/** The active view, or none — a peer may delete the one you are looking at. */
const active = computed(() =>
  views.value.find((v) => v.id === activeId.value) ?? views.value[0]);

/**
 * Parsed, not cast. A config written before this contract existed (or by SQL)
 * may not match it; falling back to "show everything" is better than a grid
 * that throws on render. New writes cannot be malformed — the server checks.
 */
const config = computed<ViewConfig>(() => {
  const parsed = ViewConfig.safeParse(active.value?.config ?? {});
  return parsed.success ? parsed.data : EMPTY_VIEW;
});

const viewName = computed(() => active.value?.name ?? 'Grid');
const viewMenu = ref<HTMLDetailsElement>();
function pickView(id: string) { activeId.value = id; if (viewMenu.value) viewMenu.value.open = false; }
/** "2 filters · sorted · 3 hidden" — enough to tell two views apart in the list. */
function summarise(raw: unknown): string {
  const p = ViewConfig.safeParse(raw ?? {});
  if (!p.success) return '';
  const c = p.data, bits: string[] = [];
  if (c.filters.length) bits.push(`${c.filters.length} filter${c.filters.length === 1 ? '' : 's'}`);
  if (c.sort.length) bits.push('sorted');
  if (c.groupBy?.length) bits.push('grouped');
  if (c.hidden.length) bits.push(`${c.hidden.length} hidden`);
  return bits.join(' · ') || 'everything, unsorted';
}

const shown = computed(() => allFields.value.filter((f) => !config.value.hidden.includes(f.id)));
const hiddenCount = computed(() => allFields.value.length - shown.value.length);
const sortable = computed(() => allFields.value);
const filterable = computed(() => allFields.value.filter((f) => opsFor(f.type).length));

/** Write the config. Creates the view if this table has none yet. */
function save(patch: Partial<ViewConfig>) {
  const next = { ...config.value, ...patch };
  if (active.value) {
    store.mutate({ type: 'view.update', id: active.value.id, config: next });
  } else {
    const id = crypto.randomUUID();
    store.mutate({ type: 'view.create', id, tableId: props.tableId, name: 'Grid', config: next });
    activeId.value = id;
  }
}

async function newView() {
  const name = await ask({ title: 'New view', label: 'Name', initial: `View ${views.value.length + 1}` });
  if (!name) return;
  const id = crypto.randomUUID();
  // Starts from the current config: "this, but also filtered by X" is the
  // usual reason to want a second view. (Both mutations AFTER the await, so
  // they are one undo step — see client/dialogs.ts.)
  store.mutate({ type: 'view.create', id, tableId: props.tableId, name, config: { ...config.value } });
  store.mutate({ type: 'view.update', id, position: views.value.length });
  activeId.value = id;
  if (viewMenu.value) viewMenu.value.open = false;
}
async function renameView(id: string, current: string) {
  const name = await ask({ title: 'Rename view', label: 'Name', initial: current, okText: 'Rename' });
  if (name && name !== current) store.mutate({ type: 'view.update', id, name });
}
async function duplicateView(id: string, name: string) {
  const src = views.value.find((v) => v.id === id);
  const copy = await ask({ title: 'Duplicate view', label: 'Name', initial: `${name} copy`, okText: 'Duplicate' });
  if (!src || !copy) return;
  const parsed = ViewConfig.safeParse(src.config ?? {});
  const newId = crypto.randomUUID();
  store.mutate({ type: 'view.create', id: newId, tableId: props.tableId, name: copy, config: parsed.success ? parsed.data : { ...EMPTY_VIEW } });
  store.mutate({ type: 'view.update', id: newId, position: views.value.length });
  activeId.value = newId;
}
async function deleteView(id: string, name: string) {
  if (await confirmDialog({ title: `Delete the view “${name}”?`, body: 'Records are not affected, and it can be restored from History.', danger: true, okText: 'Delete view' })) {
    store.mutate({ type: 'view.delete', id });
  }
}

/* ── sort ─────────────────────────────────────────────────────────────────*/

function addSort() {
  const used = new Set(config.value.sort.map((s) => s.fieldId));
  const f = sortable.value.find((x) => !used.has(x.id)) ?? sortable.value[0];
  save({ sort: [...config.value.sort, { fieldId: f.id, dir: 'asc' }] });
}
function patchSort(i: number, p: Partial<ViewConfig['sort'][number]>) {
  save({ sort: config.value.sort.map((s, j) => (j === i ? { ...s, ...p } : s)) });
}
/** Header click: none → asc → desc → none. Shift keeps the other sorts. */
function headerSort(f: FieldRow, e: MouseEvent) {
  const cur = config.value.sort.find((s) => s.fieldId === f.id);
  const rest = e.shiftKey ? config.value.sort.filter((s) => s.fieldId !== f.id) : [];
  const next = !cur ? [{ fieldId: f.id, dir: 'asc' as const }]
    : cur.dir === 'asc' ? [{ fieldId: f.id, dir: 'desc' as const }] : [];
  save({ sort: [...rest, ...next] });
}
function sortMark(fieldId: string) {
  const i = config.value.sort.findIndex((s) => s.fieldId === fieldId);
  if (i === -1) return '';
  return (config.value.sort[i].dir === 'asc' ? '▲' : '▼') + (config.value.sort.length > 1 ? i + 1 : '');
}

/* ── filter ───────────────────────────────────────────────────────────────*/

const typeOf = (fieldId: string) => fieldById.value.get(fieldId)?.type ?? 'text';
const opsOf = (fieldId: string) => opsFor(typeOf(fieldId));
function choicesOf(fieldId: string): string[] {
  const f = fieldById.value.get(fieldId);
  if (!f || (f.type !== 'select' && f.type !== 'multi_select')) return [];
  const c = f.options?.choices;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === 'string') : [];
}
const inputType = (fieldId: string) =>
  ({ number: 'number', date: 'date' } as Record<string, string>)[typeOf(fieldId)] ?? 'text';

function addFilter() {
  const f = filterable.value[0];
  save({ filters: [...config.value.filters, { fieldId: f.id, op: opsFor(f.type)[0] }] });
}
function patchFilter(i: number, p: Partial<ViewConfig['filters'][number]>) {
  save({ filters: config.value.filters.map((f, j) => (j === i ? { ...f, ...p } : f)) });
}
/** A new field may not support the old op, and the old value is for the old type. */
function changeFilterField(i: number, fieldId: string) {
  save({ filters: config.value.filters.map((f, j) =>
    (j === i ? { fieldId, op: opsOf(fieldId)[0] } : f)) });
}
/** The filter value keeps the field's type, so `> 100` compares numbers. */
function patchFilterValue(i: number, raw: string) {
  const f = config.value.filters[i];
  if (raw === '') {
    // Clearing the box removes the value rather than storing '' — a filter with
    // no value is inert (see `matches`), which is what an empty box should mean.
    const { fieldId, op } = f;
    return save({ filters: config.value.filters.map((x, j) => (j === i ? { fieldId, op } : x)) });
  }
  if (typeOf(f.fieldId) === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    return patchFilter(i, { value: n });
  }
  patchFilter(i, { value: raw });
}
function toggleHidden(fieldId: string) {
  const h = config.value.hidden;
  save({ hidden: h.includes(fieldId) ? h.filter((x) => x !== fieldId) : [...h, fieldId] });
}

/* ── links, lookups, backlinks ────────────────────────────────────────────
   All from client/derived.ts — one link index and one label rule for the grid,
   the canvas and the record panel. */

const derived = useDerived(store);
const linksFrom = derived.linksFrom;
const labelFor = derived.labelOfId;
const lookupOf = derived.lookupOf;

/** What applyView/quickSearch see for fields with nothing in record.data. */
function linkLabels(recordId: string, fieldId: string): string[] {
  const f = fieldById.value.get(fieldId);
  return f ? derived.textOf(recordId, f).texts : [];
}

// Lookups and backlinks read records of OTHER tables, which therefore have to
// be walked too — otherwise the column is blank until something else happens to
// load them. `loadTable` is a no-op for a table already loaded or loading.
watch(() => derived.tablesNeededBy(allFields.value).join(), (joined) => {
  for (const t of joined.split(',').filter(Boolean)) void store.loadTable(t);
}, { immediate: true });

const targetOf = (f: FieldRow) => f.options?.target_table_id as string | undefined;
function addLink(f: FieldRow, fromRecord: string, toRecord: string) {
  if (!toRecord) return;
  store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: f.id, fromRecord, toRecord });
}
function removeLink(fieldId: string, fromRecord: string, toRecord: string) {
  store.mutate({ type: 'link.remove', fieldId, fromRecord, toRecord });
}

/* ── rows ─────────────────────────────────────────────────────────────────*/

const search = ref('');
/** Rows created here since the last view/table switch; exempt from the filter. */
const fresh = reactive(new Set<string>());

/* ── scope ────────────────────────────────────────────────────────────────
   client/scope.ts, injected. The scope filter sits UNDER the view's own filter:
   views stay scope-free, so one "QC failures" view works in every project. */
const scopeApi = inject(SCOPE, null);
const scopeFilter = computed(() => scopeApi?.filterFor(props.tableId) ?? null);
const scopeInfo = computed(() => scopeApi?.describe(props.tableId) ?? { scoped: false, note: '' });

const everything = computed(() => recordsOf(store.state, props.tableId));
const all = computed(() => {
  const f = scopeFilter.value;
  // Rows made here a moment ago stay visible even if a peer-less race means their
  // membership link has not landed in the index yet (same tick in practice).
  return f ? everything.value.filter((r) => f(r) || fresh.has(r.id)) : everything.value;
});
const total = computed(() => all.value.length);

/** Every record the view, the search and the scope let through — before grouping. */
const matched = computed(() => {
  let viewed = applyView(all.value, allFields.value, config.value, linkLabels);
  // Just-created rows are exempt from the view's FILTER (a blank row matches
  // nothing, and would vanish before you could type in it)…
  if (fresh.size) {
    const have = new Set(viewed.map((r) => r.id));
    const pinned = all.value.filter((r) => fresh.has(r.id) && !have.has(r.id));
    if (pinned.length) viewed = [...viewed, ...pinned];
  }
  // …but NOT from the search box. Search is an explicit "find this"; a row that
  // does not match has no business in the results just because it is new. This
  // ordering was wrong at first and hidden by another bug: the first header click
  // used to clear `fresh` by accident.
  const found = quickSearch(viewed, shown.value, search.value, linkLabels);
  return found;
});

/* CellEditor has already validated against contract/values.ts by the time
   these fire, so they only translate the event into a mutation. */
function setValue(id: string, key: string, value: unknown) {
  store.mutate({ type: 'record.update', id, set: { [key]: value }, unset: [] });
}
function unsetValue(id: string, key: string) {
  store.mutate({ type: 'record.update', id, set: {}, unset: [key] });
}
function remove(id: string) { store.mutate({ type: 'record.delete', id }); }

async function create(context: { data?: Record<string, unknown>; links?: Array<{ fieldId: string; toRecord: string }> } = {}) {
  const id = crypto.randomUUID();
  fresh.add(id);
  // Through client/scope.ts: the new row inherits its CONTEXT — the scoped project,
  // and the group it was added under — in the same step (one Ctrl+Z).
  if (scopeApi) scopeApi.createRecord(props.tableId, {}, id, context);
  else {
    store.mutate({ type: 'record.create', id, tableId: props.tableId, data: { ...context.data } });
    for (const l of context.links ?? []) store.mutate({ type: 'link.add', id: crypto.randomUUID(), fieldId: l.fieldId, fromRecord: id, toRecord: l.toRecord });
  }
  await nextTick();
  // Wherever the sort put it (blank rows sort last; pinned rows are appended),
  // go there and start typing — adding a row is almost always followed by
  // filling it in.
  const i = rows.value.findIndex((r) => r.id === id);
  const firstField = shown.value.find((f) => TYPEABLE.has(f.type) && f.type !== 'link') ?? shown.value[0];
  if (i === -1 || !firstField) return;
  reveal(i);
  await nextTick();
  startEdit(id, firstField);
}

/* ── grouping ──────────────────────────────────────────────────────────────
   contract/views.ts does the grouping (`groupRows`); this draws it. `items` is what
   the window renders — headers and rows interleaved, all the same height. `rows` is
   the RECORDS in the order they appear, which is what the keyboard, row selection
   and drag-out walk through: headers are simply not in it, so arrow keys step over
   them, and collapsed groups' rows are not reachable until expanded. */
const groupBy = computed(() => (config.value.groupBy ?? []).filter((id) => allFields.value.some((f) => f.id === id)));
const NOT_GROUPABLE = new Set(['long_text', 'attachment', 'structured']);
const groupable = computed(() => allFields.value.filter((f) => !NOT_GROUPABLE.has(f.type)));
const fieldName = (id: string) => store.state.fields.get(id)?.name ?? '?';
/** Which groups are folded: this browser, this visit. Not part of the shared view. */
const collapsed = reactive(new Set<string>());
const toggleGroup = (path: string) => { if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path); };

const items = computed(() => groupRows(matched.value, allFields.value, groupBy.value, linkLabels,
  (recId, fieldId) => derived.linksFrom(recId, fieldId), collapsed));
const rows = computed(() => items.value.flatMap((it) => (it.kind === 'row' ? [it.record] : [])));
const rowIndex = computed(() => new Map(rows.value.map((r, i) => [r.id, i])));
/** Where record `ri` is in `items` — what `reveal` scrolls to. */
const itemIndexOfRow = computed(() => { const m: number[] = []; items.value.forEach((it, i) => { if (it.kind === 'row') m.push(i); }); return m; });

const addingGroup = ref(false);
function chooseGroup(fieldId: string) {
  addingGroup.value = false;
  if (fieldId) setGroup(groupBy.value.length, fieldId);
}
function setGroup(level: number, fieldId: string) {
  const next = [...groupBy.value];
  if (fieldId) next[level] = fieldId; else next.splice(level, 1);
  collapsed.clear();                       // paths from the old grouping mean nothing now
  save({ groupBy: next });
}

/** What a record added under this header will start with — every level above it included. */
function contextOf(header: GroupHeader) {
  const data: Record<string, unknown> = {};
  const links: Array<{ fieldId: string; toRecord: string }> = [];
  for (const h of ancestorsOf(items.value, header.path)) {
    const f = store.state.fields.get(h.fieldId);
    if (!f) continue;
    if (h.value.kind === 'value') data[f.key] = h.value.value;
    else if (h.value.kind === 'links') for (const to of h.value.ids) links.push({ fieldId: f.id, toRecord: to });
  }
  return { data, links };
}
function addTitle(h: GroupHeader) {
  if (h.value.kind === 'derived') return `Add a record (“${fieldName(h.fieldId)}” is computed, so it cannot be set for you)`;
  return h.value.kind === 'empty' ? 'Add a record with this left empty' : `Add a record in “${h.label}”`;
}
function createIn(header: GroupHeader) {
  collapsed.delete(header.path);           // you are about to type in it
  void create(contextOf(header));
}

/* ── row selection, and dragging rows out ─────────────────────────────────

   Separate from the CELL selection below: a cell is where you type, a row is a
   record you can pick up. Kept as ids, like the cell selection, so it survives a
   re-sort. */

const rowSel = reactive(new Set<string>());
let rowAnchor = -1;

function onRowHandleDown(id: string, index: number, e: PointerEvent) {
  if (e.button !== 0) return;
  editing.value = false;
  sel.value = null;
  const wasSelected = rowSel.has(id);
  if (e.shiftKey && rowAnchor !== -1) {
    const [a, b] = [Math.min(rowAnchor, index), Math.max(rowAnchor, index)];
    if (!(e.ctrlKey || e.metaKey)) rowSel.clear();
    for (const r of rows.value.slice(a, b + 1)) rowSel.add(r.id);
  } else if (e.ctrlKey || e.metaKey) {
    if (wasSelected) rowSel.delete(id); else rowSel.add(id);
    rowAnchor = index;
  } else {
    // Pressing a row that is ALREADY part of a multi-selection must not collapse
    // it yet — this press may be the start of dragging all of them. It collapses
    // on release, if no drag happened (the onClick below).
    if (!wasSelected) { rowSel.clear(); rowSel.add(id); }
    rowAnchor = index;
  }
  scroller.value?.focus({ preventScroll: true });

  beginRecordDrag(
    // In GRID order, whatever order they were clicked in.
    () => rows.value.filter((r) => rowSel.has(r.id)),
    e,
    (recs) => (recs.length === 1 ? labelFor(recs[0].id) : `${recs.length} records`),
    () => { if (wasSelected && !e.shiftKey && !e.ctrlKey && !e.metaKey) { rowSel.clear(); rowSel.add(id); } },
  );
}

/* ── selection and editing ────────────────────────────────────────────────*/

const sel = ref<{ rec: string; field: string } | null>(null);
const editing = ref(false);
/** The character that started the edit, if it was started by typing. */
const seed = ref<string | undefined>();
/** The <td> being edited — the link picker positions itself from its rectangle. */
const anchorEl = ref<HTMLElement | null>(null);

const isSel = (rec: string, field: string) => sel.value?.rec === rec && sel.value.field === field;
const display = (v: unknown) => (v === undefined || v === null ? '' : String(v));
/** First line of a note, as text. */
const notePreview = (v: unknown) => richTextToPlain(v).split('\n', 1)[0];
const attachSummary = (v: unknown) => { const n = Array.isArray(v) ? v.length : 0; return n ? `📎 ${n} file${n === 1 ? '' : 's'}` : ''; };
const asList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
/** Types with a text-like editor, where typing a character can start the edit. */
const TYPEABLE = new Set(['text', 'long_text', 'number', 'file_path', 'link']);   // link: the character seeds the picker's search

function select(rec: string, field: string) {
  rowSel.clear();
  sel.value = { rec, field };
}

function onCellDown(rec: string, f: FieldRow, e: MouseEvent) {
  if (isSel(rec, f.id) && editing.value) return;   // clicks inside the open editor are its own
  // A second click on the already-selected cell edits it — the mouse equivalent
  // of Enter, and what makes a link or select cell usable without the keyboard.
  const again = isSel(rec, f.id);
  editing.value = false;
  select(rec, f.id);
  if (again) { e.preventDefault(); startEdit(rec, f); return; }
  // Focus goes to the grid, not to whatever was clicked, so keys work at once.
  e.preventDefault();
  scroller.value?.focus({ preventScroll: true });
}

function startEdit(rec: string, f: FieldRow, withSeed?: string) {
  if (f.type === 'lookup' || f.type === 'backlink') return;
  select(rec, f.id);
  // No room for these in a row: their editor is the record panel.
  if (f.type === 'rich_text' || f.type === 'attachment' || f.type === 'structured') { emit('open-record', rec); return; }
  if (f.type === 'checkbox') return toggleBox(rec, f);
  seed.value = withSeed;
  editing.value = true;
  // After the DOM catches up: `select` above may have just MOVED the ring, and
  // until Vue re-renders, td.sel is still the previous cell.
  void nextTick(() => { anchorEl.value = scroller.value?.querySelector<HTMLElement>('td.sel') ?? null; });
}

/** The editor is done (or cancelled). Move as asked, and take the keyboard back. */
function stopEdit(exit: 'down' | 'right' | 'left' | 'none') {
  if (!editing.value) return;
  editing.value = false;
  seed.value = undefined;
  if (exit === 'down') move(1, 0);
  else if (exit === 'right') move(0, 1, true);
  else if (exit === 'left') move(0, -1, true);
  void nextTick(() => scroller.value?.focus({ preventScroll: true }));
}

/** A click on the box itself. The click moved focus INTO the checkbox, and the
 *  grid only listens to keys aimed at itself — so hand focus back, or the arrow
 *  keys go dead after every tick until you click somewhere else. */
function onBoxClick(rec: string, f: FieldRow) {
  editing.value = false;
  toggleBox(rec, f);
  scroller.value?.focus({ preventScroll: true });
}

function toggleBox(rec: string, f: FieldRow) {
  const r = store.state.records.get(rec);
  // Unticking stores `false`; it does not unset. "Explicitly no" and "never
  // answered" are different facts, and a QC checklist needs the distinction.
  setValue(rec, f.key, !(r?.data[f.key] === true));
}

/**
 * Move the selection. `wrap` is Tab's behaviour: off the end of a row continues
 * on the next one, like a spreadsheet. Arrows stop at the edges. Moving down
 * from the last row does nothing — deliberately; see the header.
 */
function move(dRow: number, dCol: number, wrap = false) {
  const cols = shown.value;
  if (!sel.value || !cols.length || !rows.value.length) return;
  let ri = rows.value.findIndex((r) => r.id === sel.value!.rec);
  let ci = cols.findIndex((f) => f.id === sel.value!.field);
  if (ri === -1 || ci === -1) return;
  ci += dCol;
  if (wrap && ci >= cols.length && ri < rows.value.length - 1) { ci = 0; ri++; }
  else if (wrap && ci < 0 && ri > 0) { ci = cols.length - 1; ri--; }
  ri = Math.min(rows.value.length - 1, Math.max(0, ri + dRow));
  ci = Math.min(cols.length - 1, Math.max(0, ci));
  select(rows.value[ri].id, cols[ci].id);
  reveal(ri);
}

function onGridKey(e: KeyboardEvent) {
  if (editing.value || e.target !== scroller.value) return;   // the editor has the keys
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    // Every row IN THE VIEW — i.e. after sort, filter and search — so "filter to
    // what I want, Ctrl+A, drag" brings exactly that onto a canvas.
    e.preventDefault();
    rowSel.clear();
    for (const r of rows.value) rowSel.add(r.id);
    return;
  }
  if (e.key === 'Escape' && rowSel.size) { rowSel.clear(); return; }
  const s = sel.value;
  if (!s) {
    // Nothing selected yet: any arrow picks the first cell, so the keyboard works
    // from a cold start without reaching for the mouse.
    if (e.key.startsWith('Arrow') && rows.value.length && shown.value.length) {
      e.preventDefault(); select(rows.value[0].id, shown.value[0].id); reveal(0);
    }
    return;
  }
  const f = fieldById.value.get(s.field);
  if (!f) return;
  const go = (r: number, c: number, wrap = false) => { e.preventDefault(); move(r, c, wrap); };
  switch (e.key) {
    case 'ArrowUp': return go(-1, 0);
    case 'ArrowDown': return go(1, 0);
    case 'ArrowLeft': return go(0, -1);
    case 'ArrowRight': return go(0, 1);
    case 'Tab': return go(0, e.shiftKey ? -1 : 1, true);
    case 'Enter': case 'F2': e.preventDefault(); return startEdit(s.rec, f);
    // Space ticks a checkbox; anywhere else it OPENS the record (Airtable's key).
    case ' ':
      e.preventDefault();
      if (f.type === 'checkbox') toggleBox(s.rec, f); else emit('open-record', s.rec);
      return;
    case 'Escape': sel.value = null; return;
    case 'Delete': case 'Backspace':
      // Links are rows, not a value; "clear" there would mean deleting N links on
      // one keypress. Use the × on each chip.
      // …and one keypress must not wipe a whole document or a set of files.
      if (['link', 'lookup', 'backlink', 'rich_text', 'attachment', 'structured'].includes(f.type)) return;
      e.preventDefault();
      if (store.state.records.get(s.rec)?.data[f.key] !== undefined) unsetValue(s.rec, f.key);
      return;
  }
  // A printable character starts an edit that REPLACES the value with it.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && TYPEABLE.has(f.type)) {
    e.preventDefault();
    startEdit(s.rec, f, e.key);
  }
}

/* ── windowing ────────────────────────────────────────────────────────────*/

const ROW_H = 30;        // must match .cell height + borders in the CSS below
const OVERSCAN = 12;     // rows rendered beyond each edge, so fast scroll is not blank

const scroller = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportH = ref(600);
function onScroll() {
  scrollTop.value = scroller.value?.scrollTop ?? 0;
  // The link picker is position:fixed from its cell's rectangle, so scrolling
  // the grid under it would leave it floating over the wrong row. Close it.
  if (editing.value && fieldById.value.get(sel.value?.field ?? '')?.type === 'link') stopEdit('none');
}

const first = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN));
const last = computed(() =>
  Math.min(items.value.length, Math.ceil((scrollTop.value + viewportH.value) / ROW_H) + OVERSCAN));
const windowed = computed(() => items.value.slice(first.value, last.value));
const padTop = computed(() => first.value * ROW_H);
const padBottom = computed(() => (items.value.length - last.value) * ROW_H);

/**
 * Scroll row `i` into view. Done by arithmetic, not scrollIntoView: the row may
 * not be in the DOM (it is windowed), and the sticky header covers the top 28px
 * of the scroller, which scrollIntoView knows nothing about.
 */
const HEADER_H = 29;
function reveal(ri: number) {
  const sc = scroller.value;
  if (!sc) return;
  // `ri` counts RECORDS; the scroll position counts ITEMS (group headers take a row each).
  const i = itemIndexOfRow.value[ri] ?? ri;
  const top = i * ROW_H, bottom = top + ROW_H;
  if (top < sc.scrollTop) sc.scrollTop = top;
  else if (bottom > sc.scrollTop + sc.clientHeight - HEADER_H) {
    sc.scrollTop = bottom - sc.clientHeight + HEADER_H;
  }
}

/* The sort / filter / fields menus are <details>. A <details> only closes when its
   own <summary> is clicked, so they stayed open while you clicked around the grid.
   Any press OUTSIDE an open one closes it. */
function closeMenusOutside(e: Event) {
  for (const d of scrollerRoot.value?.querySelectorAll<HTMLDetailsElement>('details.menu[open]') ?? []) {
    if (!d.contains(e.target as Node)) d.open = false;
  }
}
const scrollerRoot = ref<HTMLElement>();
onMounted(() => document.addEventListener('mousedown', closeMenusOutside, true));
onUnmounted(() => document.removeEventListener('mousedown', closeMenusOutside, true));

let ro: ResizeObserver | undefined;
onMounted(() => {
  if (!scroller.value) return;
  ro = new ResizeObserver(() => { viewportH.value = scroller.value?.clientHeight ?? 600; });
  ro.observe(scroller.value);
});
onUnmounted(() => ro?.disconnect());

/* ── loading ──────────────────────────────────────────────────────────────

   Walk the table whenever it is not loaded — on mount, on switching table, and
   after a resync, which clears `tableLoads` precisely so this fires again. */
watch([() => props.tableId, load], ([id, l]) => {
  if (id && !l) void store.loadTable(id);
}, { immediate: true });

// A selection pointing at a record or field that is gone (deleted, filtered out,
// hidden) is dropped rather than left dangling on nothing.
watch(rows, (now) => {
  if (!rowSel.size) return;
  const alive = new Set(now.map((r) => r.id));
  for (const id of [...rowSel]) if (!alive.has(id)) rowSel.delete(id);
});

watch([rows, shown], () => {
  const s = sel.value;
  if (!s) return;
  if (!rows.value.some((r) => r.id === s.rec) || !shown.value.some((f) => f.id === s.field)) {
    sel.value = null; editing.value = false;
  }
});

// Switching VIEW resets the transient state. Keyed on the view actually shown,
// and ignoring undefined → id: that transition is the placeholder "Grid" tab
// becoming a real row on the first sort/filter/hide — same view as far as the
// person is concerned. Treating it as a switch dropped the selection and the
// just-added-rows exemption the first time anyone clicked a column header.
watch(() => active.value?.id, (_now, was) => {
  if (was === undefined) return;
  sel.value = null; editing.value = false;
  fresh.clear();
  if (scroller.value) scroller.value.scrollTop = 0;
});
watch(() => props.tableId, () => { activeId.value = ''; search.value = ''; });
</script>

<style scoped>
.gridview { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.bar {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 6px 12px; border-bottom: 1px solid var(--border-main);
}

.menu { position: relative; }
.menu summary {
  list-style: none; cursor: pointer; color: var(--text-secondary);
  border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 8px;
}
.menu summary::-webkit-details-marker { display: none; }
.menu summary.active { color: var(--accent); border-color: var(--accent); }
.pop {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 320px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  padding: 8px; display: flex; flex-direction: column; gap: 6px;
  box-shadow: var(--card-shadow-drag);
}
.line { display: flex; gap: 4px; align-items: center; }
.line.check { cursor: pointer; }
.line select, .line input:not([type='checkbox']), .search {
  background: var(--bg-app); border: 1px solid var(--border-main); color: inherit;
  border-radius: 4px; padding: 2px 6px; font: inherit; min-width: 0; flex: 1;
  color-scheme: dark;
}
.search { flex: none; width: 180px; }
.note { margin: 0; color: var(--text-muted); font-size: 11px; }
.x {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 4px;
}
.x:hover { color: var(--danger); }
.spacer { flex: 1; }
.count { color: var(--text-muted); font-size: 11px; }
.count.warn { color: var(--warning); }

.scroller { flex: 1; overflow: auto; min-height: 0; }
.grid { border-collapse: separate; border-spacing: 0; min-width: 100%; }
.grid th, .grid td {
  border-right: 1px solid var(--border-main); border-bottom: 1px solid var(--border-main);
  padding: 0 8px; text-align: left; font-weight: 400;
}
.grid th {
  position: sticky; top: 0; z-index: 10; background: var(--bg-app);
  color: var(--text-muted); font-size: 11px; text-transform: uppercase;
  height: 28px; white-space: nowrap; user-select: none;
}
.grid th.sortable { cursor: pointer; }
.grid th.sortable:hover { color: var(--text-primary); }
.mark { color: var(--accent); margin-left: 4px; }
.star { color: var(--warning); margin-right: 2px; }
.th-menu, .th-add {
  background: none; border: none; color: var(--text-faint); cursor: pointer;
  font: inherit; padding: 0 2px; margin-left: 4px;
}
/* A GEAR, not a ▾: a small triangle beside the ▲/▼ sort mark read as part of the
   sort control. Slightly smaller than the text so it does not shout. */
.th-menu { visibility: hidden; font-size: 11px; }
th:hover .th-menu, .th-menu:focus { visibility: visible; }
.th-menu:hover, .th-add:hover { color: var(--accent); }
.th-add { font-size: 14px; color: var(--text-muted); }
.add-field { width: 1%; }
.hide { margin-top: 8px; width: 100%; }
/* The ⤢ sits ON TOP of the row number rather than replacing it in the flow.
   Swapping `display` between a number and a wider, taller glyph re-measured the
   cell on every hover: the column twitched and the row grew a pixel, which in a
   windowed grid (fixed ROW_H) also nudged everything below it. Absolute + a
   fixed-width cell means hovering changes paint, never layout. */
.num { position: relative; min-width: 46px; box-sizing: border-box; cursor: grab; user-select: none; padding-right: 18px !important; }
.num:active { cursor: grabbing; }
.num .expand {
  position: absolute; top: 0; bottom: 0; right: 0; width: 18px; display: flex; align-items: center; justify-content: center;
  visibility: hidden; background: none; border: none; color: var(--accent);
  cursor: pointer; padding: 0; font: inherit; line-height: 1;
}
.row.rowsel td { background: rgba(66, 165, 245, 0.14); }
.row.rowsel .num { color: var(--accent); }
/* The view control is the first thing in the bar and reads as a LABEL + NAME, not
   as one more button: it answers "which view am I in" before it is ever opened. */
.view-menu > summary { border: 1px solid var(--border-main); border-radius: 4px; padding: 2px 10px; }
.view-menu > summary::after { content: ' ▾'; color: var(--text-faint); }
.view-label { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.view-name { color: var(--text-primary); }
.view-pop { min-width: 380px; }
.view-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 4px; cursor: pointer; }
.view-row:hover { background: var(--bg-surface-hover); }
.view-row.on .view-title { color: var(--accent); font-weight: 600; }
.view-tick { width: 12px; color: var(--accent); flex: none; }
.view-title { white-space: nowrap; }
.view-sum { flex: 1; color: var(--text-faint); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.view-act { visibility: hidden; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0 3px; font: inherit; }
.view-row:hover .view-act { visibility: visible; }
.view-act:hover { color: var(--accent); }
.view-act.danger:hover { color: var(--danger); }
.new-view { display: block; width: 100%; text-align: left; background: none; border: none; border-top: 1px solid var(--border-main); margin-top: 4px; padding: 7px 6px 5px; color: var(--accent); cursor: pointer; font: inherit; }
.new-view .muted { color: var(--text-faint); }
.hint-line { margin: 6px 6px 2px; color: var(--text-faint); font-size: 11px; line-height: 1.4; white-space: normal; max-width: 360px; }
.add-group { display: block; width: 100%; text-align: left; background: none; border: none; color: var(--accent); cursor: pointer; font: inherit; padding: 5px 6px; }
.group-row td { padding: 0; background: var(--controls-bg); border-bottom: 1px solid var(--border-main); height: 29px; }
.group-row.level-1 td { background: var(--bg-app); }
.group-head { display: flex; align-items: center; gap: 8px; height: 29px; box-sizing: border-box; white-space: nowrap; position: sticky; left: 0; max-width: 100vw; }
.group-fold { background: none; border: none; color: var(--text-muted); cursor: pointer; width: 16px; padding: 0; font: inherit; font-size: 10px; }
.group-field { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.group-label { font-weight: 600; }
.group-label.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }
.group-count { color: var(--text-muted); font-size: 11px; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 0 7px; }
.group-row.level-1 .group-count { background: var(--controls-bg); }
.group-add { background: none; border: 1px solid transparent; border-radius: 3px; color: var(--text-muted); cursor: pointer; padding: 0 6px; font: inherit; }
.group-add:hover { color: var(--accent); border-color: var(--accent); }
.scope-note { font-size: 11px; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 0 6px; white-space: nowrap; }
.scope-note.unscoped { color: var(--warning); border-color: var(--warning); }
.row:hover .num .expand { visibility: visible; }
.num { width: 1%; color: var(--text-faint); font-size: 11px; text-align: right !important; }
.act { width: 1%; white-space: nowrap; }
.open-board { background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 3px; padding: 0 6px; margin-right: 4px; cursor: pointer; font: inherit; font-size: 11px; }

/* The selection ring is drawn on the CELL (td), inset, never on an input inside
   it. It used to be the browser's focus ring on the <input>, which the .cell
   wrapper clipped at the left and right edges — .cell must clip, to hold the
   fixed row height. An inset outline cannot be clipped by anything. */
.grid td.sel { outline: 2px solid var(--accent); outline-offset: -2px; }
.grid td.sel.editing { outline-color: var(--success); background: var(--bg-app); }
.scroller:focus { outline: none; }
.scroller:not(:focus-within) td.sel { outline-color: var(--text-faint); }
.cell { position: relative; }
.shown { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1; }
.shown.under { visibility: hidden; }          /* still sizing the column; see template */
.cell :deep(.over) { position: absolute; inset: 0; }
.value { overflow: hidden; text-overflow: ellipsis; }
.value.num { margin-left: auto; font-variant-numeric: tabular-nums; }
.looked-up { color: var(--text-secondary); font-style: italic; }
.broken { color: var(--danger); font-size: 11px; }
.value.note { color: var(--text-secondary); }
.chip.plain { padding: 1px 8px; }
.chip.back { font-style: italic; color: var(--text-secondary); }
.grid td { cursor: default; }

/* FIXED HEIGHT — the window maths depends on it. 29px + 1px border = ROW_H. */
.cell {
  height: 29px; min-width: 120px; max-width: 420px;
  display: flex; align-items: center; gap: 2px;
  overflow: hidden; white-space: nowrap;
}
.row.pending { opacity: 0.55; }
.row.fresh td { background: rgba(66, 165, 245, 0.05); }
.row:hover td { background: var(--bg-surface-hover); }
.hint { padding: 24px; color: var(--text-muted); }
.foot { flex: none; padding: 6px 12px; border-top: 1px solid var(--border-main); }
.ghost:disabled { opacity: 0.4; cursor: default; }
</style>
