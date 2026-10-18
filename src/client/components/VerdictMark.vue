<!--
  A comparison's verdict as an ICON, everywhere one is shown: grid cells, kanban
  cards, canvas cards, the record tray, side by side. It replaced 11px ✓ / ⚠ text
  glyphs (the ✓ at 80% opacity) that were easy to miss — an outlined circle-check,
  warning triangle or circle-x, drawn at a real size and full colour, so a pass and
  a fail are both legible without the weight of a filled badge.

  kind: ok (green, circle-check) · warn (orange, triangle) · bad (red, circle-x).
  size: px, default 16 — sized to sit inside a 30px grid row.
  The `title` (the why) is the wrapper's hover text. The wrapper also carries the
  old glyph (✓ / ⚠ / ✗) as visually hidden text: screen readers and the UI suites
  read the same mark they always did.
-->
<template>
  <span class="verdict-mark" :class="kind" :title="title"><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="kind === 'ok'">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2l4 -4" />
    </template>
    <template v-else-if="kind === 'warn'">
      <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
      <path d="M12 9v4" />
      <path d="M12 16h.01" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 10l4 4m0 -4l-4 4" />
    </template>
  </svg><span class="vm-text">{{ glyph }}</span></span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ kind: 'ok' | 'warn' | 'bad'; size?: number; title?: string }>(), { size: 16 });
const glyph = computed(() => ({ ok: '✓', warn: '⚠', bad: '✗' }[props.kind]));
</script>

<style scoped>
.verdict-mark { flex: none; display: inline-flex; align-items: center; vertical-align: middle; line-height: 0; cursor: help; }
.verdict-mark svg { display: block; }
.vm-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.verdict-mark.ok { color: var(--success); }
.verdict-mark.warn { color: var(--warning); }
.verdict-mark.bad { color: var(--danger); }
</style>
