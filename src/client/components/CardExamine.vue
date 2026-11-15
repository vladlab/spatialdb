<!--
  EXAMINE (CANVAS-BRIEF.md C1–C3): cards lifted off the canvas, at a fixed readable
  size whatever the zoom, over the canvas body (the bars and the tray stay as they
  are). The first flies up from its place on the canvas; its place stays held by a
  see-through copy (RecordCard `examined`) until it is put back.

    the FRONT   the card itself — every line of its lists, its notes unclipped
    the BACK    a read-only layout of the record's fields, the same for every card of
                its table (contract/cardBack.ts)

  A LINE OF CARDS (the owner, Nov 15 2026): a click on a linked record — a pill on
  either face — pulls THAT record's card up too, to the right of the line. Each card
  turns over on its own: its "reverse" button, or a click on it. F turns them all.
  Space, Esc or a click outside puts every card back. A line too long for the canvas
  is scaled down to fit, and past half size it scrolls sideways instead.

  While it is up it owns the keyboard, the pointer and the wheel: nothing reaches the
  canvas behind. Nothing about examine is saved.

  Motion is transform and opacity only. With "Card animations" off (Settings › This
  browser) or the OS asking for reduced motion, flights are fades and flips cross-fades.
-->
<template>
  <div ref="root" class="ex" :class="{ nomotion: !motion() }" tabindex="-1" role="dialog" aria-modal="true" :aria-label="`Examining ${items[0]?.card.title || 'card'}`"
       @keydown.stop="onKey" @keyup.stop @pointerdown.stop @wheel.stop @dblclick.stop @contextmenu.stop.prevent>
    <button class="ex-scrim" :class="{ out: leaving }" type="button" aria-label="Put the cards back" @click="close" />
    <div class="ex-center">
      <div ref="line" class="ex-line">
        <!-- A SLOT is the card's place in the line, at the fitted size; it is what flies. The
             stage inside is always W × H, scaled to the slot. -->
        <div v-for="item in items" :key="item.card.recordId" :ref="(el) => setSlot(item.card.recordId, el as HTMLElement | null)" class="ex-slot"
             :style="{ width: W * fit + 'px', height: H * fit + 'px' }">
        <div class="ex-stage" :style="{ width: W + 'px', height: H + 'px', transform: `scale(${fit})` }">
        <div class="ex-flip" :class="{ flipped: flippedIds.has(item.card.recordId) }" @click="onCardClick($event, item.card.recordId)">
          <div class="ex-face ex-front" :aria-hidden="flippedIds.has(item.card.recordId)">
            <RecordCard v-bind="item.card" :store="store" examine :x="0" :y="0" :w="W" :h="H" :z="1" :selected="false" :dragging="false" :unconfirmed="false"
                        :can-link="false" :examined="false" :collapsed="false"
                        @pick-linked="(id: string) => pull(id)" @compare="(id: string) => emit('compare', id)" />
            <!-- REVERSE: says, in a word, that the card turns over (the owner, Nov 15 2026). In the strip. -->
            <button class="ex-reverse" type="button" :style="{ color: textOn(item.card.tableColor) }" title="Turn the card over — F turns them all" @click.stop="flip(item.card.recordId)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5" /></svg>reverse
            </button>
          </div>
          <div class="ex-face ex-back" :aria-hidden="!flippedIds.has(item.card.recordId)">
            <header class="ex-back-head" :style="{ background: item.card.tableColor, color: textOn(item.card.tableColor) }">
              <span>{{ item.card.tableName }} <span class="ex-back-word">back</span></span>
              <button class="ex-reverse in-head" type="button" title="Turn the card over — F turns them all" @click.stop="flip(item.card.recordId)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5" /></svg>reverse
              </button>
            </header>
            <div class="ex-back-title">{{ item.card.title || 'untitled' }}</div>
            <div class="ex-back-body">
              <!-- FIELD GROUPS (the owner, Nov 14 2026): each of the table's field sections is an
                   inset box with its name in small caps; fields outside any section sit plain. -->
              <div v-for="(g, gi) in groupsOf(item.back)" :key="gi" :class="g.name ? 'ex-group' : 'ex-loose'">
                <div v-if="g.name" class="ex-sec">{{ g.name }}</div>
                <template v-for="it in g.items" :key="it.id">
                  <div class="ex-row" :class="{ block: it.block }">
                    <span class="ex-key">{{ it.name }}</span>
                    <span class="ex-val">
                      <RichTextView v-if="it.rich !== undefined" :store="store" :value="it.rich" />
                      <template v-else-if="it.row">
                        <span v-if="it.row.ids?.length" class="ex-pills">
                          <RecordPill v-for="(id, k) in it.row.ids" :key="id + k" :text="(it.row.lines ?? [it.row.text])[k] ?? ''" :back="!it.row.link" :color="it.row.color"
                                      title="Click to pull its card up beside this one" @pick="pull(id)" />
                        </span>
                        <template v-else>
                          <span v-if="it.row.lines?.length" class="ex-lines"><span v-for="(l, k) in it.row.lines" :key="k">{{ l }}</span></span>
                          <span v-else class="ex-text" :class="{ empty: !it.row.text }">{{ it.row.text || '—' }}</span>
                          <VideoLayoutStrip v-if="it.row.strip !== undefined" class="ex-strip" :value="it.row.strip" />
                          <TimelineStrip v-if="it.row.timeline !== undefined" class="ex-strip" :value="it.row.timeline" :width-px="W - 40" />
                        </template>
                      </template>
                    </span>
                  </div>
                </template>
              </div>
              <p v-if="!item.back.length" class="ex-none">Nothing on the back. ⚙ Table settings › Card back chooses what is.</p>
            </div>
          </div>
        </div>
        </div>
        </div>
      </div>
      <p class="ex-hint" :class="{ out: leaving }">Click a linked record to pull its card up · F flip · Space or Esc put back</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { Store } from '../store';
