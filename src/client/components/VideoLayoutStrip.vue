<!--
  A video layout, DRAWN: the blocks of a file in order — black, bars, slate,
  program, textless — with its markers as pins and the timecodes that were TYPED
  under the blocks they belong to. Everything about where things go is
  `stripLayout` in contract/videoLayout.ts; this file is the paint.

  The scale is not true to time (see `stripLayout`: a log of the length, and a
  fixed width for an open block). The strip says WHAT is on the file and in what
  order; the numbers say where.

  `mini` is the same strip at the height of a grid row or a card row: colours and
  pins only, no words. It is drawn beside the one-line summary, never instead of it.
-->
<template>
  <span v-if="strip && strip.blocks.length" ref="el" class="vls" :class="{ mini }">
    <span v-if="!mini && strip.markerRows" class="vls-marks" :style="{ height: strip.markerRows * MARK_ROW + 'px' }">
      <template v-for="m in strip.markers" :key="m.item">
        <span class="vls-stem" :style="{ left: m.x + '%', top: (strip.markerRows - 1 - m.row) * MARK_ROW + 11 + 'px' }" />
        <span class="vls-mark" :style="{ ...side(m.x, m.align), top: (strip.markerRows - 1 - m.row) * MARK_ROW + 'px' }"><span class="vls-mark-name">{{ m.label }}</span><span v-if="m.tc" class="vls-num">{{ m.tc }}</span></span>
      </template>
    </span>
    <span class="vls-track">
      <span v-for="(b, i) in strip.blocks" :key="i" class="vls-block" :class="[`vl-k-${b.kind}`, { open: b.open, warn: b.warn }]"
            :style="{ left: b.left + '%', width: `calc(${b.width}% - ${GAP}px)` }" :title="tip(b)">
        <template v-if="!mini"><span class="vls-name">{{ b.kind === 'gap' ? 'gap' : b.label }}</span><span class="vls-sub">{{ b.sub }}</span></template>
      </span>
      <span v-for="m in strip.markers" :key="'p' + m.item" class="vls-pin" :style="{ left: m.x + '%' }" :title="[m.label, m.tc].filter(Boolean).join(' ')" />
    </span>
    <span v-if="!mini && strip.tcRows" class="vls-tcs" :style="{ height: strip.tcRows * TC_ROW + 'px' }">
      <template v-for="(b, i) in strip.blocks" :key="i">
        <span v-if="b.tcRow >= 0" class="vls-tc vls-num" :style="{ ...side(b.left, b.tcAlign), top: b.tcRow * TC_ROW + 'px' }">{{ b.tc }}</span>
      </template>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { VideoLayout, stripLayout, type StripBlock } from '../../contract/videoLayout';

const props = defineProps<{ value: unknown; mini?: boolean }>();

const MARK_ROW = 14, TC_ROW = 13, GAP = 2;

// The strip's real width, when the browser can say: labels are kept off each other
// by an estimate of their size against it. (happy-dom has no layout; the default stands.)
const el = ref<HTMLElement | null>(null);
const width = ref(420);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (props.mini || typeof ResizeObserver === 'undefined' || !el.value) return;
  ro = new ResizeObserver(() => { const w = el.value?.clientWidth ?? 0; if (w > 0) width.value = w; });
  ro.observe(el.value);
});
onBeforeUnmount(() => ro?.disconnect());

const strip = computed(() => {
  const r = VideoLayout.safeParse(props.value);
  return r.success ? stripLayout(r.data, width.value) : null;
});

const side = (x: number, align: 'left' | 'right') => (align === 'left' ? { left: x + '%' } : { right: 100 - x + '%' });
const tip = (b: StripBlock) => (b.kind === 'gap' ? `${b.sub} not accounted for` : [b.label, b.sub, b.tc ? `from ${b.tc}` : ''].filter(Boolean).join(' · '));
</script>

<style scoped>
.vls { display: block; width: 100%; min-width: 0; }
.vls-marks, .vls-track, .vls-tcs { display: block; position: relative; }
.vls-track { height: 32px; }
.vls-block { position: absolute; top: 0; bottom: 0; box-sizing: border-box; border-radius: 3px; padding: 3px 4px; overflow: hidden; display: flex; flex-direction: column; justify-content: center; line-height: 1.25; }
/* Clipped, not ellipsed: in a 40px block "Blac" says more than "Bl…" (the list below has the whole name). */
.vls-name { font-size: 10.5px; font-weight: 600; white-space: nowrap; overflow: hidden; }
.vls-sub { font-size: 10px; white-space: nowrap; overflow: hidden; opacity: 0.85; }
/* OPEN: a length nobody knows. The right edge is torn, not closed. */
.vls-block.open { border-right: 2px dashed currentColor; border-top-right-radius: 0; border-bottom-right-radius: 0; }
.vls-block.warn { outline: 1px solid var(--danger); outline-offset: -1px; }
.vls-pin { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 1.5px solid var(--text-primary); pointer-events: auto; }
.vls-stem { position: absolute; bottom: 0; width: 0; border-left: 1.5px solid var(--text-primary); }
.vls-mark { position: absolute; white-space: nowrap; font-size: 10px; line-height: 12px; color: var(--text-primary); padding: 0 3px; }
.vls-mark .vls-num { margin-left: 4px; }
.vls-mark-name:empty + .vls-num { margin-left: 0; }
.vls-tcs { margin-top: 3px; }
.vls-tc { position: absolute; white-space: nowrap; color: var(--text-primary); line-height: 12px; }
.vls-num { font-family: ui-monospace, monospace; font-size: 10px; }

.vls.mini { display: inline-block; width: 84px; vertical-align: middle; margin-right: 7px; flex: none; }
.vls.mini .vls-track { height: 10px; }
.vls.mini .vls-block { padding: 0; border-radius: 2px; --vl-a: 0.6; }
.vls.mini .vls-block.open { border-right-width: 1px; }
.vls.mini .vls-pin { top: -2px; bottom: -2px; border-left-width: 1px; }
</style>

<!-- The KIND colours, unscoped: the editor's swatches wear the same classes. -->
<style>
/* A tint at --vl-a: quiet behind words in the full strip, stronger (set by the mini
   strip and the editor's swatches) where the colour is all there is. */
.vl-k-black { background: #0b0b0b; color: #9a9a9a; box-shadow: inset 0 0 0 1px #4a4a4a; }
.vl-k-bars { background: rgba(255, 193, 7, var(--vl-a, 0.2)); color: #e6bd55; }
.vl-k-slate { background: rgba(171, 130, 255, var(--vl-a, 0.22)); color: #bfaaf7; }
.vl-k-picture { background: rgba(66, 165, 245, var(--vl-a, 0.24)); color: #86c5f9; }
.vl-k-textless { background: rgba(38, 198, 166, var(--vl-a, 0.2)); color: #62d6bf; }
.vl-k-other { background: rgba(255, 255, 255, calc(var(--vl-a, 0.18) * 0.5)); color: var(--text-secondary); }
.vl-k-gap { background: repeating-linear-gradient(135deg, transparent 0 4px, rgba(255, 152, 0, 0.22) 4px 8px); color: var(--warning); box-shadow: inset 0 0 0 1px rgba(255, 152, 0, 0.45); }
</style>
