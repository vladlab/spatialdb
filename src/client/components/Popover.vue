<!--
  A panel anchored under an element, closed by Escape or a click outside.

  `position: fixed`, placed from the anchor's on-screen rectangle, for the same
  reason as the link picker: it opens from inside the grid's scroller, which
  clips everything. Clicks and keys are stopped at the panel's edge — it lives
  inside a <th> whose click SORTS the column, and inside a scroller whose keydown
  drives the cell selection.
-->
<template>
  <div ref="panel" class="popover" :style="pos" @click.stop @mousedown.stop @dblclick.stop @keydown.stop="onKey">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ anchor?: HTMLElement | null; align?: 'left' | 'right' }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();

const pos = computed(() => {
  const r = props.anchor?.getBoundingClientRect();
  if (!r) return {};
  return props.align === 'right'
    ? { top: `${r.bottom + 2}px`, right: `${Math.max(4, window.innerWidth - r.right)}px` }
    : { top: `${r.bottom + 2}px`, left: `${r.left}px` };
});

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
function onDocDown(e: Event) {
  // Inside clicks never reach here (mousedown.stop above); anything that does is outside.
  if (panel.value && !panel.value.contains(e.target as Node)) emit('close');
}
// Deferred a tick: the mousedown that OPENED us is still bubbling to document.
let armed: ReturnType<typeof setTimeout>;
onMounted(() => { armed = setTimeout(() => document.addEventListener('mousedown', onDocDown), 0); });
onUnmounted(() => { clearTimeout(armed); document.removeEventListener('mousedown', onDocDown); });
</script>

<style scoped>
.popover {
  position: fixed; z-index: 60; padding: 10px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  box-shadow: var(--card-shadow-drag); font-size: 12px; font-weight: 400;
  text-transform: none; color: var(--text-primary); cursor: default;
}
</style>
