<!--
  Everything about ONE table: its name and look, its kind, and — the body of the
  dialog — its SCHEMA: the fields, in the order that is the default for views,
  cards and the record tray and that defines the primary (contract/labels.ts).
  Opened from the ⚙ on a table's row in the tree.

  The field list is an editor, not a listing. Each row: a grip to drag it (the
  others slide out of the way — a TransitionGroup FLIP), the ★ of the field that
  names records (previewed while dragging, since the first plain-valued field
  is the primary and a drag can change it), the name, type and a one-line summary,
  and ⚙, which unfolds the same FieldSettings form the grid's column headers use —
  rename, choices, arrow style, compare, delete. "+ add field" at the bottom is the
  same FieldForm as the grid's "+", kept open: type a name, Enter, and the focus is
  back in the name box for the next one — the fast path for a schema with a LOT
  of fields, which is why this list exists (the column headers are fine for one).

  SECTIONS (contract/fieldSections.ts) are BARS in that same list: the fields under
  a bar are in its section, the fields above the first bar are in none. A field is
  dragged across a bar to change section; a bar is dragged to move the whole section,
  its fields with it. A bar's ⚙ renames it, sets whether it starts folded in the
  record panel, and removes it (the fields stay). Its ▾ folds it HERE, in this
  dialog only — which is what makes sixty fields five rows to rearrange.

  Every control writes at once; a drag writes once, on release, as one Ctrl+Z.
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
      <div class="fld">
        <label for="ts-singular">Singular name <span class="hint">— shown on cards: “Deliverable”, not “Deliverables”</span></label>
        <input id="ts-singular" :value="table.singular_name" placeholder="(optional)" @change="upd({ singularName: val($event) })" />
      </div>

      <p class="info">
        <template v-if="table.kind === 'canvas'"><b>▦ A table of boards.</b> Every record in it is a canvas. This is set when a table is made and cannot be changed.</template>
        <template v-else-if="table.kind === 'report'"><b>▤ A table of reports.</b> Every record in it is a report: its “Report” field holds the definition. This is set when a table is made and cannot be changed.</template>
        <template v-else-if="table.kind === 'junction'"><!-- JunctionSettings below says it all --></template>
        <template v-else>An ordinary table. (Tables of boards, reports or junctions are chosen in the new-table dialog.)</template>
      </p>
      <!-- A VOCABULARY table — Containers, Codecs: rows other tables link to, that nobody
           browses — can fold itself away with the boards and junctions (sql/018). -->
      <label v-if="!table.kind || table.kind === 'records'" class="utility-tick"
             title="Tick for a table that only exists to be linked to — a vocabulary such as Containers or Codecs. It is then folded away in the navigation with the boards, reports and junctions, and left out of the pickers that choose a data table. Links, the link picker, search and reports still see it.">
        <input type="checkbox" :checked="table.utility === true" @change="upd({ utility: ($event.target as HTMLInputElement).checked })" />
        utility table <span class="hint">— folded away in the tree; for a table other tables link to, such as a vocabulary</span>
      </label>
      <JunctionSettings v-if="table.kind === 'junction'" :store="store" :table-id="tableId" />

      <!-- THE SCHEMA. Its order is not any view's column order — that is arranged in
           the grid and saved per view. This one is the DEFAULT (the record tray, canvas
           cards, the link picker, a never-arranged view) and it DEFINES the primary: the
           first plain-valued field names the table's records (contract/labels.ts). -->
      <section class="schema">
        <h3>Fields <span class="hint">— {{ ownFields.length }}; drag to reorder. The order is the default for views, cards and the record panel; the first plain-valued field (★) names records</span></h3>
        <!-- Only ever seen when something OTHER than this editor arranged the fields (a script,
             an old tab): the list below is what the next reorder will write, and that would
             rename every record. Say so before it happens rather than after. -->
        <p v-if="primaryWarning" class="info warn primary-warning">⚠ The order shown here and the stored field order disagree about the primary field. The next reorder here will make “{{ primaryWarning }}” the primary (★) — it names every record. Use “make primary” in a field’s ⚙ to choose.</p>
        <TransitionGroup tag="div" name="fl" class="field-list" :class="{ dragging: !!drag }">
          <div v-for="row in rows" :key="row.key" :class="rowClass(row)"
               :data-row="row.kind === 'empty' ? undefined : row.key" :data-field="row.kind === 'field' ? row.f.id : undefined" :data-sec="row.sec ?? undefined">
            <!-- A FIELD -->
            <template v-if="row.kind === 'field'">
              <div class="frow">
                <span class="grip" title="Drag to reorder — across a section's bar to change section (↑ ↓ also work)" @pointerdown.prevent="startDrag('f', row.f.id, $event)">⋮⋮</span>
                <span class="star" :class="{ on: primaryId === row.f.id }" :title="primaryId === row.f.id ? 'Primary field — names this table\'s records' : ''">★</span>
                <span class="fname">{{ row.f.name }}</span>
                <span class="ftype mono">{{ row.f.type }}</span>
                <span class="fsum hint">{{ summaryOf(row.f) }}</span>
                <button class="mv prev" :disabled="!canStep(row.f.id, -1)" tabindex="-1" title="Move up" @click="actions.moveField(row.f.id, -1)">↑</button>
                <button class="mv next" :disabled="!canStep(row.f.id, 1)" tabindex="-1" title="Move down" @click="actions.moveField(row.f.id, 1)">↓</button>
                <button class="gear" :class="{ on: openId === row.f.id }" :title="openId === row.f.id ? 'Close' : 'Settings — rename, choices, arrows, comparison, delete'" @click="openId = openId === row.f.id ? null : row.f.id">⚙</button>
              </div>
              <FieldSettings v-if="openId === row.f.id" :store="store" :actions="actions" :field="row.f" layout="stack" class="fopen" @deleted="openId = null" />
            </template>

            <!-- A SECTION'S BAR: everything under it, down to the next bar, is in it. -->
            <template v-else-if="row.kind === 'section'">
              <div class="srow">
                <span class="grip" title="Drag to move the whole section, its fields with it (↑ ↓ also work)" @pointerdown.prevent="startDrag('s', row.s.id, $event)">⋮⋮</span>
                <button class="fold" :title="edFolded.has(row.s.id) ? 'Show its fields (here, in this dialog)' : 'Fold (here, in this dialog)'" @click="toggleFold(row.s.id)">{{ edFolded.has(row.s.id) ? '▸' : '▾' }}</button>
                <span class="sname" @click="toggleFold(row.s.id)">{{ row.s.name }}</span>
                <span class="fsum hint">{{ row.count }} field{{ row.count === 1 ? '' : 's' }}{{ row.s.folded ? ' · starts folded' : '' }}</span>
                <button class="mv prev" :disabled="row.index === 0" tabindex="-1" title="Move the section up" @click="stepSection(row.s.id, -1)">↑</button>
                <button class="mv next" :disabled="row.index === shown.sections.length - 1" tabindex="-1" title="Move the section down" @click="stepSection(row.s.id, 1)">↓</button>
                <button class="gear" :class="{ on: openId === row.key }" :title="openId === row.key ? 'Close' : 'Section settings — rename, starts folded, remove'" @click="openId = openId === row.key ? null : row.key">⚙</button>
              </div>
              <div v-if="openId === row.key" class="sopen">
                <label class="sfld">Name <input class="name" :value="row.s.name" maxlength="80" @change="renameSection(row.s, $event)" @keydown.enter="($event.target as HTMLInputElement).blur()" /></label>
                <label class="scheck" title="How the section is for someone who has never folded or unfolded it. Each person's own folding is remembered in their browser.">
                  <input type="checkbox" class="starts-folded" :checked="row.s.folded === true" @change="actions.updateSection(tableId, row.s.id, { folded: ($event.target as HTMLInputElement).checked })" />
                  starts folded in the record panel
                </label>
                <span class="sremove"><button class="danger remove-section" @click="removeSection(row.s.id)">remove section</button> <span class="hint">— its fields stay, and join the group above</span></span>
              </div>
            </template>

            <div v-else class="sempty hint">empty — drag fields under this bar, or add them below</div>
          </div>
        </TransitionGroup>
        <p v-if="!ownFields.length" class="info">No fields yet.</p>
        <!-- Kept open: the run of adds. -->
        <FieldForm :store="store" :actions="actions" :table-id="tableId" layout="row" class="fadd" @created="onCreated" />
        <div class="sadd">
          <button class="add-section" @click="addSection">+ add section</button>
          <span class="hint">— a named, foldable group of fields in the record panel{{ shown.sections.length ? '. New fields join the last section' : '' }}</span>
        </div>
      </section>

      <ToolSettings v-if="!table.kind || table.kind === 'records'" :store="store" :table-id="tableId" />

      <footer><button class="danger" @click="remove">Delete table…</button></footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { useSchemaActions } from '../schemaActions';
