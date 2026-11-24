<!--
  LIFTED CARDS: records brought UP over the view's body — any view (the bars, the hand
  and the pinned cards stay as they are). App.vue draws this; client/hand.ts holds the
  line. A card flies up from where it came from — its card on the canvas, or its stub
  in the hand — or fades in when it has neither (a grid row, the palette); a canvas
  card's place is kept by a see-through copy (RecordCard `examined`) meanwhile.

  A lifted card is the record's OPEN CARD (RecordPanel): the full record, every field,
  editable. From here it can be PLACED on the canvas, kept in the HAND (its chip, or
  drag its strip down onto the hand) or PINNED at the right. Put down, a record that is
  not in the hand simply goes away. It is as tall as its fields, up to the height of
  the view, and scrolls inside itself.

  There is no flip here: turning a card over is kept for the compare pair
  (CompareExamine.vue).

  A LINE OF CARDS: a double-click on a linked record's pill (a single click selects the
  pill, as everywhere a link is edited) brings THAT record's card up too, at the right;
  so does Ctrl+click on a stub in the hand. The line is never scaled — these cards are
  typed into; one too long for the view scrolls sideways.

  KEYS: a card owns its own (RecordPanel) — Esc inside a card puts that card down.
  With no card focused, Space or Esc put the whole line down, as a click outside does.
  Nothing reaches the view behind. Nothing about what is lifted is saved.

  Motion is transform and opacity only. With "Card animations" off (Settings › This
  browser) or the OS asking for reduced motion, flights are fades.
-->
<template>
  <div ref="root" class="ex" tabindex="-1" role="dialog" aria-modal="true" aria-label="Lifted cards"
       @keydown.stop="onKey" @keyup.stop @pointerdown.stop @wheel.stop @dblclick.stop @contextmenu.stop>
    <button class="ex-scrim" :class="{ out: leaving }" type="button" tabindex="-1" aria-label="Put the cards back" @click="close" />
    <div ref="line" class="ex-line" @click.self="close">
      <!-- A SLOT is the card's place in the line; it is what flies. -->
      <div v-for="id in ids" :key="id" :ref="(el) => setSlot(id, el as HTMLElement | null)" class="ex-slot" :data-record="id" :style="{ width: W + 'px' }">
        <RecordPanel :store="store" :record-id="id" pinnable :place="place?.(id)"
                     @close="emit('put', id)" @pin="emit('pin', id)" @place="emit('place', id)" @open="pull"
                     @open-board="(r: string) => emit('open-board', r)" @open-report="(r: string) => emit('open-report', r)" @open-calendar="(r: string) => emit('open-calendar', r)" />
      </div>
    </div>
    <p class="ex-hint" :class="{ out: leaving }">Double-click a linked record to bring its card up · drag a card to the hand to keep it · Space or Esc put them down</p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { Store } from '../store';
import RecordPanel from './RecordPanel.vue';
import { cardAnimations } from '../prefs';
import { CARD_W } from '../hand';

const props = defineProps<{
  store: Store;
  /** The line: the record lifted first, then every one brought up after it. */
  ids: string[];
  /** Where a record's card is on the canvas now (null: not on it) — asked again on the way back down. */
  fromRect: (recordId: string) => DOMRect | null;
  /** On a canvas: 'show' for a record that has a card on it, 'place' for one that has not. Elsewhere there is nowhere to place. */
  place?: (recordId: string) => 'place' | 'show' | undefined;
}>();
const emit = defineEmits<{
  close: []; pull: [id: string];
  /** One card put back (its × or Esc inside it); the canvas ends the line when it was the last. */
  put: [id: string];
  pin: [id: string]; place: [id: string];
  'open-board': [id: string]; 'open-report': [id: string]; 'open-calendar': [id: string];
}>();

/** A lifted card's width: fixed, whatever the canvas's zoom (client/hand.ts). */
const W = CARD_W;
const root = ref<HTMLElement>();
const line = ref<HTMLElement>();
const slots = new Map<string, HTMLElement>();
const setSlot = (id: string, el: HTMLElement | null) => { if (el) slots.set(id, el); else slots.delete(id); };
const leaving = ref(false);

