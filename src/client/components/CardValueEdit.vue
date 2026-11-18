<!--
  A VALUE ON A CARD, typed in where it stands — a text, number, date or size row, or the
  card's title. Long text, links, selects and summaries are not: they keep their own
  ways (the owner, Nov 18 2026).

  The rule is the canvas note's (CanvasNote.vue): the first click on a card selects it;
  a click — a press and release that did not travel — on a value of a card that is
  ALREADY selected types in it; a press that travels still drags the card. The release
  is heard on the WINDOW, because the card captures the pointer for its drag and a
  browser sends a captured pointer's click to the card, never to what is inside it.

  The editor is the grid's (CellEditor.vue), so the rules are the grid's: Enter or
  leaving saves, Esc puts the old value back, a value the field refuses stays open with
  a red ring, nothing is written if nothing changed. One edit, one Ctrl+Z.
-->
<template>
  <span class="cve" :class="{ live: editing, armed: armed && !editing }"
        @pointerdown="onPointerDown" @dblclick="editing && $event.stopPropagation()" @click="editing && $event.stopPropagation()"
        @contextmenu="editing && $event.stopPropagation()" @wheel="editing && $event.stopPropagation()">
    <CellEditor v-if="editing" :field="field" :value="value" :block="block"
                @set="(k, v) => $emit('set', k, v)" @unset="(k) => $emit('unset', k)" @done="$emit('done')" @cancel="$emit('done')" />
    <slot v-else />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import CellEditor from './CellEditor.vue';

const props = defineProps<{
  field: { key: string; type: string; options: Record<string, unknown> };
  value: unknown;
  /** The canvas's answer to `start`: this is the value being typed in. */
  editing?: boolean;
  /** The card is selected (alone): only then does a click type here. Read at the PRESS. */
  armed?: boolean;
  /** The title: a text typed in a box of this many lines that wraps, as the title does. */
  block?: number;
}>();
const emit = defineEmits<{ start: []; done: []; set: [key: string, value: unknown]; unset: [key: string] }>();

let downAt: { x: number; y: number } | null = null;
let armedAtDown = false;
function onPointerDown(e: PointerEvent) {
  // While typing, the pointer is the editor's: the card must not start a drag.
  if (props.editing) { e.stopPropagation(); return; }
  if (e.button !== 0) return;
  downAt = { x: e.clientX, y: e.clientY };
  armedAtDown = !!props.armed;
  stopWatching();
  window.addEventListener('pointerup', onRelease);
  window.addEventListener('pointercancel', stopWatching);
}
function stopWatching() {
  window.removeEventListener('pointerup', onRelease);
  window.removeEventListener('pointercancel', stopWatching);
}
function onRelease(e: PointerEvent) {
  stopWatching();
  const at = downAt; downAt = null;
  if (props.editing || !armedAtDown || !at || e.button !== 0) return;
  if (Math.hypot(e.clientX - at.x, e.clientY - at.y) > 4) return;      // it travelled: the card was dragged
  emit('start');
}
onBeforeUnmount(stopWatching);
</script>

<style scoped>
.cve.armed { cursor: text; }
/* While typing the value has the rest of its row; the text is the input's to scroll. */
.cve.live { flex: 1; min-width: 0; text-overflow: clip; }
</style>
