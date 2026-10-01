<!--
  Everything you can do to an EXISTING field — the ONE set of controls for it,
  shown as a popover from a grid column header and as a row on the schema tab.
  See schemaActions.ts for why there is exactly one.

  What is deliberately absent:
  - CHANGING THE TYPE. It is a rewrite of every value in the column wearing an
    edit's clothes ("banana" as a number?). If it is ever needed, the safe shape
    is "convert into a NEW field", leaving the original until you delete it.
  - CHANGING THE KEY. Same reason: every record stores its value under it.
  Both are shown, read-only, so you can see what you have.
  - MOVING THE FIELD. Column order belongs to the VIEW (drag a header, or the
    "fields" menu); the schema's own order — which also decides the primary — is
    arranged in Table settings. "make primary" stays: it is a schema act by name.
-->
<template>
  <div class="field-settings" :class="layout">
    <input class="name" :value="field.name" title="Rename — the key and every stored value are unaffected"
           @change="actions.renameField(field.id, ($event.target as HTMLInputElement).value)"
           @keydown.enter="($event.target as HTMLInputElement).blur()" />
    <span class="meta mono" :title="'The key: the property name values are stored under. It cannot be changed.'">{{ field.key }}</span>
    <span class="meta">{{ field.type }}<template v-if="field.type === 'link'"> → {{ targetName }}</template></span>
    <span v-if="field.type === 'backlink'" class="meta lookup" :class="{ broken: backlink.broken }"
          title="A backlink shows links made on other records, pointing here. It stores nothing; edit the link on the record that holds it.">{{ backlink.text }}</span>
    <span v-if="field.type === 'lookup'" class="meta lookup" :class="{ broken: lookup.broken }"
          title="A lookup is computed: it follows a link field and shows a field from the far record. To re-point it, delete it and add another — it stores no data of its own.">{{ lookup.text }}</span>

    <!-- A select's choices: typed here, OR from a built-in list (contract/vocab.ts) —
         then they live in the code, every bound select agrees, and nobody can add
         a near-duplicate. -->
    <template v-if="field.type === 'select' || field.type === 'multi_select'">
      <select class="vocab" :value="String(field.options?.vocabulary ?? '')" title="Where the choices come from"
              @change="onVocabulary(($event.target as HTMLSelectElement).value)">
        <option value="">typed choices</option>
        <option v-for="id in VOCABULARY_IDS" :key="id" :value="id">built-in: {{ VOCABULARIES[id].name }}</option>
      </select>
      <input v-if="!field.options?.vocabulary" class="choices"
             :value="ownChoices(field).join(', ')" placeholder="choices, comma separated"
             title="Values already stored under a removed choice stay readable; they fail validation the next time that cell is edited."
             @change="actions.setChoices(field.id, ($event.target as HTMLInputElement).value)"
             @keydown.enter="($event.target as HTMLInputElement).blur()" />
      <span v-else class="meta vocab-note" :title="choicesOf(field).join(', ')">{{ choicesOf(field).length }} choices from the built-in list — grows with the app, not editable here</span>
    </template>

    <!-- LINK fields: how their relationships are drawn, on EVERY canvas. -->
    <span v-if="field.type === 'link'" class="arrow-style">
      <label class="arrow-color" title="The colour of this relationship — its arrows on every canvas, and its pills wherever its links are shown (here, and on the table it points at). Without one, pills are neutral.">
        arrow
        <input type="color" :value="arrow.color ?? '#8a8a8a'"
               @change="actions.setArrowStyle(field.id, { color: ($event.target as HTMLInputElement).value })" />
      </label>
      <button v-if="arrow.color" class="clear-color" title="Back to the default colour"
              @click="actions.setArrowStyle(field.id, { color: null })">×</button>
      <label class="arrow-rev" title="Draw the arrowhead at the record that HOLDS the link. For a field like “Previous version”, stored on the newer record, this makes the flow read old → new.">
        <input type="checkbox" :checked="arrow.reversed === true"
               @change="actions.setArrowStyle(field.id, { reversed: ($event.target as HTMLInputElement).checked })" />
        reversed
      </label>
    </span>

    <!-- LINK fields: at most one link per record? Records that already have several
         keep them; only ADDING is refused from then on. -->
    <label v-if="field.type === 'link'" class="single"
           :title="`Tick if a record may link to only ONE ${targetName} record. Choosing another then replaces it. Records that already link to several are left alone.`">
      <input type="checkbox" :checked="field.options?.single === true"
             @change="actions.setSingle(field.id, ($event.target as HTMLInputElement).checked)" />
      single
    </label>
    <!-- LINK fields: a COMPARING link (COMPARE-BRIEF.md): the target is what is expected,
         this table's record what was found; pairs of fields say what is checked. Ticking
         pre-fills same-name pairs. -->
    <label v-if="field.type === 'link' || compareTarget" class="compare-tick"
           :title="`Tick to compare a ${tableName} record's fields against the ${targetName} record it links to. Differences show as ⚠ beside the field.`">
      <input type="checkbox" :checked="field.options?.compare !== undefined" @change="toggleCompare(($event.target as HTMLInputElement).checked)" />
      compare
    </label>
    <ComparePairs v-if="(field.type === 'link' || compareTarget) && field.options?.compare !== undefined" :store="store" :field="field" />
    <!-- LINK and BACKLINK fields: shown as a COUNT where a record gets one line (contract/pills.ts). -->
    <label v-if="field.type === 'link' || field.type === 'backlink'" class="count-tick"
           :title="`Tick for a busy field: the grid, board cards and canvas cards then show a count — “3 ${countedName}” — instead of a pill per record. The record tray still lists every one.`">
      <input type="checkbox" :checked="field.options?.count === true"
             @change="actions.setCount(field.id, ($event.target as HTMLInputElement).checked)" />
      count
    </label>
    <!-- LINK fields: is this the link through which records BELONG to something? -->
    <label v-if="field.type === 'link'" class="membership"
           :title="`Tick if a record of this table BELONGS to the ${targetName} record it links to — e.g. a file belongs to a project. A section scoped by ${targetName} then narrows this table to one of them, and new records made there are linked automatically. One such field per table.`">
      <input type="checkbox" :checked="field.options?.membership === true"
             @change="actions.setMembership(field.id, ($event.target as HTMLInputElement).checked)" />
      membership
    </label>

    <span class="buttons">
      <span v-if="actions.isPrimary(field.id)" class="primary"
            title="Records in this table are named by this field — in link chips, on cards, in the picker. It is the first plain-valued field.">★ primary</span>
      <button v-else-if="actions.canBePrimary(field)" class="make-primary"
              title="Name this table's records by this field. Moves it first."
              @click="actions.makePrimary(field.id)">make primary</button>
      <button class="danger delete" @click="onDelete">delete</button>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { suggestPairs } from '../../contract/compare';