import ToolSettings from './ToolSettings.vue';
import JunctionSettings from './JunctionSettings.vue';
import FieldSettings from './FieldSettings.vue';
import FieldForm from './FieldForm.vue';
import { SYSTEM_FIELD_TYPES } from '../../contract/systemFields';
import { LABEL_TYPES } from '../../contract/labels';
import { choicesOf } from '../../contract/values';
import { shapeOf } from '../../contract/shapes';
import { fieldSectionsOf, flatOrder, moveSection, placeField, sameArrangement, stepField, type Arrangement, type FieldSection } from '../../contract/fieldSections';
import { notice } from '../desktop';

const props = defineProps<{ store: Store; tableId: string }>();
const emit = defineEmits<{ close: [] }>();
const actions = useSchemaActions(props.store);
const nameInput = ref<HTMLInputElement>();

const val = (e: Event) => (e.target as HTMLInputElement).value;
const table = computed(() => props.store.state.tables.get(props.tableId));
const ownFields = computed(() => fieldsOf(props.store.state, props.tableId).filter((f) => !SYSTEM_FIELD_TYPES.has(f.type)));
const upd = (patch: { icon?: string; color?: string; singularName?: string; utility?: boolean }) =>
  props.store.mutate({ type: 'table.update', id: props.tableId, ...patch });

