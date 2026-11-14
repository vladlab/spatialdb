<!--
  COMPARE EXAMINE (CANVAS-BRIEF.md C4): a file and the record it is compared against,
  lifted up side by side — the file from its place on the canvas, the target from its
  own place if it has one there, else fading in — and then both turned over by
  themselves. The two backs are NOT the tables' card backs: they are the comparison,
  row for row (contract/compare.ts `compareRows`), so every value sits opposite the
  value it was checked against. Between them, a connector per row: green where it
  matches, red where it differs or is missing, amber where it cannot be told — with
  the verdict mark too, never colour alone. The rule and what it found are the
  connector's tooltip. All three columns scroll as one.

  Keys and motion as CardExamine.vue: F or a click flips both, Space / Esc / a click
  outside puts them back; "Card animations" off or reduced motion → fades.
-->
<template>
  <div ref="root" class="cx" :class="{ nomotion: !motion() }" tabindex="-1" role="dialog" aria-modal="true" :aria-label="`Comparing ${owner.title} with ${target.title}`"
       @keydown.stop="onKey" @keyup.stop @pointerdown.stop @wheel.stop @dblclick.stop @contextmenu.stop.prevent>
    <button class="cx-scrim" :class="{ out: leaving }" type="button" aria-label="Put the cards back" @click="close" />
    <div class="cx-center">
      <div class="cx-group" :style="{ transform: `scale(${fit})` }">
        <div v-for="side in sides" :key="side.key" :ref="(el) => (stages[side.key] = el as HTMLElement)" class="cx-stage" :style="{ order: side.key === 'owner' ? 1 : 3, width: W + 'px', height: H + 'px' }">
          <div class="cx-flip" :class="{ flipped }" @click="onCardClick">
            <div class="cx-face cx-front" :aria-hidden="flipped">
              <RecordCard v-bind="side.card" :store="store" examine :x="0" :y="0" :w="W" :h="H" :z="1" :selected="false" :dragging="false" :unconfirmed="false"
                          :can-link="false" :examined="false" :collapsed="false" @open-linked="(id: string) => openRecord(id)" />
            </div>
            <div class="cx-face cx-back" :aria-hidden="!flipped">
              <header class="cx-head" :style="{ background: side.card.tableColor, color: textOn(side.card.tableColor) }">
                <span>{{ side.card.tableName }}</span><span class="cx-role">{{ side.key === 'owner' ? 'found' : 'expected' }}</span>
              </header>
              <div class="cx-title" :title="side.card.title">{{ side.card.title || 'untitled' }}</div>
              <div :ref="(el) => (scrollers[side.key] = el as HTMLElement)" class="cx-rows" @scroll="sync(side.key)">
                <div v-for="(r, i) in rows" :key="i" class="cx-row" :class="[r.kind, `tint-${tintOf(r.status)}`, r.status]">
                  <span class="cx-key">{{ side.key === 'owner' ? r.fromName : r.toName }}</span>
                  <span class="cx-val" :title="side.key === 'owner' ? r.found : r.expected">{{ side.key === 'owner' ? r.found : r.expected }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- The connectors: one per row, at the rows' heights, scrolling with them. -->
        <div class="cx-mid" :class="{ shown: flipped }" :style="{ order: 2, height: H + 'px' }">
          <div class="cx-verdict" :class="same ? 'ok' : 'bad'"><VerdictMark :kind="same ? 'ok' : 'bad'" :size="14" /> {{ same ? 'No differences' : `${differ} difference${differ === 1 ? '' : 's'}` }}</div>
          <div :ref="(el) => (scrollers.mid = el as HTMLElement)" class="cx-rows cx-links" @scroll="sync('mid')">
            <div v-for="(r, i) in rows" :key="i" class="cx-link" :class="[r.kind, `tint-${tintOf(r.status)}`]" :title="r.detail ? `${r.rule}: ${r.detail}` : r.rule">
              <span class="cx-line" />
              <VerdictMark v-if="r.kind === 'pair' || r.status !== 'match'" :kind="markOf(r.status)" :size="r.kind === 'pair' ? 16 : 12" />
              <span class="cx-line" />
            </div>
          </div>
        </div>
      </div>
      <p class="cx-hint" :class="{ out: leaving }">F flip · Space or Esc put back</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import type { Store } from '../store';
import RecordCard, { type CardRow } from './RecordCard.vue';
import VerdictMark from './VerdictMark.vue';
import { textOn } from '../colorText';
import { cardAnimations } from '../prefs';
import type { CompareRow, Status } from '../../contract/compare';

type Card = Record<string, any> & { recordId: string; title: string; tableName: string; tableColor: string; rows: CardRow[] };
const props = defineProps<{
  store: Store;
  owner: Card; target: Card;
  rows: CompareRow[];
  /** Where each card is on screen now (null: not on this canvas — it fades in). */
  ownerFrom: () => DOMRect | null;
  targetFrom: () => DOMRect | null;
}>();
const emit = defineEmits<{ close: []; 'open-record': [id: string] }>();

const W = 380, H = 520, MID = 120;
const root = ref<HTMLElement>();
const stages = reactive<Record<string, HTMLElement | null>>({});
const scrollers = reactive<Record<string, HTMLElement | null>>({});
const flipped = ref(false);
const leaving = ref(false);
/** The pair is wider than one card: on a narrow canvas the whole group is scaled down to fit. */
const fit = ref(1);

const sides = computed(() => [{ key: 'owner' as const, card: props.owner }, { key: 'target' as const, card: props.target }]);
const differ = computed(() => props.rows.filter((r) => r.kind === 'pair' && (r.status === 'differ' || r.status === 'missing')).length);
const same = computed(() => !props.rows.some((r) => r.status === 'differ' || r.status === 'missing'));
const tintOf = (s: Status) => (s === 'match' ? 'green' : s === 'unspecified' ? 'amber' : 'red');
const markOf = (s: Status): 'ok' | 'warn' | 'bad' => (s === 'match' ? 'ok' : s === 'unspecified' ? 'warn' : 'bad');

const motion = () => cardAnimations.value && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
function over(el: HTMLElement, r: DOMRect): string | null {
  const to = el.getBoundingClientRect();
  return to.width ? `translate(${r.left - to.left}px, ${r.top - to.top}px) scale(${r.width / to.width})` : null;
}
let flipTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(async () => {
  const box = root.value?.getBoundingClientRect();
  if (box?.width) fit.value = Math.min(1, (box.width - 32) / (2 * W + MID + 24), (box.height - 64) / H);
  await nextTick();
  root.value?.focus({ preventScroll: true });
  const moving = motion();
  for (const [key, from] of [['owner', props.ownerFrom()], ['target', props.targetFrom()]] as const) {
    const el = stages[key];
    if (!el || typeof el.animate !== 'function') continue;
    const t = from && moving ? over(el, from) : null;
    if (t) el.animate([{ transform: t, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });
    else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: moving ? 260 : 140, easing: 'ease-out' });
  }
  // …and once they have landed, both turn over by themselves: the comparison is the point.
  flipTimer = setTimeout(() => { if (!leaving.value) flipped.value = true; }, moving ? 340 : 0);
});
onBeforeUnmount(() => clearTimeout(flipTimer));