import RecordCard, { type CardRow } from './RecordCard.vue';
import RecordPill from './RecordPill.vue';
import RichTextView from './RichTextView.vue';
import VideoLayoutStrip from './VideoLayoutStrip.vue';
import TimelineStrip from './TimelineStrip.vue';
import { textOn } from '../colorText';
import { cardAnimations } from '../prefs';

export type BackItem = { kind: 'head'; name: string } | { kind: 'field'; id: string; name: string; row?: CardRow; rich?: unknown; block?: boolean };

type Card = Record<string, any> & { recordId: string; title: string; tableName: string; tableColor: string; rows: CardRow[] };
const props = defineProps<{
  store: Store;
  /** The line: each card as the canvas draws it (title wrapped at W) with its back. The first is the one examined; the rest were pulled up after it. */
  items: Array<{ card: Card; back: BackItem[] }>;
  /** Where a record's card is on the canvas now (null: not on it) — asked again on the way back down. */
  fromRect: (recordId: string) => DOMRect | null;
}>();
const emit = defineEmits<{ close: []; pull: [id: string]; compare: [id: string] }>();

/** The examined size: fixed, whatever the canvas's zoom (the owner, Nov 14 2026). */
const W = 380, H = 520, GAP = 16, MIN_FIT = 0.5;
type FieldItem = Extract<BackItem, { kind: 'field' }>;
/** A back's lines, gathered under their headings: a heading starts a group; lines before any heading are loose. */
function groupsOf(back: BackItem[]) {
  const out: Array<{ name: string | null; items: FieldItem[] }> = [];
  for (const b of back) {
    if (b.kind === 'head') out.push({ name: b.name, items: [] });
    else { if (!out.length) out.push({ name: null, items: [] }); out[out.length - 1].items.push(b); }
  }
  return out.filter((g) => g.items.length);
}
const root = ref<HTMLElement>();
const line = ref<HTMLElement>();
const slots = new Map<string, HTMLElement>();
const setSlot = (id: string, el: HTMLElement | null) => { if (el) slots.set(id, el); else slots.delete(id); };
const flippedIds = reactive(new Set<string>());
const leaving = ref(false);