const motion = () => cardAnimations.value && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
/** The transform that puts a slot exactly over `r` (top-left anchored, uniform scale by width). */
function over(el: HTMLElement, r: DOMRect): string | null {
  const to = el.getBoundingClientRect();
  return to.width ? `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width})` : null;
}
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/** A card arrives: up from its place on the canvas if it has one, else it fades in. */
function arrive(id: string) {
  const el = slots.get(id);
  if (!el || typeof el.animate !== 'function') return;
  const from = props.fromRect(id);
  const t = from && motion() ? over(el, from) : null;
  if (t) el.animate([{ transform: t, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: EASE });
  else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
}

onMounted(async () => {
  await nextTick();
  root.value?.focus({ preventScroll: true });
  for (const id of props.ids) arrive(id);
});

/* A card joins or leaves the line: the ones that stay SLIDE to their new places (nothing
   jumps), a new one arrives at the right end, and the line scrolls to show it. */
watch(() => [...props.ids], async (now, before) => {
  const was = new Map((before ?? []).map((id) => [id, slots.get(id)?.getBoundingClientRect()] as const));
  await nextTick();
  for (const id of now) {
    const el = slots.get(id);
    if (!el || typeof el.animate !== 'function') continue;
    const old = was.get(id);
    if (!old) { arrive(id); continue; }
    const t = motion() ? over(el, old) : null;
    if (t && t !== 'translate(0px, 0px) scale(1)') el.animate([{ transform: t }, { transform: 'none' }], { duration: 260, easing: EASE });
  }
  const last = now[now.length - 1];
  if (last && !was.has(last) && line.value) line.value.scrollLeft = line.value.scrollWidth;
  // The card that had the keyboard may be the one that left: the overlay takes it back.
  if (root.value && !root.value.contains(document.activeElement)) root.value.focus({ preventScroll: true });
}, { flush: 'pre' });

function close() {
  if (leaving.value) return;
  leaving.value = true;
  // An editor with unsaved typing commits on blur, as it does when any open card closes.
  (document.activeElement as HTMLElement | null)?.blur?.();
  const moving = motion();
  let pending = 0;
  const done = () => { if (--pending <= 0) emit('close'); };
  for (const id of props.ids) {
    const el = slots.get(id);
    if (!el || typeof el.animate !== 'function') continue;
    const back = props.fromRect(id);
    const t = back && moving ? over(el, back) : null;
    pending++;
    const a = t
      ? el.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.5 }], { duration: 240, easing: EASE, fill: 'forwards' })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = done;
  }
  if (!pending) emit('close');
}
/** A double-click on a linked record: its card joins the line (the canvas decides whether it can). */
function pull(id: string) { if (!leaving.value) emit('pull', id); }
/** Only keys no card took: a card stops its own (RecordPanel), so these come from the overlay itself. */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); close(); }
}

defineExpose({ close });
</script>

<style scoped>
.ex { position: absolute; inset: 0; z-index: 90; outline: none; }
.ex-scrim { position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: var(--bg-overlay); cursor: default; animation: ex-in 0.2s ease-out; }
.ex-scrim.out, .ex-hint.out { opacity: 0; transition: opacity 0.2s ease-in; }
@keyframes ex-in { from { opacity: 0; } to { opacity: 1; } }
/* The line fills the canvas body; its cards hang from the top, each as tall as its
   fields and no taller than the line. Auto margins on the ends centre a short line and
   let a long one scroll from its first card (centring by justify-content would cut the
   left end off). */
.ex-line { position: absolute; inset: 0; display: flex; align-items: flex-start; gap: 16px; padding: 20px 16px 40px; box-sizing: border-box; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.ex-slot { flex: none; display: flex; flex-direction: column; max-width: calc(100% - 0px); max-height: 100%; min-height: 0; transform-origin: top left; }
.ex-slot:first-child { margin-left: auto; }
.ex-slot:last-child { margin-right: auto; }
/* A lifted card throws a bigger shadow than a card on the canvas: it is ABOVE it. */
.ex-slot > :deep(.record-panel) { width: 100%; max-width: none; min-height: 0; flex: 0 1 auto; box-shadow: var(--card-shadow-drag); }
.ex-hint { position: absolute; left: 0; right: 0; bottom: 12px; margin: 0; text-align: center; color: var(--on-scrim); font-size: 12px; pointer-events: none; }
</style>