import ComparePairs from './ComparePairs.vue';
import { useDerived } from '../derived';
import { choicesOf, ownChoices, type SchemaActions } from '../schemaActions';
import { VOCABULARIES, VOCABULARY_IDS } from '../../contract/vocab';
import { arrowStyleOf } from '../../contract/arrows';

const props = defineProps<{
  store: Store; actions: SchemaActions; field: FieldRow;
  layout?: 'row' | 'stack';
}>();
const emit = defineEmits<{ deleted: [] }>();
const derived = useDerived(props.store);
async function onDelete() { if (await props.actions.deleteField(props.field.id)) emit('deleted'); }

const arrow = computed(() => arrowStyleOf(props.field));
const backlink = computed(() => props.actions.describeBacklink(props.field));
const lookup = computed(() => props.actions.describeLookup(props.field));
const tableName = computed(() => props.store.state.tables.get(props.field.table_id)?.name ?? '');
/** A JUNCTION column (sql/016) compares too — against the other end's table. Null for any other backlink. */
const compareTarget = computed(() => (props.field.type === 'backlink' ? derived.compareTargetTable(props.field) : null));
function toggleCompare(on: boolean) {
  const { compare: _old, ...rest } = props.field.options ?? {};
  void _old;
  if (!on) { props.store.mutate({ type: 'field.update', id: props.field.id, options: rest }); return; }
  const own = fieldsOf(props.store.state, props.field.table_id);
  const pairs = suggestPairs(own.filter((f) => f.id !== props.field.id), fieldsOf(props.store.state, derived.compareTargetTable(props.field) ?? ''), [own[0]?.id ?? '']);
  props.store.mutate({ type: 'field.update', id: props.field.id, options: { ...rest, compare: { pairs } } });
}

/** What a count of this field counts: the table its pills are records of. */
const countedName = computed(() => { const t = derived.pillTableOf(props.field); return (t && props.store.state.tables.get(t)?.name) || 'records'; });
const targetName = computed(() => {
  const id = (props.field.options?.target_table_id as string | undefined) ?? compareTarget.value ?? undefined;
  return (id && props.store.state.tables.get(id)?.name) || '(missing table)';
});

// The contract refuses an unknown vocabulary; the dropdown only offers known ones,
// so an error here would be a bug worth seeing, not a dialog worth designing.
function onVocabulary(id: string) {
  const err = props.actions.setVocabulary(props.field.id, id);
  if (err) console.error(err);
}
</script>

<style scoped>
.field-settings { display: flex; gap: 8px; align-items: center; }
.field-settings.stack { flex-direction: column; align-items: stretch; min-width: 260px; }
.field-settings.row .name { width: 200px; }
.field-settings.row .meta { width: 140px; }
.field-settings.row .choices { flex: 1; }
.vocab { font-size: 11px; }
.vocab-note { flex: 1; }
.field-settings.row .buttons { margin-left: auto; }
/* Text inputs only. Applied to every <input>, this gave checkboxes padding and a
   border box too. */
input:not([type='checkbox']):not([type='color']) {
  background: var(--bg-app); border: 1px solid var(--border-main); color: inherit;
  border-radius: 4px; padding: 3px 6px; font: inherit; min-width: 0;
}
.meta { color: var(--text-muted); font-size: 11px; }
.mono { font-family: ui-monospace, monospace; }
.lookup.broken { color: var(--danger); }
.field-settings.row .lookup { width: auto; }
input[type='checkbox'] { width: auto; flex: none; margin: 0; }
.field-settings.stack .membership, .field-settings.stack .arrow-style, .field-settings.stack .count-tick { align-self: flex-start; }
.membership, .single, .compare-tick, .count-tick { display: flex; gap: 4px; align-items: center; cursor: pointer; color: var(--text-muted); font-size: 11px; white-space: nowrap; }
.arrow-style { display: flex; gap: 6px; align-items: center; color: var(--text-muted); font-size: 11px; }
.arrow-style label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
.arrow-style input[type='color'] { width: 22px; height: 18px; padding: 0; border: 1px solid var(--border-main); background: none; cursor: pointer; }
.clear-color { padding: 0 5px; }
.buttons { display: flex; gap: 4px; align-items: center; }
.primary { color: var(--warning); font-size: 11px; white-space: nowrap; }
button {
  background: none; border: 1px solid var(--border-main); color: var(--text-secondary);
  border-radius: 4px; padding: 2px 8px; cursor: pointer; font: inherit; white-space: nowrap;
}
button:disabled { opacity: 0.35; cursor: default; }
button.danger { color: var(--danger); }
</style>