/* ── the list ──────────────────────────────────────────────────────────── */
const openId = ref<string | null>(null);
const tableName = (id: unknown) => props.store.state.tables.get(String(id ?? ''))?.name ?? '?';
/** One line of what makes this field what it is. */
function summaryOf(f: FieldRow): string {
  const o = f.options ?? {};
  switch (f.type) {
    case 'link': return `→ ${tableName(o.target_table_id)}${o.single ? ' · single' : ''}${o.membership ? ' · membership' : ''}${o.compare ? ' · compares' : ''}${o.count === true ? ' · as count' : ''}`;
    case 'backlink': { const src = props.store.state.fields.get(String(o.source_field_id ?? '')); return src ? `← ${tableName(src.table_id)}.${src.name}${o.compare ? ' · compares' : ''}${o.count === true ? ' · as count' : ''}` : '← (broken)'; }
    case 'lookup': return actions.describeLookup(f).text;
    case 'select': case 'multi_select': { const c = choicesOf(o); return o.vocabulary ? `built-in: ${o.vocabulary}` : c ? `${c.length} choice${c.length === 1 ? '' : 's'}${c.length ? ': ' + c.slice(0, 4).join(', ') + (c.length > 4 ? '…' : '') : ''}` : ''; }
    case 'structured': return shapeOf(f) ?? '';
    case 'number': return typeof o.format === 'string' ? o.format : '';
    default: return '';
  }
}
function onCreated(id: string) {
  // A new field joins the LAST section: unfold it here, so the row is there to see.
  const last = shown.value.sections[shown.value.sections.length - 1];
  if (last) edFolded.delete(last.id);
  // Show it, and keep the new row in view.
  void nextTick(() => document.querySelector<HTMLElement>(`.ts .fitem[data-field="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
}

/* ── the list: fields, and the bars of the sections they are in ───────────────
   One flat list of ROWS, drawn from an ARRANGEMENT (contract/fieldSections.ts):
   the unsectioned fields, then per section its bar and — unless folded here — its
   fields. While something is held the list is drawn from the drag's `draft`; the
   others slide out of the way (TransitionGroup). Nothing is written until release:
   then the whole arrangement goes as one run — one Ctrl+Z. */
type Row =
  | { kind: 'field'; key: string; f: FieldRow; sec: string | null }
  | { kind: 'section'; key: string; s: FieldSection; sec: string; count: number; index: number }
  | { kind: 'empty'; key: string; sec: string };

const drag = ref<{ kind: 'f' | 's'; id: string; start: Arrangement; draft: Arrangement } | null>(null);
const shown = computed<Arrangement>(() => drag.value?.draft ?? actions.arrangement(props.tableId));
/** Sections folded HERE, in this dialog — not the schema's "starts folded", which this only starts from. */
const edFolded = reactive(new Set<string>(fieldSectionsOf(props.store.state.tables.get(props.tableId)).filter((s) => s.folded).map((s) => s.id)));
const toggleFold = (id: string) => { if (!edFolded.delete(id)) edFolded.add(id); };

const rows = computed<Row[]>(() => {
  const by = new Map(ownFields.value.map((f) => [f.id, f]));
  const out: Row[] = [];
  const push = (id: string, sec: string | null) => { const f = by.get(id); if (f) out.push({ kind: 'field', key: `f:${id}`, f, sec }); };
  for (const id of shown.value.top) push(id, null);
  shown.value.sections.forEach((s, index) => {
    out.push({ kind: 'section', key: `s:${s.id}`, s, sec: s.id, count: s.fields.length, index });
    if (edFolded.has(s.id)) return;
    for (const id of s.fields) push(id, s.id);
    if (!s.fields.length) out.push({ kind: 'empty', key: `e:${s.id}`, sec: s.id });
  });
  return out;
});
function rowClass(row: Row) {
  const d = drag.value;
  const lifted = !!d && (d.kind === 'f' ? row.kind === 'field' && row.f.id === d.id : row.sec === d.id);
  if (row.kind === 'field') return { fitem: true, in: row.sec !== null, lifted, open: openId.value === row.f.id };
  if (row.kind === 'section') return { sitem: true, lifted, open: openId.value === row.key };
  return { 'sempty-row': true, lifted };
}
/**
 * The ★: the first plain-valued field. Idle, that is by the schema's own order;
 * held, by the order SHOWN — so a drag previews what it would rename.
 */
const primaryId = computed(() => {
  if (!drag.value) return ownFields.value.find((f) => LABEL_TYPES.has(f.type))?.id ?? null;
  const by = new Map(ownFields.value.map((f) => [f.id, f]));
  return flatOrder(drag.value.draft).find((id) => LABEL_TYPES.has(by.get(id)?.type ?? '')) ?? null;
});
/** The field the next reorder would make primary, when that is NOT the one that is — else null. */
const primaryWarning = computed(() => {
  if (drag.value) return null;
  const by = new Map(ownFields.value.map((f) => [f.id, f]));
  const next = flatOrder(shown.value).map((id) => by.get(id)).find((f) => f && LABEL_TYPES.has(f.type));
  return next && next.id !== primaryId.value ? next.name : null;
});
const canStep = (id: string, dir: -1 | 1) => stepField(shown.value, id, dir) !== shown.value;
/** A blank name is not a rename: the box goes back to the name the section has. */
function renameSection(s: FieldSection, e: Event) {
  const el = e.target as HTMLInputElement;
  if (el.value.trim()) actions.updateSection(props.tableId, s.id, { name: el.value }); else el.value = s.name;
}
function stepSection(id: string, dir: -1 | 1) {
  const a = actions.arrangement(props.tableId);
  const next = moveSection(a, id, a.sections.findIndex((s) => s.id === id) + dir);
  if (next !== a) actions.setArrangement(props.tableId, next);
}
function addSection() {
  const id = actions.addSection(props.tableId, 'New section');
  if (!id) { notice('A table can have at most 50 sections', 'warn'); return; }
  openId.value = `s:${id}`;   // straight to its name
  void nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(`.ts [data-row="s:${id}"] .sopen input.name`);
    el?.scrollIntoView({ block: 'nearest' }); el?.focus(); el?.select();
  });
}
function removeSection(id: string) { openId.value = null; edFolded.delete(id); actions.removeSection(props.tableId, id); }

const rowEls = () => [...document.querySelectorAll<HTMLElement>('.ts .field-list [data-row]')];
const midAbove = (y: number, el: { top: number; height: number }) => y < el.top + el.height / 2;

function startDrag(kind: 'f' | 's', id: string, e: PointerEvent) {
  if (e.button !== 0) return;
  openId.value = null;
  const start = actions.arrangement(props.tableId);
  drag.value = { kind, id, start, draft: start };
  const move = (ev: PointerEvent) => {
    const d = drag.value; if (!d) return;
    let next = d.draft;
    if (d.kind === 'f') {
      // Where the pointer is among the rows: the lifted field goes before the first
      // row whose middle is below the pointer. Its section is the last BAR above
      // that place; under a bar folded here there is no field to go before, so it
      // lands at that section's end.
      const els = rowEls().filter((el) => el.dataset.row !== `f:${id}`);
      let index = els.length;
      for (let i = 0; i < els.length; i++) { if (midAbove(ev.clientY, els[i]!.getBoundingClientRect())) { index = i; break; } }
      let section: string | null = null;
      for (let i = 0; i < index; i++) { const k = els[i]!.dataset.row!; if (k.startsWith('s:')) section = k.slice(2); }
      const after = els[index]?.dataset.row;
      next = placeField(d.draft, id, section, after?.startsWith('f:') ? after.slice(2) : null);
    } else {
      // A section moves among the SECTIONS, as a block: before the first other
      // section whose block (its bar and the rows under it) has its middle below
      // the pointer. It cannot go above the unsectioned fields.
      const others = d.draft.sections.filter((x) => x.id !== id);
      let index = others.length;
      for (let i = 0; i < others.length; i++) {
        const rects = rowEls().filter((el) => el.dataset.sec === others[i]!.id).map((el) => el.getBoundingClientRect());
        if (!rects.length) continue;
        const top = Math.min(...rects.map((r) => r.top)), bottom = Math.max(...rects.map((r) => r.bottom));
        if (midAbove(ev.clientY, { top, height: bottom - top })) { index = i; break; }
      }
      next = moveSection(d.draft, id, index);
    }
    if (next !== d.draft) d.draft = next;
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    const d = drag.value; drag.value = null;
    // By CONTENT: dragged away and back is nothing, and must write nothing.
    if (d && !sameArrangement(d.draft, d.start)) actions.setArrangement(props.tableId, d.draft);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}

async function remove() { if (await actions.deleteTable(props.tableId)) emit('close'); }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { if (openId.value) openId.value = null; else emit('close'); } }
onMounted(() => void nextTick(() => nameInput.value?.focus()));
</script>

<style scoped>
.ts-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.4); display: flex; justify-content: center; align-items: flex-start; padding-top: 6vh; }
.ts { width: min(720px, 94vw); max-height: 88vh; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
header { display: flex; align-items: center; margin-bottom: 10px; }
h2 { margin: 0; font-size: 15px; flex: 1; }
h3 { margin: 0 0 4px; font-size: 12px; font-weight: 600; }
h3 .hint { font-weight: 400; }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.line { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
input:not([type='color']) { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 4px 8px; font: inherit; min-width: 0; }
.icon-in { width: 44px; text-align: center; }
.name-in { flex: 1; font-weight: 600; }
input[type='color'] { width: 30px; height: 26px; padding: 0; border: 1px solid var(--border-main); background: none; }
.fld { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
.fld label { font-size: 11px; color: var(--text-muted); }
.fld input { width: 100%; box-sizing: border-box; }
.hint { color: var(--text-faint); }
.info { color: var(--text-muted); font-size: 12px; margin: 0 0 8px; line-height: 1.4; }
.utility-tick { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: -2px 0 10px; }
.info.warn { color: var(--warning); }
.mono { font-family: var(--font-mono, monospace); font-size: 11px; }

.schema { margin: 12px 0; padding: 10px; border: 1px solid var(--border-main); border-radius: 6px; }
.field-list { display: flex; flex-direction: column; }
.fitem { border-radius: 4px; }
.fitem.lifted { background: var(--controls-bg); box-shadow: var(--card-shadow-drag); position: relative; z-index: 1; }
.fitem.open { background: var(--controls-bg); }
.frow { display: flex; align-items: center; gap: 6px; padding: 1px 4px; min-height: 24px; }
.grip { color: var(--text-faint); cursor: grab; user-select: none; letter-spacing: -2px; padding: 0 2px; }
.grip:hover, .lifted .grip { color: var(--accent); }
.field-list.dragging { cursor: grabbing; }
.field-list.dragging .grip { cursor: grabbing; }
.star { color: transparent; width: 12px; text-align: center; }
.star.on { color: var(--warning); }
.fname { font-weight: 500; }
.ftype { color: var(--text-secondary); }
.fsum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv, .gear { background: none; border: 1px solid transparent; border-radius: 3px; color: var(--text-muted); cursor: pointer; padding: 0 5px; font: inherit; line-height: 1.4; }
.mv:hover:not(:disabled), .gear:hover, .gear.on { color: var(--accent); border-color: var(--accent); }
.mv:disabled { opacity: 0.3; cursor: default; }
.fopen { padding: 6px 8px 8px 30px; }
/* A SECTION'S BAR: a header among the rows — lighter than a row, as the grid's header
   is lighter than its cells — and the fields under it stand in from the edge. */
.sitem { margin-top: 6px; border-radius: 4px; }
.srow { display: flex; align-items: center; gap: 6px; padding: 1px 4px; min-height: 26px; background: var(--bg-head); border-radius: 4px; }
.sitem.open { background: var(--controls-bg); }
.sitem.lifted { box-shadow: var(--card-shadow-drag); position: relative; z-index: 1; }
.fold { background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: 10px; width: 14px; padding: 0; text-align: center; }
.fold:hover { color: var(--accent); }
.sname { font-weight: 600; cursor: pointer; }
.fitem.in .frow { padding-left: 20px; }
.fitem.in .fopen { padding-left: 46px; }
.sempty { padding: 3px 4px 3px 38px; font-size: 12px; font-style: italic; }
.sopen { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 8px 8px 8px 30px; }
.sfld { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; }
.sfld input { width: 220px; color: var(--text-primary); }
.scheck { display: flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; }
.sremove { font-size: 12px; }
.sadd { display: flex; align-items: baseline; gap: 6px; margin-top: 8px; font-size: 12px; }
.add-section { background: var(--controls-bg); border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit; }
.add-section:hover { color: var(--accent); border-color: var(--accent); }
.fadd { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-main); }
/* The FLIP: rows slide to their new place. */
.fl-move { transition: transform 0.18s ease; }
.fl-enter-active { transition: opacity 0.15s ease; }
.fl-enter-from { opacity: 0; }
.fl-leave-active { position: absolute; opacity: 0; }

footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border-main); }
.danger { background: none; border: 1px solid var(--border-main); color: var(--danger); border-radius: 4px; padding: 3px 10px; cursor: pointer; font: inherit; }
</style>
