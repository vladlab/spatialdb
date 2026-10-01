<!--
  Pills in a ONE-LINE grid cell, with an honest "+N". A cell cannot know how many
  of its pills fit until it is laid out, so this measures: after each render (and
  whenever the cell is resized — a column drag), the pills that end past the cell's
  right edge, less the room the badge needs, are hidden, and the badge says how
  many. Pills keep their natural width: three shrunken stubs looked like an empty
  cell, which is the opposite of what the cell must say. With room for every pill
  there is no badge at all.

  The slot is the pills (RecordPill) in order; `total` is how many there are.
  Clicking the badge opens the record (`open`), where the whole list is.
-->
<template>
  <span ref="el" class="pills cellpills" :class="{ measured }">
    <slot />
    <button v-if="hidden > 0" class="more" :title="`${total} here — open the record to see them all`"
            @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('open')">+{{ hidden }}</button>
  </span>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue';

const props = defineProps<{ total: number }>();
defineEmits<{ open: [] }>();
const el = ref<HTMLElement>();
const hidden = ref(0);
const measured = ref(false);
const BADGE = 34;   // room kept for "+NN"

function measure() {
  const root = el.value;
  if (!root) return;
  const pills = [...root.querySelectorAll<HTMLElement>(':scope > .pill')];
  for (const p of pills) p.classList.remove('cut');
  const width = root.clientWidth;
  if (!width || !pills.length) { hidden.value = 0; measured.value = true; return; }
  const left = root.getBoundingClientRect().left;
  // How many fit whole, with the badge's room reserved once anything is cut.
  let fit = pills.length;
  for (let i = 0; i < pills.length; i++) {
    const r = pills[i]!.getBoundingClientRect();
    // Half a pixel of grace: `clientWidth` is a whole number and a pill's edge is not, so
    // in a column exactly as wide as its pills the last one "overflowed" by 0.4px — and
    // was hidden behind a +1 with all the room in the world.
    if (r.right - left > width + 0.5 - (i + 1 < pills.length ? BADGE : 0)) { fit = i; break; }
  }
  // At least one pill shows, cut if it must — an empty cell would lie.
  fit = Math.max(fit, 1);
  for (let i = fit; i < pills.length; i++) pills[i]!.classList.add('cut');
  hidden.value = props.total - fit;
  measured.value = true;
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  void nextTick(measure);
  if (typeof ResizeObserver !== 'undefined' && el.value) { ro = new ResizeObserver(() => measure()); ro.observe(el.value); }
});
onUpdated(() => void nextTick(measure));
onBeforeUnmount(() => ro?.disconnect());
</script>

<style scoped>
.cellpills { flex-wrap: nowrap; overflow: hidden; min-width: 0; max-width: 100%; position: relative; align-self: stretch; }
.more {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  flex: none; background: var(--controls-bg); border: 1px solid var(--accent); color: var(--accent); border-radius: 10px;
  font: inherit; font-size: 10px; font-weight: 600; line-height: 16px; padding: 0 6px; cursor: pointer;
}
.more:hover { background: var(--accent); color: #fff; }
</style>
