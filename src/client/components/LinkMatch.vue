<!--
  A link field's MATCH (contract/match.ts), in its ⚙: what its picker narrows by.

      match   Files.Work = Deliverables.Works   ×
              [ narrow the picker by… ▾ ]

  A pair says two fields SHOULD agree — this file's Work, that deliverable's Works —
  and the picker then offers the agreeing records first and alone, "show all" a tick
  away. It is a default filter, not a rule about the data: nothing stops a link to a
  record that does not agree.

  ONE dropdown rather than two: a pair is only possible between a link-like field
  here and one on the target that lead to the same table, so the possible pairs are
  few and can simply be listed. Nothing to pick when the two tables share no such
  link — said, with what would make it possible.

  A pair whose field has since been deleted is inert; it is shown as broken, with
  its ×. Every change is one field.update (undoable), checked by the same rule the
  server runs.
-->
<template>
  <div class="lm" @keydown.stop>
    <span class="lm-head" :title="`The picker for this field offers the ${targetName} that agree with the record first — and keeps “show all”. A default filter, never a constraint.`">match</span>
    <div class="lm-body">
      <div v-for="(row, i) in rows" :key="row.key" class="lm-pair" :class="{ broken: row.broken }">
        <span class="lm-text">{{ row.text }}</span>
        <button class="x" title="Stop narrowing by this" @click="remove(i)">×</button>
      </div>
      <select v-if="offers.length" class="lm-add" value="" @change="add($event)">
        <option value="">{{ rows.length ? 'and by…' : 'narrow the picker by…' }}</option>
        <option v-for="o in offers" :key="o.key" :value="o.key">{{ o.text }}</option>
      </select>
      <span v-else-if="!rows.length" class="lm-none">nothing to narrow the picker by — {{ ownName }} and {{ targetName }} would both need a link to the same table</span>
      <span v-if="error" class="err">{{ error }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import type { FieldRow } from '../state';
import type { SchemaActions } from '../schemaActions';
import { useDerived } from '../derived';
import { linkMatchOf, matchPairProblem, possiblePairs, type MatchPair } from '../../contract/match';

const props = defineProps<{ store: Store; actions: SchemaActions; field: FieldRow }>();
const derived = useDerived(props.store);

const getField = (id: string) => props.store.state.fields.get(id);
const tableName = (id: string | undefined) => (id && props.store.state.tables.get(id)?.name) || '(missing table)';
const ownName = computed(() => tableName(props.field.table_id));
const targetName = computed(() => tableName(props.field.options?.target_table_id as string | undefined));

const pairs = computed(() => linkMatchOf(props.field));
const text = ([mine, theirs]: MatchPair) =>
  `${ownName.value}.${getField(mine)?.name ?? '(deleted field)'} = ${targetName.value}.${getField(theirs)?.name ?? '(deleted field)'}`;
const rows = computed(() => pairs.value.map((p) => {
  const broken = matchPairProblem(props.field, p, getField) !== null;
  return { key: p.join('='), text: text(p) + (broken ? ' — broken, narrows nothing' : ''), broken };
}));

/** What could still be added. A junction's column holds PAIR ROWS, not records: never a side. */
const isJunctionColumn = (id: string) => { const f = getField(id); return !!f && f.type === 'backlink' && derived.junctionOfBacklink(f) !== null; };
const offers = computed(() => {
  const have = new Set(pairs.value.map((p) => p.join('=')));
  return possiblePairs(props.field, props.store.state.fields.values(), getField)
    .filter((p) => !have.has(p.join('=')) && !isJunctionColumn(p[0]) && !isJunctionColumn(p[1]))
    .map((p) => ({ key: p.join('='), pair: p, text: text(p) }));
});

const error = ref('');
function add(e: Event) {
  const el = e.target as HTMLSelectElement;
  const o = offers.value.find((x) => x.key === el.value);
  el.value = '';
  if (o) error.value = props.actions.setMatch(props.field.id, [...pairs.value, o.pair]) ?? '';
}
function remove(i: number) {
  error.value = props.actions.setMatch(props.field.id, pairs.value.filter((_, k) => k !== i)) ?? '';
}
</script>

<style scoped>
.lm { display: flex; gap: 6px; align-items: baseline; font-size: 11px; color: var(--text-muted); }
.lm-head { flex: none; cursor: help; }
.lm-body { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; min-width: 0; }
.lm-pair { display: flex; gap: 4px; align-items: baseline; color: var(--text-secondary); }
.lm-pair.broken .lm-text { color: var(--danger); }
.lm-add { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 3px; padding: 1px 4px; font: inherit; font-size: 11px; max-width: 100%; }
.lm-none { color: var(--text-faint); font-style: italic; white-space: normal; }
.x { background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; padding: 0 2px; }
.x:hover { color: var(--danger); }
.err { color: var(--danger); }
</style>
