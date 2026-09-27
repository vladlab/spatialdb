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

/**
 * ALWAYS FULLY ON SCREEN. Placed under the anchor's left edge, then pulled back so it
 * does not run off the right of the window (it did, for the rightmost columns);
 * likewise for the bottom. Measured after mount and on every resize, because the
 * panel's own size is what decides the pull-back.
 */
const size = ref({ w: 0, h: 0 });
const pos = computed(() => {
  const r = props.anchor?.getBoundingClientRect();
  if (!r) return {};
  const M = 6, W = window.innerWidth, H = window.innerHeight;
  let left = props.align === 'right' ? r.right - size.value.w : r.left;
  left = Math.max(M, Math.min(left, W - size.value.w - M));
  let top = r.bottom + 2;
  if (size.value.h && top + size.value.h > H - M) top = Math.max(M, H - size.value.h - M);
  return { top: `${top}px`, left: `${left}px` };
});
function measure() { if (panel.value) size.value = { w: panel.value.offsetWidth, h: panel.value.offsetHeight }; }
let ro: ResizeObserver | undefined;

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
function onDocDown(e: Event) {
  // Inside clicks never reach here (mousedown.stop above); anything that does is outside.
  if (panel.value && !panel.value.contains(e.target as Node)) emit('close');
}
// Deferred a tick: the mousedown that OPENED us is still bubbling to document.
let armed: ReturnType<typeof setTimeout>;
onMounted(() => {
  armed = setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  measure();
  if (typeof ResizeObserver !== 'undefined' && panel.value) { ro = new ResizeObserver(measure); ro.observe(panel.value); }
  window.addEventListener('resize', measure);
});
onUnmounted(() => { clearTimeout(armed); document.removeEventListener('mousedown', onDocDown); ro?.disconnect(); window.removeEventListener('resize', measure); });
</script>

<style scoped>
.popover {
  position: fixed; z-index: 60; padding: 10px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 6px;
  box-shadow: var(--card-shadow-drag); font-size: 12px; font-weight: 400;
  text-transform: none; color: var(--text-primary); cursor: default;
}
</style>