/* ── FIT: the whole line inside the canvas body — re-fitted whenever that changes size
   (the tray opening or closing, the window) or the line grows. Never under half size:
   past that the line scrolls sideways. */
const fit = ref(1);
function refit() {
  const box = root.value?.getBoundingClientRect();
  if (!box?.width) return;
  const n = Math.max(1, props.items.length);
  fit.value = Math.max(MIN_FIT, Math.min(1, (box.width - 32) / (n * W + (n - 1) * GAP), (box.height - 72) / H));
}
let ro: ResizeObserver | undefined;

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
  refit();
  if (root.value && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(refit); ro.observe(root.value); }
  await nextTick();
  root.value?.focus({ preventScroll: true });
  for (const it of props.items) arrive(it.card.recordId);
});
onBeforeUnmount(() => ro?.disconnect());

/* A card joins the line: the ones already up SLIDE to their new places (nothing jumps),
   the new one arrives at the right end, and the line scrolls to show it. */
watch(() => props.items.map((i) => i.card.recordId), async (now, before) => {
  const was = new Map((before ?? []).map((id) => [id, slots.get(id)?.getBoundingClientRect()] as const));
  refit();
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
}, { flush: 'pre' });

function close() {
  if (leaving.value) return;
  leaving.value = true;
  flippedIds.clear();       // down from the FRONT: a flipped card turns back over as it lands
  const moving = motion();
  let pending = 0;
  const done = () => { if (--pending <= 0) emit('close'); };
  for (const it of props.items) {
    const el = slots.get(it.card.recordId);
    if (!el || typeof el.animate !== 'function') continue;
    const back = props.fromRect(it.card.recordId);
    const t = back && moving ? over(el, back) : null;
    pending++;
    const a = t
      ? el.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.5 }], { duration: 240, easing: EASE, fill: 'forwards' })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = done;
  }
  if (!pending) emit('close');
}
function flip(id: string) { if (leaving.value) return; if (flippedIds.has(id)) flippedIds.delete(id); else flippedIds.add(id); }
/** F: every card to the same side — all over, unless they all already are. */
function flipAll() {
  if (leaving.value) return;
  const all = props.items.every((i) => flippedIds.has(i.card.recordId));
  for (const i of props.items) { if (all) flippedIds.delete(i.card.recordId); else flippedIds.add(i.card.recordId); }
}
/** A click on a card flips it — unless it was on something of its own: a pill, a button, a link. */
function onCardClick(e: MouseEvent, id: string) {
  if ((e.target as HTMLElement).closest('button, a, input, .pill, .tls, .vls')) return;
  flip(id);
}
/** A click on a linked record: its card joins the line (the canvas decides whether it can). */
function pull(id: string) { if (!leaving.value) emit('pull', id); }
function onKey(e: KeyboardEvent) {
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flipAll(); }
  else if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); close(); }
}

defineExpose({ close, flip, flipAll });
</script>