function close() {
  if (leaving.value) return;
  leaving.value = true;
  clearTimeout(flipTimer);
  flipped.value = false;
  const moving = motion();
  let pending = 0;
  const done = () => { if (--pending <= 0) emit('close'); };
  for (const [key, back] of [['owner', props.ownerFrom()], ['target', props.targetFrom()]] as const) {
    const el = stages[key];
    if (!el || typeof el.animate !== 'function') continue;
    const t = back && moving ? over(el, back) : null;
    pending++;
    const a = t
      ? el.animate([{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0.5 }], { duration: 240, easing: EASE, fill: 'forwards' })
      : el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = done;
  }
  if (!pending) emit('close');
}
function flip() { if (!leaving.value) flipped.value = !flipped.value; }
function onCardClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, a, input, .pill, .tls, .vls, .cx-rows')) return;
  flip();
}
function openRecord(id: string) { emit('open-record', id); close(); }
function onKey(e: KeyboardEvent) {
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); flip(); }
  else if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); close(); }
}
/** The three columns scroll as one, so every row stays opposite its partner and its connector. */
let syncing = false;
function sync(from: string) {
  if (syncing) return;
  const top = scrollers[from]?.scrollTop ?? 0;
  syncing = true;
  for (const [k, el] of Object.entries(scrollers)) if (k !== from && el && el.scrollTop !== top) el.scrollTop = top;
  syncing = false;
}

defineExpose({ close, flip, flipped });
</script>

