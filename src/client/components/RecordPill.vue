<!--
  A PILL: one linked record, drawn the same way everywhere a record's links or
  backlinks are shown — a grid cell, a record tray field, a card row on a canvas, a
  kanban card, the tray's "referenced by".

  A pill is ALWAYS a pill. It used to be bare text until the pointer was over it,
  which said nothing at rest — a link read as a value typed into the record, only
  smaller — and it kept room for its hidden glyphs, so cells were padded with
  nothing. Now:

      a LINK        a tinted pill
      a BACKLINK    the same pill in outline: the link lives on the other record
      a PAIR        a junction row's — the other end as the pill, and its status
                    beside it as a round capsule, the way a select's value is drawn
                    ("[Texted Master] (Uploaded)"). The room the other end gets is
                    `--pair-slot` when a column of pairs sets it, so statuses line up.
      a COUNT       `n` set: "3 Edits" — a field shown as a count
                    (contract/pills.ts) is one pill, however many it links to

  SQUARISH, where a select's chip is round: the shape is what tells "this is a
  record" from "this is a tag". NEUTRAL unless the relationship has a colour
  (`color` — the link field's arrow colour, derived.pillColorOf): then the pill
  wears it, and "inputs are blue" means the same in a cell as on a canvas.

  DOUBLE-CLICK a pill to open its record in the tray. A single click does nothing —
  a pill is text you might be selecting or dragging — and a double-click acts on the
  pill itself, never on whatever holds it: it does not reach the grid cell (which
  would open its "add" picker) or the card under it (which would open the CARD's
  record). There used to be a ⤢ on every pill for this, in a group that popped up
  beside it on hover; a pill that can only be opened now pops nothing up.

  The other ACTIONS, where a pill has any, still float just past its end while the
  pointer is over it, over whatever is next — over the next column, if the pill fills
  its cell. No room is kept for them and nothing moves. Only where they cannot go
  past the end (the window's edge; a card on a canvas) do they sit over the pill's
  own tail (`flip`). See `place` below.

      ✎            a junction pair's: edit its status (`edit`)
      ×            `remove`
      drag         with `drag`, the parent starts a record drag on pointerdown
                   (onto a canvas, to place the record); a still press does nothing

  The styles are global (App.vue `.pills` / `.pill`) so the surfaces cannot drift
  apart again.
-->
<template>
  <span ref="el" class="pill" :class="{ back, junction, on, flip, paired: !!split, count: n !== undefined }" :style="tint" :title="title ?? openTitle"
        @pointerenter="onEnter" @pointerleave="onLeave" @pointerdown.stop="onDown" @mousedown.stop.prevent @click.stop @dblclick.stop="$emit('open')">
    <span class="pill-text"><template v-if="n !== undefined"><b class="pill-n">{{ n }}</b>{{ ' ' }}</template><template v-if="junction"><span class="pill-slot"><span class="pill-main">{{ split || text }}</span></span><template v-if="split"><span class="pill-sep">{{ ' › ' }}</span><span class="pill-status">{{ status }}</span></template></template><template v-else>{{ text }}</template></span>
    <!-- Their own double-clicks stop here: two quick presses on × or ✎ are not "open". -->
    <span v-if="junction || removable" class="pill-actions" :style="escaped" @dblclick.stop>
      <button v-if="junction" class="pill-edit" tabindex="-1" :title="editTitle ?? 'Change this pair\'s status'"
              @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('edit')">✎</button>
      <button v-if="removable" class="pill-x" tabindex="-1" :title="removeTitle ?? 'Remove this link'"
              @pointerdown.stop @mousedown.stop.prevent @click.stop="$emit('remove')">×</button>
    </span>
  </span>
</template>

<script setup lang="ts">
/*
  A DOUBLE-CLICK opens the record (`open`); a single click on the pill does nothing.
  A junction pair's pill also has a ✎ (change its status here) — and, where the link
  is edited here, the ×.
*/
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  text: string;
  title?: string;
  /** The link is edited here: show ×. */
  removable?: boolean;
  removeTitle?: string;
  /** A backlink's pill — the link lives on the other record (drawn in outline). */
  back?: boolean;
  /** A junction pair's pill ("Texted Master › Uploaded"): ✎ edits its status. */
  junction?: boolean;
  /** A pair's status, when `text` ends with it: drawn beside the pill, as a capsule. */
  status?: string;
  editTitle?: string;
  /** Highlighted — the pair being edited. */
  on?: boolean;
  /** The parent starts a drag on pointerdown (onto a canvas, to place the record). */
  drag?: boolean;
  /** The relationship's colour (#rrggbb) — the link field's arrow colour. None: neutral. */
  color?: string;
  /** A COUNT pill: this many, and `text` is what is counted ("Edits"). Opening it opens the record that lists them. */
  n?: number;
}>();
const emit = defineEmits<{ open: []; edit: []; remove: []; down: [e: PointerEvent] }>();
function onDown(e: PointerEvent) { if (props.drag) emit('down', e); }
/** What the pill says when the parent gives it no tooltip of its own: how it opens. */
const openTitle = computed(() => (props.n !== undefined ? 'Double-click opens the record — they are listed there' : `Double-click opens ${props.text}`));

/**
 * The pair's other end, when the text is "<other end> › <status>" — so the status
 * can be its own segment. The text stays whole in the DOM (the separator is only
 * not drawn): it is still what a search, a test or a screen reader reads.
 */
const split = computed(() => {
  const tail = props.status ? ` › ${props.status}` : '';
  return props.junction && tail && props.text.endsWith(tail) ? props.text.slice(0, -tail.length) : '';
});

/** The colour as the pill's three tints. rgba from the hex, not color-mix(): the desktop client's WebKitGTK may predate it. */
const tint = computed(() => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(props.color ?? '');
  if (!m) return undefined;
  const rgb = `${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}`;
  return { '--pill-bg': `rgba(${rgb}, 0.22)`, '--pill-edge': `rgba(${rgb}, 0.5)`, '--pill-line': `rgba(${rgb}, 0.6)` };
});

