<!--
  A STACK's frame on the canvas: the well the cards sit in, and its label bar.

  The cards inside are ordinary RecordCards drawn by the canvas at the positions
  contract/canvasStack.ts `stackLayout` gives them; this component is only the
  frame — a labelled rectangle under them — so a stack adds no second kind of card.
  The label bar says what the stack IS (its name, or the filter read aloud) and
  what it HOLDS (how many; how many matching cards are placed elsewhere; whether
  the cap was hit). Dragging the bar moves the stack and everything in it; its
  right edge resizes; a double-click on that edge fits the width to the cards.
-->
<template>
  <div class="stack" :class="[{ selected, collapsed, over: dropState === 'over', refused: dropState === 'refused', empty: !count && !stale }]"
       :style="{ transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.w}px`, height: `${rect.h}px` }"
       @contextmenu.prevent.stop="$emit('menu', { stackId: id, x: $event.clientX, y: $event.clientY })">
    <header class="stack-head" :style="{ '--table-color': color }" @pointerdown="onHeadDown" @dblclick.stop="$emit('edit', id)">
      <button class="stack-fold" :title="collapsed ? 'Unfold' : 'Fold'" @pointerdown.stop @dblclick.stop @click.stop="$emit('fold', id)">{{ collapsed ? '▸' : '▾' }}</button>
      <div class="stack-text">
        <div class="stack-name">
          <span class="stack-table">{{ tableName }}</span>
          <span class="stack-label" :class="{ auto: !name }">{{ name || description }}</span>
          <span class="stack-n" :title="`${count} card${count === 1 ? '' : 's'} match`">{{ count }}</span>
        </div>
        <div class="stack-sub">
          <span v-if="name" class="stack-filter" :title="description">{{ description }}</span>
          <span v-if="overCap" class="stack-warn" :title="`${total} records match — only the first ${count} are placed. Narrow the filter.`">⚠ {{ total }} match, {{ count }} placed</span>
          <span v-if="stale" class="stack-stale" title="Cards whose records no longer match the filter — dimmed, at the bottom">{{ stale }} no longer match</span>
          <!-- Matching cards that are ON the canvas but not in here: said, never moved on their own. -->
          <button v-if="elsewhere" class="stack-gather" :title="`${elsewhere} matching card${elsewhere === 1 ? ' is' : 's are'} placed elsewhere on this canvas. Move ${elsewhere === 1 ? 'it' : 'them'} into the stack (one Ctrl+Z).`"
                  @pointerdown.stop @dblclick.stop @click.stop="$emit('gather', id)">{{ elsewhere }} elsewhere · gather</button>
        </div>
      </div>
      <button class="stack-edit" title="Edit this stack's filter, sort and name" @pointerdown.stop @dblclick.stop @click.stop="$emit('edit', id)">⚙</button>
    </header>
    <p v-if="!collapsed && !count && !stale" class="stack-none">{{ loading ? 'loading…' : 'nothing matches' }}</p>
    <div class="stack-handle-e" title="Drag to resize · double-click to fit the cards" @pointerdown.stop="$emit('resize', { stackId: id, e: $event })" @dblclick.stop="$emit('fit', id)" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  tableName: string;
  color: string;
  name?: string;
  /** The filter, read aloud (contract/canvasStack.ts `describeFilters`). */
  description: string;
  /** Cards in the stack that match; the total the filter matched (over the cap, these differ). */
  count: number;
  total: number;
  overCap: boolean;
  elsewhere: number;
  stale: number;
  collapsed: boolean;
  selected: boolean;
  loading: boolean;
  /** While a card is dragged over it: it would take the card (`over`); it just refused one (`refused`). */
  dropState?: 'over' | 'refused' | null;
}>();
const emit = defineEmits<{
  (e: 'pointerdown', payload: { stackId: string; e: PointerEvent }): void;
  (e: 'menu', payload: { stackId: string; x: number; y: number }): void;
  (e: 'resize', payload: { stackId: string; e: PointerEvent }): void;
  (e: 'fit', stackId: string): void;
  (e: 'fold', stackId: string): void;
  (e: 'gather', stackId: string): void;
  (e: 'edit', stackId: string): void;
}>();
function onHeadDown(e: PointerEvent) { emit('pointerdown', { stackId: props.id, e }); }
</script>

<style scoped>
/* A WELL, as the tree draws its deepest level: recessed, so the cards read as sitting
   IN something. Under the cards (the canvas draws it first), taking pointer events only
   on its bar and edge — the cards and the empty canvas between them stay reachable. */
.stack {
  position: absolute; top: 0; left: 0; box-sizing: border-box; will-change: transform;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid var(--border-main); border-radius: 8px;
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  font-size: 12px;
}
.stack.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring), inset 0 2px 5px rgba(0, 0, 0, 0.45); }
.stack.over { border-color: var(--accent); border-style: dashed; }
.stack.refused { animation: stack-refused 0.7s ease-out 1; }
@keyframes stack-refused {
  0%, 35% { outline: 2px solid var(--danger); outline-offset: 2px; }
  100% { outline: 2px solid transparent; outline-offset: 2px; }
}
.stack-head {
  pointer-events: auto; cursor: grab;
  display: flex; align-items: center; gap: 6px; box-sizing: border-box; height: 40px; padding: 0 6px 0 4px;
  border-bottom: 1px solid var(--border-main); border-radius: 7px 7px 0 0;
  background: var(--controls-bg);
  border-left: 4px solid var(--table-color, var(--border-main));
}
.stack.collapsed .stack-head { border-bottom: none; border-radius: 7px; }
.stack-fold { border: none; background: none; color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 10px; width: 14px; padding: 0; flex: none; }
.stack-text { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.stack-name { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; font-size: 13px; color: var(--text-primary); }
.stack-table { color: var(--text-faint); font-size: 10px; font-weight: 400; text-transform: uppercase; letter-spacing: 0.06em; flex: none; }
.stack-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.stack-label.auto { font-weight: 500; }
.stack-n { flex: none; color: var(--text-muted); font-weight: 400; font-size: 11px; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 9px; padding: 0 6px; line-height: 16px; }
.stack-sub { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.stack-filter { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.stack-warn { color: var(--warning); cursor: help; }
.stack-stale { color: var(--warning); }
.stack-gather { border: 1px solid var(--accent); background: none; color: var(--accent); border-radius: 8px; padding: 0 6px; line-height: 15px; font: inherit; font-size: 10.5px; cursor: pointer; flex: none; }
.stack-gather:hover { background: var(--accent); color: #fff; }
.stack-edit { border: none; background: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: 13px; padding: 0 2px; flex: none; opacity: 0; }
.stack:hover .stack-edit, .stack.selected .stack-edit { opacity: 1; }
.stack-edit:hover { color: var(--accent); }
.stack-none { margin: 0; padding: 10px 12px; color: var(--text-faint); font-style: italic; }
.stack-handle-e { pointer-events: auto; position: absolute; top: 0; right: -4px; width: 9px; height: 100%; cursor: ew-resize; }
</style>