<style scoped>
.cx { position: absolute; inset: 0; z-index: 90; outline: none; }
.cx-scrim { position: absolute; inset: 0; border: 0; padding: 0; margin: 0; background: var(--bg-overlay); cursor: default; animation: cx-in 0.2s ease-out; }
.cx-scrim.out, .cx-hint.out { opacity: 0; transition: opacity 0.2s ease-in; }
@keyframes cx-in { from { opacity: 0; } to { opacity: 1; } }
.cx-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; pointer-events: none; }
.cx-group { display: flex; align-items: flex-start; gap: 12px; transform-origin: center; }
.cx-stage { position: relative; flex: none; perspective: 1600px; transform-origin: top left; pointer-events: auto; }
.cx-flip { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.42s ease-in-out; cursor: pointer; }
.cx-flip.flipped { transform: rotateY(180deg); }
.cx-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 8px; box-shadow: var(--card-shadow-drag); }
/* The faces are ALSO switched by hand, at the flip's halfway point (edge-on, 0.21s into a
   symmetric 0.42s turn). backface-visibility alone is not enough: WebKit does not apply
   it to a descendant with a layer of its own (a card's will-change), and drew the front
   MIRRORED where the back should be (the owner, Nov 14 2026). */
.cx-front { visibility: visible; transition: visibility 0s linear 0.21s; }
.cx-flip.flipped .cx-front { visibility: hidden; }
.cx-flip:not(.flipped) .cx-back { visibility: hidden; }
.cx-front :deep(.card) { will-change: auto; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.cx-back { transition: visibility 0s linear 0.21s; transform: rotateY(180deg); background: var(--card-bg); border: 1px solid var(--card-border); overflow: hidden; display: flex; flex-direction: column; }
.cx-front :deep(.card) { box-shadow: none; }
.cx-hint { margin: 0; color: var(--on-scrim); font-size: 12px; pointer-events: none; }

/* The same top block on both backs and the middle — 22px strip + 34px title — so row 1 lines up across all three. */
.cx-head { flex: none; display: flex; justify-content: space-between; align-items: center; height: 22px; padding: 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
.cx-role { font-weight: 400; font-style: italic; opacity: 0.85; }
.cx-title { flex: none; height: 34px; box-sizing: border-box; padding: 0 10px; line-height: 34px; font-size: 13px; font-weight: 600; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--card-border); }
.cx-rows { flex: 1; min-height: 0; overflow-y: auto; font-size: 12px; cursor: auto; scrollbar-width: thin; }
/* Fixed heights per kind: the three columns must agree on where every row is. */
.cx-row, .cx-link { box-sizing: border-box; height: 34px; }
.cx-row.track, .cx-link.track { height: 24px; }
.cx-row { display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid var(--line-faint); background: rgba(var(--tint-rgb), 0.1); }
.cx-row.match { background: none; }
.cx-row.track { padding-left: 22px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.cx-key { flex: none; width: 104px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx-row.track .cx-key { width: 62px; }
.cx-val { flex: 1; min-width: 0; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx-row.differ .cx-val, .cx-row.missing .cx-val { color: rgb(var(--tint-rgb)); font-weight: 600; }

.cx-mid { flex: none; width: 120px; display: flex; flex-direction: column; opacity: 0; transition: opacity 0.25s ease 0.3s; pointer-events: auto; }
.cx-mid.shown { opacity: 1; }
.cx-verdict { flex: none; height: 57px;   /* the backs: 1px border + 22px strip + 34px title */
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--on-scrim); text-align: center; }
.cx-links { scrollbar-width: none; }
.cx-links::-webkit-scrollbar { display: none; }
.cx-link { display: flex; align-items: center; color: rgb(var(--tint-rgb)); }
.cx-line { flex: 1; height: 3px; background: rgb(var(--tint-rgb)); border-radius: 2px; }
.cx-link.track .cx-line { height: 1px; opacity: 0.7; }

.nomotion .cx-flip { transition: none; transform: none !important; }
.nomotion .cx-face { transition: opacity 0.2s ease; visibility: visible !important; }
.nomotion .cx-back { transform: none; opacity: 0; pointer-events: none; }
.nomotion .cx-flip.flipped .cx-back { opacity: 1; pointer-events: auto; }
.nomotion .cx-flip.flipped .cx-front { opacity: 0; pointer-events: none; }
</style>
