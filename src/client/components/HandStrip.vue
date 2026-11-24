<!--
  THE HAND (client/hand.ts): the records you are keeping track of, as a strip of stubs
  along the bottom of every view — the table's name on its colour, then the record's.

    click a stub        bring its card UP (alone); again puts it down
    Ctrl/Shift+click    bring it up BESIDE what is up — one or many
    "all up"            the whole hand, side by side
    pin                 float its card at the right, above the view; again unpins
    ×                   out of the hand

  A stub NEVER leaves the strip while its card is up or pinned: it is marked ("up", "●
  pinned"), so nothing here moves when a card comes and goes.

  While a lifted card is being dragged (RecordPanel's strip → `handDrag`), the strip is
  the drop target — and shows itself even when the hand is empty.
-->
<template>
  <div v-if="stubs.length || handDrag" class="hand" :class="{ dropping: !!handDrag, over: handDrag?.over }" role="toolbar" aria-label="Hand: records you are keeping track of">
    <span class="hand-label" title="Your hand: records kept here stay one click away on every view. H on a canvas card, Ctrl+H on a grid row, or a card's “hand” chip.">Hand</span>
    <div class="hand-stubs">
      <div v-for="s in stubs" :key="s.id" class="stub" :class="{ up: s.up, pinned: s.pinned }" :data-record="s.id">
        <button class="stub-main" type="button" :title="s.pinned ? `${s.table} · ${s.name} — pinned at the right` : s.up ? `${s.table} · ${s.name} — up. Click to put it down` : `${s.table} · ${s.name} — click to bring it up (Ctrl+click: beside what is up)`"
                @click="onStub(s, $event)">
          <span class="stub-table" :style="{ background: s.color, color: textOn(s.color) }">{{ s.table }}</span>
          <span class="stub-name" :class="{ empty: !s.name }">{{ s.name || 'untitled' }}</span>
          <span v-if="s.up" class="stub-state">up</span>
        </button>
        <button class="stub-pin" type="button" :aria-pressed="s.pinned" :title="s.pinned ? 'Unpin: its card leaves the right of the view; the stub stays' : 'Pin: float its card at the right, above the view'" @click="onPin(s)">{{ s.pinned ? '● pinned' : 'pin' }}</button>
        <button class="stub-x" type="button" title="Take it out of the hand" @click="drop(s.id)">×</button>
      </div>
      <span v-if="handDrag" class="hand-drop">{{ handDrag.over ? 'Let go: it stays in your hand' : 'Drop the card here to keep it in your hand' }}</span>
    </div>
    <button v-if="stubs.filter((s) => !s.pinned).length > 1" class="hand-all" type="button" title="Bring every card in the hand up, side by side" @click="allUp">all up</button>
  </div>
  <!-- The stub that follows the pointer while a lifted card is dragged here. -->
  <div v-if="handDrag && ghost" class="stub hand-ghost" :style="{ left: handDrag.x + 12 + 'px', top: handDrag.y + 10 + 'px' }" aria-hidden="true">
    <span class="stub-main"><span class="stub-table" :style="{ background: ghost.color, color: textOn(ghost.color) }">{{ ghost.table }}</span><span class="stub-name">{{ ghost.name || 'untitled' }}</span></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { textOn } from '../colorText';
import { drop, hand, handDrag, isUp, lift, lifted, pin, putDown, unpin } from '../hand';

const props = defineProps<{ store: Store; labelOf: (recordId: string) => string }>();
const emit = defineEmits<{ /** A pinned record's stub was clicked: its floating card should show itself. */ ring: [id: string] }>();

function look(id: string) {
  const rec = props.store.state.records.get(id);
  const t = rec ? props.store.state.tables.get(rec.table_id) : undefined;
  return { table: t?.name ?? 'record', color: t?.color || 'var(--card-head-bg)', name: rec ? props.labelOf(id) : '' };
}
/** A held record that is not here yet (its table is still loading after a reload) has no stub yet. */
const stubs = computed(() => hand.value.filter((h) => props.store.state.records.has(h.id))
  .map((h) => ({ id: h.id, tableId: h.table, pinned: !!h.pinned, up: isUp(h.id), ...look(h.id) })));
const ghost = computed(() => (handDrag.value ? look(handDrag.value.id) : null));

type Stub = (typeof stubs.value)[number];
function onStub(s: Stub, e: MouseEvent) {
  if (s.pinned) { emit('ring', s.id); return; }
  if (s.up) { putDown(s.id); return; }
  lift(s.id, e.ctrlKey || e.metaKey || e.shiftKey);
}
function onPin(s: Stub) { if (s.pinned) unpin(s.id); else pin(s.id, s.tableId); }
function allUp() { lifted.value = stubs.value.filter((s) => !s.pinned).map((s) => s.id); }
</script>

<style scoped>
/* A real strip, in the stage's last row: it takes its own height (once, when the hand
   gets its first card) and covers nothing. One row; more stubs than fit scroll sideways. */
.hand { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px; box-sizing: border-box; min-width: 0;
  background: var(--bg-chrome); border-top: 1px solid var(--border-main); font-size: 12px; }
.hand.dropping { box-shadow: inset 0 2px 0 var(--accent); }
.hand.over { background: var(--bg-well); }
.hand-label { flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); cursor: default; }
.hand-stubs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
/* A STUB: the top of a card — the table's colour and name, then the record's. */
.stub { flex: none; display: inline-flex; align-items: stretch; height: 24px; max-width: 320px; border: 1px solid var(--card-border); border-radius: 5px; overflow: hidden;
  background: var(--card-bg); color: var(--text-primary); box-shadow: var(--card-shadow); }
.stub button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.stub-main { display: inline-flex; align-items: stretch; min-width: 0; }
.stub-table { flex: none; display: inline-flex; align-items: center; padding: 0 7px; font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.stub-name { display: inline-flex; align-items: center; min-width: 0; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.stub-name.empty { color: var(--text-faint); font-style: italic; }
.stub-state { display: inline-flex; align-items: center; padding-right: 8px; font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
/* Up or pinned: the stub stays, its edge in the accent — and it SAYS so ("up", "● pinned"). */
.stub.up, .stub.pinned { border-color: var(--accent); }
.stub-pin { flex: none; padding: 0 7px !important; border-left: 1px solid var(--card-border) !important; font-size: 9px !important; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted) !important; }
.stub-pin:hover, .stub.pinned .stub-pin { color: var(--text-primary) !important; }
.stub-x { flex: none; width: 20px; border-left: 1px solid var(--card-border) !important; font-size: 14px !important; line-height: 1; color: var(--text-muted) !important; }
.stub-x:hover { color: var(--text-primary) !important; }
.hand-drop { flex: none; padding: 0 10px; color: var(--text-muted); font-style: italic; white-space: nowrap; }
.hand-all { flex: none; height: 22px; padding: 0 9px; background: none; border: 1px solid var(--border-main); border-radius: 4px; color: var(--text-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.hand-all:hover { color: var(--text-primary); border-color: var(--text-muted); }
.hand-ghost { position: fixed; z-index: 400; pointer-events: none; opacity: 0.95; }
</style>
