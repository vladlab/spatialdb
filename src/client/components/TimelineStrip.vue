<!--
  A timeline's audio lanes, DRAWN (CANVAS-BRIEF.md B3): one lane per track, its clips
  as blocks on columns every lane shares — so "A1: 30s of tone, then the mix" reads at
  a glance. Not to scale (contract/timelineStrip.ts says why); the timecodes under it
  are the stored labels. All the arithmetic is the contract's; this is the paint.

  `mini` is the canvas card's: every line exactly one card row tall (18px), so the
  card's height arithmetic counts it in rows — lanes, then a line of timecodes, then
  "+N more lanes" when there were more than fit. Without `mini` it is the tray's,
  bigger, every lane.
-->
<template>
  <div v-if="strip" ref="el" class="tls" :class="{ mini }">
    <div v-for="lane in strip.lanes" :key="lane.index" class="tls-lane">
      <span class="tls-label" :title="lane.label">{{ lane.label }}</span>
      <span class="tls-track">
        <span v-for="(c, i) in lane.clips" :key="i" class="tls-clip" :class="`tint-${c.tint}`"
              :style="{ left: c.left + '%', width: `calc(${c.width}% - 2px)` }" :title="c.title">
          <span v-if="fits(c)" class="tls-name">{{ c.name }}</span>
        </span>
      </span>
    </div>
    <div class="tls-lane tls-ticks">
      <span class="tls-label" />
      <span class="tls-track">
        <span v-for="t in ticks" :key="t.x" class="tls-tc" :style="{ left: t.x + '%' }">{{ t.tc }}</span>
      </span>
    </div>
    <div v-if="strip.hidden" class="tls-lane tls-more"><span class="tls-label" /><span>+{{ strip.hidden }} more lane{{ strip.hidden === 1 ? '' : 's' }}</span></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { timelineStrip, ticksThatFit, type StripClip } from '../../contract/timelineStrip';

const props = withDefaults(defineProps<{ value: unknown; mini?: boolean; maxLanes?: number; widthPx?: number }>(), { mini: false, maxLanes: undefined, widthPx: undefined });

/** The lane label column and the gap after it: kept in step with the CSS below. */
const LABEL_W = 58;
const strip = computed(() => timelineStrip(props.value, props.maxLanes ?? Infinity));

/* The track's width in px: given (a card knows its width without measuring), else measured. */
const el = ref<HTMLElement>();
const measured = ref(480);
let ro: ResizeObserver | undefined;
onMounted(() => {
  if (props.widthPx !== undefined || !el.value || typeof ResizeObserver === 'undefined') return;
  ro = new ResizeObserver(([e]) => { measured.value = Math.max(80, e.contentRect.width); });
  ro.observe(el.value);
});
onBeforeUnmount(() => ro?.disconnect());
const trackPx = computed(() => Math.max(40, (props.widthPx ?? measured.value) - LABEL_W));

const ticks = computed(() => (strip.value ? ticksThatFit(strip.value.ticks, trackPx.value, props.mini ? 58 : 68) : []));
/** A clip's name is printed inside it only when it fits; the tooltip always has it. */
const fits = (c: StripClip) => (c.width / 100) * trackPx.value >= c.name.length * (props.mini ? 5.6 : 6.4) + 8;
</script>

<style scoped>
.tls { display: flex; flex-direction: column; font-size: 11px; }
.tls-lane { display: flex; align-items: center; gap: 6px; height: 22px; }
.tls-label { flex: none; width: 52px; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tls-track { position: relative; flex: 1; min-width: 0; height: 16px; }
.tls-clip {
  position: absolute; top: 0; bottom: 0; border-radius: 3px; overflow: hidden;
  background: rgba(var(--tint-rgb), 0.55); border: 1px solid rgba(var(--tint-rgb), 0.9); box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
}
.tls-name { color: var(--text-primary); font-size: 10px; font-weight: 600; white-space: nowrap; padding: 0 3px; }
.tls-ticks .tls-track { height: 14px; }
.tls-tc { position: absolute; top: 0; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; white-space: nowrap; }
.tls-more { color: var(--text-faint); font-style: italic; }

/* On a card: every line exactly one card row (18px) — the card's height counts them as rows. */
.mini .tls-lane { height: 18px; }
.mini .tls-track { height: 12px; }
.mini .tls-ticks .tls-track { height: 12px; }
.mini .tls-tc, .mini .tls-label { font-size: 9.5px; }
.mini .tls-name { font-size: 9px; }
</style>