/**
 * Where the actions go. Three places, tried in this order as the pointer arrives:
 *
 *   past the end    inside everything that clips the pill (its cell, card, tray):
 *                   the plain case, all CSS.
 *   past the end,   when the pill reaches the edge of its cell — a column is as wide
 *   OVER the edge   as its pills, so that is the usual case in a grid. The group is
 *                   then positioned against the WINDOW (`fixed`), which no cell
 *                   clips, and floats over the next column.
 *   over the tail   (`flip`) only when neither works: the window ends there, or the
 *                   pill is on a canvas — a card is transformed, and inside a
 *                   transformed box `fixed` is clipped like anything else.
 *
 * Measured, because a pill cannot know its room until it is laid out, and that
 * changes with every column drag and canvas zoom. While the pointer stays, a scroll
 * re-measures (the escaped group is pinned to the window, not to the pill). Without
 * layout — the headless suites — nothing is measured and the plain case stands.
 */
const el = ref<HTMLElement>();
const flip = ref(false);
const escaped = ref<Record<string, string> | undefined>();
function place() {
  const root = el.value;
  if (!root) return;
  const r = root.getBoundingClientRect();
  if (!r.width) return;
  const scale = root.offsetWidth ? r.width / root.offsetWidth : 1;       // a canvas card is zoomed
  const buttons = (props.junction ? 1 : 0) + (props.removable ? 1 : 0);
  if (!buttons) return;                                                    // nothing floats beside this pill
  const need = (8 + 17 * buttons) * scale;
  let clip = window.innerWidth, canEscape = true;
  for (let p = root.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX !== 'visible') clip = Math.min(clip, p.getBoundingClientRect().right);
    if (cs.transform !== 'none' || cs.willChange.includes('transform') || cs.filter !== 'none') canEscape = false;
  }
  const fits = r.right + need <= clip;
  const fitsWindow = r.right + need <= window.innerWidth;
  escaped.value = !fits && canEscape && fitsWindow
    ? { position: 'fixed', left: `${r.right - 3}px`, top: `${r.top + r.height / 2}px` } : undefined;
  flip.value = !fits && !escaped.value;
}
function onEnter() {
  place();
  window.addEventListener('scroll', place, { capture: true, passive: true });
}
function onLeave() { window.removeEventListener('scroll', place, { capture: true }); }
onBeforeUnmount(onLeave);
</script>