<style scoped>
.ex { position: absolute; inset: 0; z-index: 90; outline: none; }
.ex-scrim { position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: var(--bg-overlay); cursor: default; animation: ex-in 0.2s ease-out; }
.ex-scrim.out, .ex-hint.out { opacity: 0; transition: opacity 0.2s ease-in; }
@keyframes ex-in { from { opacity: 0; } to { opacity: 1; } }
.ex-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; pointer-events: none; }
.ex-line { display: flex; gap: 16px; max-width: 100%; overflow-x: auto; overflow-y: hidden; padding: 28px 16px; margin: -28px 0; box-sizing: border-box; pointer-events: auto; scrollbar-width: thin; }
.ex-slot { position: relative; flex: none; transform-origin: top left; }
.ex-stage { position: absolute; top: 0; left: 0; perspective: 1600px; transform-origin: top left; }
/* "reverse": in the card's strip, right — on the front it lies over the card's own strip. */
.ex-reverse { position: absolute; top: 2px; right: 6px; z-index: 3; height: 18px; display: inline-flex; align-items: center; gap: 4px; padding: 0 7px 0 5px;
  background: transparent; border: 1px solid currentColor; border-radius: 9px; font: inherit; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1; cursor: pointer; opacity: 0.85; }
.ex-reverse:hover { opacity: 1; }
.ex-reverse svg { width: 11px; height: 11px; }
.ex-reverse.in-head { position: static; color: inherit; }
.ex-flip { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.42s ease-in-out; cursor: pointer; }
.ex-flip.flipped { transform: rotateY(180deg); }
.ex-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 8px; box-shadow: var(--card-shadow-drag); }
/* The faces are ALSO switched by hand, at the flip's halfway point (edge-on, 0.21s into a
   symmetric 0.42s turn). backface-visibility alone is not enough: WebKit does not apply
   it to a descendant with a layer of its own (a card's will-change), and drew the front
   MIRRORED where the back should be (the owner, Nov 14 2026). */
.ex-front { visibility: visible; transition: visibility 0s linear 0.21s; }
.ex-flip.flipped .ex-front { visibility: hidden; }
.ex-flip:not(.flipped) .ex-back { visibility: hidden; }
.ex-front :deep(.card) { will-change: auto; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.ex-back { transition: visibility 0s linear 0.21s; transform: rotateY(180deg); background: var(--card-bg); border: 1px solid var(--card-border); overflow: hidden; display: flex; flex-direction: column; }
/* The examined card throws a bigger shadow than a card on the canvas: it is ABOVE it. */
.ex-front :deep(.card) { box-shadow: none; }
.ex-hint { margin: 0; color: var(--on-scrim); font-size: 12px; pointer-events: none; }

.ex-back-head { flex: none; display: flex; justify-content: space-between; align-items: center; height: 22px; padding: 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
.ex-back-word { font-weight: 400; opacity: 0.8; font-style: italic; }
.ex-back-title { flex: none; padding: 6px 10px; font-size: 13px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; border-bottom: 1px solid var(--card-border); }
.ex-back-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0 8px; font-size: 12px; cursor: auto; }
.ex-group { margin: 8px 8px 0; padding: 6px 0 2px; background: var(--card-inset); border-radius: 8px; }
.ex-group .ex-row:last-child { border-bottom: 0; }
.ex-sec { margin: 0 10px 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.ex-row { display: flex; gap: 8px; padding: 3px 10px; line-height: 18px; border-bottom: 1px solid var(--line-faint); }
.ex-row.block { flex-direction: column; gap: 2px; }
.ex-key { flex: none; width: 112px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ex-val { flex: 1; min-width: 0; color: var(--text-primary); overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 3px; }
.ex-text.empty { color: var(--text-faint); }
.ex-lines, .ex-pills { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.ex-strip { margin-top: 2px; }
.ex-none { margin: 16px 10px; color: var(--text-faint); font-style: italic; }

/* No motion: the flip is a cross-fade (the OS's reduced motion, or "Card animations" off —
   `motion()` folds both into the `nomotion` class). */
.nomotion .ex-flip { transition: none; transform: none !important; }
.nomotion .ex-face { transition: opacity 0.2s ease; visibility: visible !important; }
.nomotion .ex-back { transform: none; opacity: 0; pointer-events: none; }
.nomotion .ex-flip.flipped .ex-back { opacity: 1; pointer-events: auto; }
.nomotion .ex-flip.flipped .ex-front { opacity: 0; pointer-events: none; }
</style>
