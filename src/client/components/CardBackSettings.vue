<!--
  The BACK of this table's cards (CANVAS-BRIEF.md C2, contract/cardBack.ts), in Table
  settings: what an examined card shows when it is flipped. Every field by default
  (under the table's section names); or a chosen list, in a chosen order. Each change
  is one table.update, one Ctrl+Z.
-->
<template>
  <section class="cb">
    <h3>Card back <span class="hint">— what a card shows when you examine it (Space) and flip it (F), on every canvas</span></h3>
    <div class="cb-mode" role="radiogroup" aria-label="Card back">
      <label><input type="radio" name="cb-mode" :checked="!chosen" @change="save(null)" /> every field <span class="hint">(by section)</span></label>
      <label><input type="radio" name="cb-mode" :checked="!!chosen" @change="choose" /> chosen fields</label>
    </div>
    <ol v-if="chosen" class="cb-list">
      <li v-for="(f, i) in ordered" :key="f.id" class="cb-row" :class="{ off: !onSet.has(f.id) }">
        <label class="cb-on"><input type="checkbox" :checked="onSet.has(f.id)" @change="toggle(f.id)" /> {{ f.name }}</label>
        <span class="cb-moves">
          <button type="button" class="cb-mv" :disabled="!onSet.has(f.id) || i === 0" :aria-label="`Move ${f.name} up`" title="Up" @click="move(f.id, -1)">↑</button>
          <button type="button" class="cb-mv" :disabled="!onSet.has(f.id) || i >= chosen.length - 1" :aria-label="`Move ${f.name} down`" title="Down" @click="move(f.id, 1)">↓</button>
        </span>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { SYSTEM_FIELD_TYPES } from '../../contract/systemFields';
import { CardBack } from '../../contract/cardBack';

const props = defineProps<{ store: Store; tableId: string }>();

const fields = computed(() => fieldsOf(props.store.state, props.tableId).filter((f) => !SYSTEM_FIELD_TYPES.has(f.type)));
const chosen = computed<string[] | null>(() => {
  const raw = props.store.state.tables.get(props.tableId)?.card_back;
  if (raw === null || raw === undefined) return null;
  const p = CardBack.safeParse(raw);
  return p.success ? p.data.filter((id) => fields.value.some((f) => f.id === id)) : null;
});
const onSet = computed(() => new Set(chosen.value ?? []));
/** The chosen fields in their order, then the rest in schema order (unticked). */
const ordered = computed(() => {
  const byId = new Map(fields.value.map((f) => [f.id, f]));
  const on = (chosen.value ?? []).map((id) => byId.get(id)!).filter(Boolean);
  return [...on, ...fields.value.filter((f) => !onSet.value.has(f.id))];
});

function save(next: string[] | null) { props.store.mutate({ type: 'table.update', id: props.tableId, cardBack: next }); }
/** Switching to "chosen" starts from every field, so nothing vanishes until unticked. */
function choose() { save(fields.value.map((f) => f.id)); }
function toggle(id: string) {
  const list = chosen.value ?? [];
  save(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}
function move(id: string, dir: -1 | 1) {
  const list = [...(chosen.value ?? [])];
  const i = list.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  save(list);
}
</script>

<style scoped>
.cb { margin: 12px 0; padding: 10px; border: 1px solid var(--border-main); border-radius: 6px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
h3 { margin: 0 0 2px; font-size: 12px; font-weight: 600; }
h3 .hint, .hint { font-weight: 400; color: var(--text-faint); }
.cb-mode { display: flex; flex-wrap: wrap; gap: 14px; }
.cb-mode label, .cb-on { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.cb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; }
.cb-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px; border-radius: 4px; }
.cb-row:hover { background: var(--bg-app); }
.cb-row.off .cb-on { color: var(--text-muted); }
.cb-moves { display: flex; gap: 2px; }
.cb-mv { width: 26px; height: 24px; background: var(--bg-app); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; cursor: pointer; font: inherit; }
.cb-mv:disabled { opacity: 0.3; cursor: default; }
</style>
