<!--
  EXAMINE (CANVAS-BRIEF.md C1–C3): one card lifted off the canvas, at a fixed readable
  size whatever the zoom, over the canvas body (the bars and the tray stay as they
  are). It flies up from its place on the canvas and back down to it; its place stays
  held by a see-through copy (RecordCard `examined`) until then.

    the FRONT   the card itself — every line of its lists, its notes unclipped
    the BACK    a read-only layout of the record's fields, the same for every card of
                its table (contract/cardBack.ts)

  F, or a click on the card, flips it. Space, Esc or a click outside puts it back.
  While it is up it owns the keyboard, the pointer and the wheel: nothing reaches the
  canvas behind. Nothing about examine is saved.

  Motion is transform and opacity only, and only on this one element. With "Card
  animations" off (Settings › This browser) or the OS asking for reduced motion, the
  flight is a fade and the flip a cross-fade.
-->
<template>
  <div ref="root" class="ex" :class="{ nomotion: !motion() }" tabindex="-1" role="dialog" aria-modal="true" :aria-label="`Examining ${card.title || 'card'}`"
       @keydown.stop="onKey" @keyup.stop @pointerdown.stop @wheel.stop @dblclick.stop @contextmenu.stop.prevent>
    <button class="ex-scrim" :class="{ out: leaving }" type="button" aria-label="Put the card back" @click="close" />
    <div class="ex-center">
      <div ref="stage" class="ex-stage" :style="{ width: W + 'px', height: H + 'px' }">
        <div class="ex-flip" :class="{ flipped }" @click="onCardClick">
          <div class="ex-face ex-front" :aria-hidden="flipped">
            <RecordCard v-bind="card" :store="store" examine :x="0" :y="0" :w="W" :h="H" :z="1" :selected="false" :dragging="false" :unconfirmed="false"
                        :can-link="false" :examined="false" :collapsed="false"
                        @open-linked="(id: string) => openRecord(id)" @compare="(id: string) => emit('compare', id)" />
          </div>
          <div class="ex-face ex-back" :aria-hidden="!flipped">
            <header class="ex-back-head" :style="{ background: card.tableColor, color: textOn(card.tableColor) }">
              <span>{{ card.tableName }}</span><span class="ex-back-word">back</span>
            </header>
            <div class="ex-back-title">{{ card.title || 'untitled' }}</div>
            <div class="ex-back-body">
              <template v-for="(b, i) in back" :key="i">
                <div v-if="b.kind === 'head'" class="ex-sec">{{ b.name }}</div>
                <div v-else class="ex-row" :class="{ block: b.block }">
                  <span class="ex-key">{{ b.name }}</span>
                  <span class="ex-val">
                    <RichTextView v-if="b.rich !== undefined" :store="store" :value="b.rich" />
                    <template v-else-if="b.row">
                      <span v-if="b.row.ids?.length" class="ex-pills">
                        <RecordPill v-for="(id, k) in b.row.ids" :key="id + k" :text="(b.row.lines ?? [b.row.text])[k] ?? ''" :back="!b.row.link" :color="b.row.color"
                                    title="Double-click opens it" @open="openRecord(id)" />
                      </span>
                      <template v-else>
                        <span v-if="b.row.lines?.length" class="ex-lines"><span v-for="(l, k) in b.row.lines" :key="k">{{ l }}</span></span>
                        <span v-else class="ex-text" :class="{ empty: !b.row.text }">{{ b.row.text || '—' }}</span>
                        <VideoLayoutStrip v-if="b.row.strip !== undefined" class="ex-strip" :value="b.row.strip" />
                        <TimelineStrip v-if="b.row.timeline !== undefined" class="ex-strip" :value="b.row.timeline" :width-px="W - 40" />
                      </template>
                    </template>
                  </span>
                </div>
              </template>
              <p v-if="!back.length" class="ex-none">Nothing on the back. ⚙ Table settings › Card back chooses what is.</p>
            </div>
          </div>
        </div>
      </div>
      <p class="ex-hint" :class="{ out: leaving }">F flip · Space or Esc put back</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import type { Store } from '../store';
import RecordCard, { type CardRow } from './RecordCard.vue';
import RecordPill from './RecordPill.vue';
import RichTextView from './RichTextView.vue';
import VideoLayoutStrip from './VideoLayoutStrip.vue';
import TimelineStrip from './TimelineStrip.vue';
import { textOn } from '../colorText';
import { cardAnimations } from '../prefs';

export type BackItem = { kind: 'head'; name: string } | { kind: 'field'; id: string; name: string; row?: CardRow; rich?: unknown; block?: boolean };

const props = defineProps<{
  store: Store;
  /** The card as the canvas draws it (CanvasView `cards`), its title already wrapped at W. */
  card: Record<string, any> & { recordId: string; title: string; tableName: string; tableColor: string; rows: CardRow[] };
  back: BackItem[];
  /** Where the card is on screen now — asked again on the way back down, in case the canvas moved. */
  fromRect: () => DOMRect | null;
}>();
const emit = defineEmits<{ close: []; 'open-record': [id: string]; compare: [id: string] }>();

/** The examined size: fixed, whatever the canvas's zoom (the owner, Nov 14 2026). */
const W = 380, H = 520;
const root = ref<HTMLElement>();
const stage = ref<HTMLElement>();
const flipped = ref(false);
const leaving = ref(false);

const motion = () => cardAnimations.value && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
/** The transform that puts the stage exactly over `r` (top-left anchored, uniform scale by width). */
function over(r: DOMRect): string | null {
  const to = stage.value?.getBoundingClientRect();
  if (!to || !to.width) return null;
  return `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width})`;
}
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

onMounted(async () => {
  await nextTick();
  root.value?.focus({ preventScroll: true });
  const el = stage.value, from = props.fromRect();
  const t = from && motion() ? over(from) : null;
  if (el && typeof el.animate === 'function') {
    if (t) el.animate([{ transform: t, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: EASE });
    else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
  }
});

function close() {
  if (leaving.value) return;
  leaving.value = true;
  const el = stage.value, back = props.fromRect();
  const t = back && motion() ? over(back) : null;
  if (!el || typeof el.animate !== 'function') { emit('close'); return; }
  // Down from the FRONT: a flipped card turns back over as it lands.
  flipped.value = false;
  const a = t
    ? el.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.5 }], { duration: 240, easing: EASE, fill: 'forwards' })
    : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
  a.onfinish = () => emit('close');
}
function flip() { if (!leaving.value) flipped.value = !flipped.value; }
/** A click on the card flips it — unless it was on something of its own: a pill, a button, a link. */
function onCardClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, .pill, .tls, .vls')) return;
  flip();
}
function openRecord(id: string) { emit('open-record', id); close(); }
function onKey(e: KeyboardEvent) {
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flip(); }
  else if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); close(); }
}

defineExpose({ close, flip, flipped });
</script>

<style scoped>
.ex { position: absolute; inset: 0; z-index: 90; outline: none; }
.ex-scrim { position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: var(--bg-overlay); cursor: default; animation: ex-in 0.2s ease-out; }
.ex-scrim.out, .ex-hint.out { opacity: 0; transition: opacity 0.2s ease-in; }
@keyframes ex-in { from { opacity: 0; } to { opacity: 1; } }
.ex-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; pointer-events: none; }
.ex-stage { position: relative; flex: none; perspective: 1600px; transform-origin: top left; pointer-events: auto; }
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
.ex-sec { margin: 8px 10px 2px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
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
