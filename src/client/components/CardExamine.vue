<!--
  LIFTED CARDS: records brought up off the canvas, over the canvas body (the bars and
  the dock stay as they are). The first flies up from its place on the canvas — or
  fades in, when it came from the palette and is not on it; a card's place on the
  canvas stays held by a see-through copy (RecordCard `examined`) until it is put back.

  A lifted card is the record's OPEN CARD (the owner, Nov 23 2026): the full record,
  every field, editable — RecordPanel, the same card the dock holds. It is a quick look
  or a quick edit without pinning, and the way to pinning: "pin" in its strip sends it
  to the dock; "place" puts a record that is not on this canvas onto it. It is as tall
  as its fields, up to the height of the canvas, and scrolls inside itself.

  There is no flip here any more: turning a card over is kept for where it earns its
  place — the compare pair (CompareExamine.vue).

  A LINE OF CARDS: a double-click on a linked record's pill (a single click selects the
  pill, as everywhere a link is edited) brings THAT record's card up too, at the right.
  The line is never scaled — these cards are typed into; one too long for the canvas
  scrolls sideways.

  KEYS: a card owns its own (RecordPanel) — Esc inside a card puts that card back.
  With no card focused, Space or Esc put the whole line back, as a click outside does.
  Nothing reaches the canvas behind. Nothing about what is lifted is saved.

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
        <RecordPanel :store="store" :record-id="id" pinnable :place="placed(id) ? 'show' : 'place'"
                     @close="emit('put', id)" @pin="emit('pin', id)" @place="emit('place', id)" @open="pull"
                     @open-board="(r: string) => emit('open-board', r)" @open-report="(r: string) => emit('open-report', r)" @open-calendar="(r: string) => emit('open-calendar', r)" />
      </div>
    </div>
    <p class="ex-hint" :class="{ out: leaving }">Double-click a linked record to bring its card up · pin keeps a card in the dock · Space or Esc put them back</p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { Store } from '../store';
import RecordPanel from './RecordPanel.vue';
import { cardAnimations } from '../prefs';
import { LIFT_W } from '../dock';

const props = defineProps<{
  store: Store;
  /** The line: the record lifted first, then every one brought up after it. */
  ids: string[];
  /** Where a record's card is on the canvas now (null: not on it) — asked again on the way back down. */
  fromRect: (recordId: string) => DOMRect | null;
  /** Whether a record has a card on this canvas: its strip says "on canvas →" rather than "place". */
  placed: (recordId: string) => boolean;
}>();
const emit = defineEmits<{
  close: []; pull: [id: string];
  /** One card put back (its × or Esc inside it); the canvas ends the line when it was the last. */
  put: [id: string];
  pin: [id: string]; place: [id: string];
  'open-board': [id: string]; 'open-report': [id: string]; 'open-calendar': [id: string];
}>();

/** A lifted card's width: fixed, whatever the canvas's zoom (client/dock.ts). */
const W = LIFT_W;
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
  // An editor with unsaved typing commits on blur, as it does when the dock's card closes.
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
/* A lifted card throws a bigger shadow than a card on the canvas or in the dock: it is ABOVE them. */
.ex-slot > :deep(.record-panel) { width: 100%; max-width: none; min-height: 0; flex: 0 1 auto; box-shadow: var(--card-shadow-drag); }
.ex-hint { position: absolute; left: 0; right: 0; bottom: 12px; margin: 0; text-align: center; color: var(--on-scrim); font-size: 12px; pointer-events: none; }
</style>
