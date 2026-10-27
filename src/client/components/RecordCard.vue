<!--
  One record, placed on one canvas.

  Deliberately NOT a viznotes NoteComponent port. That file is 1,589 lines because
  a note there IS its content: rich text, nested containers, inline assets. A
  card here is a window onto a row: a title (the table's primary field), a few
  chosen fields, and a fold. Editing happens in the record panel — double-click —
  with the same editors the grid uses, so there is one way to edit a value.

  EVERY ROW IS ONE FIXED-HEIGHT LINE. That is not a style choice: card height is
  computed, not measured (canvas/cardLayout.ts), and arrows attach to the
  computed edge. The metrics come in as CSS custom properties from that file.

  What the card shows is decided by the canvas, per table (contract/
  canvasConfig.ts) — "File cards on this board show codec and width" — not per
  card. Folding IS per card (placements.collapsed), because that is about getting
  one particular card out of the way.
-->
<template>
  <div
    class="card"
    :class="[{ selected, opened, flash, refused, dragging, unconfirmed, collapsed, stacked, stale, tinted: !!tint, ring: glow === 'ring', 'drop-target': dropTarget }, linkTarget ? `link-${linkTarget}` : '', tint ? `tint-${tint}` : '']"
    :style="style"
    @pointerdown="onPointerDown"
    @pointerenter="$emit('hover', recordId)"
    @pointerleave="$emit('hover', null)"
    @dblclick.stop="$emit('open', recordId)"
    @contextmenu.prevent.stop="$emit('menu', { recordId, x: $event.clientX, y: $event.clientY })"
  >
    <header class="card-head" :style="{ background: tableColor, color: textOn(tableColor) }">
      <span class="card-table">{{ tableName }}</span>
      <!-- No × on a card its stack claims: the stack would place it again at once. -->
      <button
        v-if="!claimed"
        class="card-unplace"
        title="Remove from this canvas (the record is kept)"
        @pointerdown.stop
        @dblclick.stop
        @click.stop="$emit('unplace', recordId)"
      >×</button>
    </header>

    <div class="card-title">
      <button class="card-fold" :title="collapsed ? 'Unfold' : 'Fold'"
              @pointerdown.stop @dblclick.stop @click.stop="$emit('fold', recordId)">{{ collapsed ? '▸' : '▾' }}</button>
      <span class="card-label" :class="{ empty: !title }">{{ title || 'untitled' }}</span>
      <span v-if="stale" class="card-stale" title="This record no longer matches the stack's filter. Drag it out to keep it on the canvas, or × to remove it.">no longer matches</span>
    </div>

    <div v-if="!collapsed && (rows.length || rich?.length)" class="card-body">
      <div v-for="r in rows" :key="r.id" class="card-field" :class="[{ 'is-link': r.link, tall: (r.ids?.length ?? 0) > 1 || (r.lines?.length ?? 0) > 1, tinted: !!r.tint }, r.tint ? `tint-${r.tint}` : '']">
        <span class="card-key"><span v-if="r.color" class="port-dot" :style="{ background: r.color }" />{{ r.name }}</span>
        <!-- Linked records (a link, a backlink, a junction column) are PILLS — the same
             pill as the grid and the tray, in the row's colour: drag one OFF this card
             to place it on the canvas (let go over the card itself and nothing happens),
             double-click it to open it — THAT record, not this card's. One per line,
             CARD_MAX_LINES of them. -->
        <!-- A JUNCTION column's pairs sit where any link's pills do — the first beside the
             field's name, the rest under it — so every row's values start at the same x.
             Each line is the other end's pill and, in a column of its own, the pair's
             status as a capsule: `--pair-slot` is where that column starts. -->
        <span v-if="r.ids && r.ids.length" class="card-val card-list pills column" :class="{ derived: r.derived, pairs: r.junction }"
              :style="r.slot ? { '--pair-slot': r.slot + 'px', '--pair-status': (r.statusW ?? 0) + 'px' } : undefined">
          <RecordPill v-for="(id, i) in r.ids.slice(0, CARD_MAX_LINES)" :key="id + i" class="card-line" :text="(r.lines ?? [r.text])[i] ?? ''" :back="!r.link" :junction="r.junction"
                      :status="r.statuses?.[i]" :color="r.color" :jump="r.here?.[i]" :warn="r.warns?.[i]"
                      :title="r.here?.[i] ? 'Double-click opens it · → goes to its card on this canvas' : 'Double-click opens it · drag it off this card to place it on the canvas'" drag
                      @down="$emit('drag-linked', { recordId: id, from: recordId, e: $event })" @open="$emit('open-linked', id)" @jump="$emit('jump-linked', id)"
                      @edit="r.junction && r.rows && $emit('edit-pair', { recordId, fieldId: r.id, row: r.rows[i] })" />
          <span v-if="r.ids.length > CARD_MAX_LINES" class="card-line more">+{{ r.ids.length - CARD_MAX_LINES }} more</span>
        </span>
        <!-- A field shown as a COUNT (contract/pills.ts): one pill on one line, "12 Files";
             it opens THIS card's record, where they are listed. -->
        <span v-else-if="r.count" class="card-val card-list pills column">
          <RecordPill class="card-line" :n="r.count" :text="r.text" :title="r.countTitle" :back="!r.link" :color="r.color" @open="$emit('open', recordId)" />
        </span>
        <span v-else-if="r.lines && r.lines.length > 1" class="card-val card-list" :class="{ derived: r.derived }">
          <span v-for="(l, i) in r.lines.slice(0, CARD_MAX_LINES)" :key="i" class="card-line">{{ l }}</span>
          <span v-if="r.lines.length > CARD_MAX_LINES" class="card-line more">+{{ r.lines.length - CARD_MAX_LINES }} more</span>
        </span>
        <span v-else class="card-val" :class="{ empty: !r.text, derived: r.derived, broken: r.broken }"><VideoLayoutStrip v-if="r.strip !== undefined" mini :value="r.strip" />{{ r.text || '—' }}</span>
        <VerdictMark v-if="r.verdict" class="card-warn" :kind="r.verdict.ok ? 'ok' : 'warn'" :title="r.verdict.title" />
      </div>
      <!-- NOTES: formatted, with their images, in a window of FIXED height that scrolls
           inside itself (cardLayout.ts says why it cannot be as tall as its content).
           Read-only here — a note is written in the record tray. The wheel scrolls a
           note only on a SELECTED card; otherwise it would swallow every pan that
           happened to pass over one. -->
      <div v-for="b in rich ?? []" :key="b.id" class="card-rich">
        <div class="card-rich-name">{{ b.name }}</div>
        <div class="card-rich-body" @wheel="onRichWheel" @click.capture="noFollow">
          <RichTextView v-if="store" :store="store" :value="b.value" />
        </div>
      </div>
    </div>

    <!-- Resize handles. `e` and `s` alone are genuinely useful: width matters for
         long text, height rarely does, and offering all eight would mean eight
         hit targets fighting the drag surface on a small card. A DOUBLE-CLICK on an
         edge fits the card to what is on it (cardLayout.ts `fitCardWidth`) — the
         window-manager gesture, and the quickest way back from a bad hand resize.
         A card in a STACK has no width of its own (the stack's is the width): no e. -->
    <div v-if="!stacked" class="handle handle-e" title="Drag to resize · double-click to fit" @pointerdown.stop="$emit('resize', { recordId, handle: 'e', e: $event })" @dblclick.stop="$emit('fit', { recordId, handle: 'e' })" />
    <div v-if="!collapsed" class="handle handle-s" title="Drag to resize · double-click to fit" @pointerdown.stop="$emit('resize', { recordId, handle: 's', e: $event })" @dblclick.stop="$emit('fit', { recordId, handle: 's' })" />
    <div v-if="!collapsed && !stacked" class="handle handle-se" title="Drag to resize · double-click to fit" @pointerdown.stop="$emit('resize', { recordId, handle: 'se', e: $event })" @dblclick.stop="$emit('fit', { recordId, handle: 'se' })" />

    <!-- THE LINK HANDLE: one per card, hung off its bottom-right corner — where a new
         link starts, whichever field it turns out to be (contract/canvasLink.ts decides
         that when the drag lands; PLAN.md, "One handle"). It replaced a handle on every
         link row, which crowded the rows. Outside the corner on purpose: inside it is
         the resize corner. Only on a card whose table can link to anything at all. It
         stops the press, or the card would drag. -->
    <!-- THE PATH HANDLE (desktop app only): a folder off the TOP-right corner of a card
         whose record has a file path — the ⊕ link handle's twin. Click: the file is
         selected in the file manager. Its colour is what the last click found: green
         until told otherwise; ORANGE when the file was gone but its folder opened;
         RED when neither exists on this machine. -->
    <button v-if="path" class="path-handle" :class="pathState ?? 'ok'" type="button" tabindex="-1"
            :title="pathState === 'missing' ? `Not on this machine: ${path}` : pathState === 'folder' ? `The file is gone; its folder opens: ${path}` : `Show in folder: ${path}`"
            @pointerdown.stop @click.stop.prevent="$emit('reveal', { recordId, path })" @dblclick.stop @contextmenu.prevent.stop>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h3.5l1.5 1.5h6v6.5h-11z" /></svg>
    </button>
    <button v-if="canLink" class="link-handle" type="button" tabindex="-1"
            title="Drag onto a card to link it · drop on empty canvas, or click, for a new or existing record"
            @pointerdown.stop.prevent="$emit('link-start', { recordId, e: $event })"
            @click.stop @dblclick.stop @contextmenu.prevent.stop>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.2v7.6M4.2 8h7.6" /></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { CARD_MAX_LINES } from '../canvas/cardLayout';
import { textOn } from '../colorText';
import { computed, defineAsyncComponent } from 'vue';
import RecordPill from './RecordPill.vue';
import VideoLayoutStrip from './VideoLayoutStrip.vue';
import VerdictMark from './VerdictMark.vue';
import type { Store } from '../store';
import {
  CARD_BODY_PAD, CARD_HEAD_H, CARD_RICH_H, CARD_RICH_LABEL_H, CARD_ROW_H, CARD_TITLE_H, CARD_TITLE_PX, CARD_W, LINK_HANDLE_OUT, LINK_HANDLE_SIZE, effectiveHeight, lineCount,
} from '../canvas/cardLayout';

// TipTap's renderer is a large chunk; only a canvas that actually shows a note pays for it.
const RichTextView = defineAsyncComponent(() => import('./RichTextView.vue'));

/** One line on the card, already turned into text by the canvas. */
export interface CardRow {
  id: string; name: string; text: string;
  /** A link or lookup: computed from elsewhere, shown in italics as in the grid. */
  derived?: boolean;
  broken?: boolean;
  /** A LINK field's row (or a junction column's): what it names is what this record links TO (its pills are not "back" pills). */
  link?: boolean;
  /** A junction column's row: its pills are pairs ("Texted Master › Uploaded"); `rows` are the pair rows, one per id. */
  junction?: boolean;
  rows?: string[];
  /** A junction column's row: each pair's status, in `rows` order — drawn beside the pill, as a capsule. */
  statuses?: string[];
  /** A junction column's row: the width (px) its other-end column gets, so the statuses line up… */
  slot?: number;
  /** …and the width its widest status needs: the room kept for the status column on a narrow card. */
  statusW?: number;
  /** A field shown as a COUNT: how many — `text` is then what is counted ("Files"), and the row is one line. */
  count?: number;
  countTitle?: string;
  /** Several values (a link to three works): shown as a vertical list, one per line. */
  lines?: string[];
  /** The linked records behind a link/backlink row, in `lines` (or `text`) order — draggable onto this canvas. */
  ids?: string[];
  /** Per id, in the same order: that record already has a card on THIS canvas — its pill wears the jump arrow. */
  here?: boolean[];
  /** Per id, in the same order: a warning on that one link (the Resolve tool's), or undefined. */
  warns?: (string | undefined)[];
  /** A video layout's value: the row draws its mini strip before the summary text. */
  strip?: unknown;
  /** A comparing link's verdict on this value: ✓ or ⚠, with the why. */
  verdict?: { ok: boolean; title: string };
  /** A link or backlink row whose field has an arrow colour: the row is a PORT,
   *  and the dot ties it to the arrows that leave from (or land on) it. */
  color?: string;
  /** A colour rule painted THIS field (contract/colorRules.ts): its value sits in the tint's capsule. */
  tint?: string;
}

const props = defineProps<{
  recordId: string;
  /** Not rendered; declared so `v-bind` from the canvas does not leak it as an attribute. */
  tableId?: string;
  tableName: string;
  tableColor: string;
  title: string;
  rows: CardRow[];
  /** Rich text fields that have a note, drawn as blocks under the rows. */
  rich?: Array<{ id: string; name: string; value: unknown }>;
  /** For the notes' images, which are asset URLs built by the store. */
  store?: Store;
  collapsed: boolean;
  x: number; y: number; w: number | null; h: number | null; z: number;
  selected: boolean;
  /** This card's record is the one open in the tray. */
  opened?: boolean;
  /** Just jumped to (a pill's →, the palette, a drop): pulse once, so the eye lands on it. */
  flash?: boolean;
  /** This card's table can link to something: it gets the ⊕ link handle. */
  canLink?: boolean;
  /** The record's file path, when the desktop app can show it: the card gets the folder handle. */
  path?: string;
  /** What the last click on that handle found (see the template). */
  pathState?: 'ok' | 'folder' | 'missing' | null;
  /**
   * While a link is being dragged out of some card's handle — what THIS card is to it:
   *   from    the card it started from          ok    it could take a link (over: and is about to)
   *   dim     nothing links its table that way   no    …and the pointer is on it: letting go is refused
   *   linked  every way there is, is made already
   */
  linkTarget?: 'from' | 'ok' | 'over' | 'dim' | 'no' | 'linked' | null;
  /** A link was just dropped here that cannot be made: flash red, once. */
  refused?: boolean;
  /** A FILE is being dragged over this card (client/tools/fileDrop.ts): letting go updates THIS record — say so, unmistakably. */
  dropTarget?: boolean;
  dragging: boolean;
  unconfirmed: boolean;
  /** In a STACK (contract/canvasStack.ts): the stack sizes and places it; it cannot be resized sideways. */
  stacked?: boolean;
  /** In a stack, but its record no longer matches the stack's filter: dimmed, and says so, until cleared or dragged out. */
  stale?: boolean;
  /** In a stack AND matching its filter: cannot be removed from the canvas (the stack would place it again), only taken out of the stack. */
  claimed?: boolean;
  /** A colour rule painted this card (contract/colorRules.ts): it wears a ring and halo in this tint. The header keeps the table's colour. */
  tint?: string;
  /** How the tint is worn — the canvas's setting (contract/canvasConfig.ts `glow`). */
  glow?: 'ring' | 'glow';
}>();

const emit = defineEmits<{
  (e: 'pointerdown', payload: { recordId: string; e: PointerEvent }): void;
  /** The folder handle clicked: show the record's file in the file manager. */
  (e: 'reveal', payload: { recordId: string; path: string }): void;
  /** The ⊕ handle, pressed: a link is being dragged out of this card. */
  (e: 'link-start', payload: { recordId: string; e: PointerEvent }): void;
  /** A linked record named on this card (`from`), picked up to be placed on the canvas. */
  (e: 'drag-linked', payload: { recordId: string; from: string; e: PointerEvent }): void;
  /** A linked record's pill, double-clicked: open it (the tray). */
  (e: 'open-linked', recordId: string): void;
  /** A linked record that is already on this canvas, its → pressed: go to its card. */
  (e: 'jump-linked', recordId: string): void;
  /** A junction pair's ✎ on this card: edit its status (the pair editor, anchored at the card). */
  (e: 'edit-pair', payload: { recordId: string; fieldId: string; row: string }): void;
  (e: 'resize', payload: { recordId: string; handle: 'e' | 's' | 'se'; e: PointerEvent }): void;
  /** An edge double-clicked: size the card to its content along that edge. */
  (e: 'fit', payload: { recordId: string; handle: 'e' | 's' | 'se' }): void;
  (e: 'unplace', recordId: string): void;
  (e: 'fold', recordId: string): void;
  (e: 'open', recordId: string): void;
  (e: 'hover', recordId: string | null): void;
  (e: 'menu', payload: { recordId: string; x: number; y: number }): void;
}>();

const style = computed(() => ({
  transform: `translate(${props.x}px, ${props.y}px)`,
  width: `${props.w ?? CARD_W}px`,
  // Always explicit, from the same function the arrows use — never `auto`.
  height: `${effectiveHeight(props.h, lineCount(props.rows), props.collapsed, props.rich?.length ?? 0)}px`,
  zIndex: String(props.z),
  '--head-h': `${CARD_HEAD_H}px`,
  '--title-h': `${CARD_TITLE_H}px`,
  '--title-px': `${CARD_TITLE_PX}px`,
  '--row-h': `${CARD_ROW_H}px`,
  '--body-pad': `${CARD_BODY_PAD / 2}px`,
  '--rich-h': `${CARD_RICH_H}px`,
  '--rich-label-h': `${CARD_RICH_LABEL_H}px`,
  '--link-handle': `${LINK_HANDLE_SIZE}px`,
  '--link-handle-out': `${LINK_HANDLE_OUT}px`,
}));

/** Scroll the note instead of the canvas — but only on a selected card, and only if there is more to see. */
function onRichWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement;
  if (props.selected && el.scrollHeight > el.clientHeight) e.stopPropagation();
}
/** A link inside a note must not navigate away from the canvas on a stray click. */
function noFollow(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
}

function onPointerDown(e: PointerEvent) {
  emit('pointerdown', { recordId: props.recordId, e });
}
</script>

<style scoped>
.card {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  /* translate() rather than left/top: it stays on the compositor, so dragging
     twenty cards does not trigger twenty layout passes per frame. */
  will-change: transform;
  pointer-events: auto;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 6px;
  box-shadow: var(--card-shadow);
  /* NOT `overflow: hidden`: the link handle hangs off the corner. The parts clip
     themselves instead — the head rounds its own top corners, the body clips its rows. */
  display: flex;
  flex-direction: column;
  font-size: 12px;
  cursor: grab;
}
.card.dragging { cursor: grabbing; box-shadow: var(--card-shadow-drag); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }
/* The record OPEN IN THE TRAY: a SOLID ring, where a selected card's is faint — the
   two are different facts (several cards can be selected; one record is open, and it
   stays open when the selection moves on). Selected and open together is the solid
   ring; the drag shadow is kept under it. */
.card.opened { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
.card.opened.dragging { box-shadow: 0 0 0 2px var(--accent), var(--card-shadow-drag); }
/* Just JUMPED TO: one pulse of a wide ring that fades, over whatever ring the card has.
   An outline, so it is paint only — nothing is measured, nothing moves. (While a link
   is being dragged the link-target outlines below win; no jump happens mid-drag.) */
.card.flash { animation: card-flash 0.9s ease-out 1; }
@keyframes card-flash {
  0% { outline: 3px solid var(--accent); outline-offset: 2px; }
  100% { outline: 3px solid transparent; outline-offset: 14px; }
}
/* Optimistic rows are faded until the server acknowledges them — the same
   convention as the grid. */
.card.unconfirmed { opacity: 0.55; }
/* PAINTED by a colour rule (contract/colorRules.ts): a ring in the tint and — unless
   the canvas says "ring" — a soft halo around the card. OUTSIDE the card on purpose:
   the body keeps its contrast for notes and images, and the header keeps the table's
   colour. Selected / open keep their accent ring; the halo stays under it. */
.card.tinted { border-color: var(--tint-ring); box-shadow: 0 0 0 1px var(--tint-ring), 0 0 22px 3px var(--tint-halo); }
.card.tinted.ring { box-shadow: 0 0 0 1px var(--tint-ring); }
.card.tinted.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring), 0 0 22px 3px var(--tint-halo); }
.card.tinted.opened { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent), 0 0 22px 3px var(--tint-halo); }
.card.tinted.ring.selected { box-shadow: 0 0 0 2px var(--accent-ring), 0 0 0 1px var(--tint-ring); }
.card.tinted.ring.opened { box-shadow: 0 0 0 2px var(--accent), 0 0 0 1px var(--tint-ring); }
.card.tinted.dragging { box-shadow: 0 0 0 1px var(--tint-ring), var(--card-shadow-drag); }
/* A painted ROW: its value in the tint's capsule — the card's row, not the whole card. */
.card-field.tinted > .card-val { background: var(--tint-cap); box-shadow: inset 0 0 0 1px var(--tint-ring); border-radius: 9px; padding-left: 6px; padding-right: 6px; }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  box-sizing: border-box; height: var(--head-h); flex: none;
  padding: 0 6px 0 8px;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--card-head-text);
  border-radius: 5px 5px 0 0;   /* the card no longer clips for it */
}
.card-table { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-unplace, .card-fold {
  border: none; background: none; color: inherit; cursor: pointer;
  line-height: 1; padding: 0 2px; opacity: 0.6; font: inherit;
}
.card-unplace { font-size: 14px; }
.card-unplace:hover, .card-fold:hover { opacity: 1; }

.card-title {
  display: flex; align-items: center; gap: 4px; flex: none;
  box-sizing: border-box; height: var(--title-h); padding: 0 8px 0 4px;
  font-weight: 600; font-size: var(--title-px); color: var(--text-primary);
}
.card-stale { flex: none; margin-left: auto; font-size: 10px; font-weight: 400; font-style: italic; color: var(--warning); white-space: nowrap; }
/* STALE in a stack: still there, plainly not current — until cleared or dragged out. */
.card.stale { opacity: 0.55; border-style: dashed; }
.card.stale:hover, .card.stale.selected { opacity: 0.9; }
.card-fold { color: inherit; opacity: 0.7; font-size: 10px; width: 14px; }
.card-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-label.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }

.card-body {
  box-sizing: border-box; padding: var(--body-pad) 8px; overflow: hidden;
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
}
.card-field { flex: none; position: relative; }
/* THE LINK HANDLE. Its centre is `--link-handle-out` px diagonally outside the card's
   bottom-right corner (cardLayout.ts has the two numbers; the canvas starts the drag
   line from the same point). Shown while the card is hovered or selected — it is a
   child of the card, so the pointer moving onto it is still "over the card".
   It never gets smaller than about 15px ON SCREEN: zoomed out it is scaled back up
   (`--zoom` is the canvas's scale, set on the world layer), because a handle you
   cannot hit is the finicky thing this replaced. */
.link-handle {
  position: absolute; box-sizing: border-box; padding: 0; margin: 0;
  width: var(--link-handle); height: var(--link-handle);
  right: calc(-1 * (var(--link-handle) / 2 + var(--link-handle-out) + 1px));
  bottom: calc(-1 * (var(--link-handle) / 2 + var(--link-handle-out) + 1px));
  scale: max(1, calc(0.85 / var(--zoom, 1)));
  border-radius: 50%; border: 1.5px solid var(--accent);
  background: var(--card-bg); color: var(--accent);
  display: grid; place-items: center; cursor: crosshair; z-index: 4;
  opacity: 0; transition: opacity 0.1s ease;
}
.link-handle svg { width: 100%; height: 100%; display: block; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
/* The path handle: the link handle's geometry, mirrored to the top-right corner, in a
   colour that is a verdict — green / orange / red (--success / --warning / --danger). */
.path-handle {
  position: absolute; box-sizing: border-box; padding: 3px; margin: 0;
  width: var(--link-handle); height: var(--link-handle);
  right: calc(-1 * (var(--link-handle) / 2 + var(--link-handle-out) + 1px));
  top: calc(-1 * (var(--link-handle) / 2 + var(--link-handle-out) + 1px));
  scale: max(1, calc(0.85 / var(--zoom, 1)));
  border-radius: 50%; border: 1.5px solid var(--handle-color, var(--success));
  background: var(--card-bg); color: var(--handle-color, var(--success));
  display: grid; place-items: center; cursor: pointer; z-index: 4;
  opacity: 0; transition: opacity 0.1s ease;
}
.path-handle.folder { --handle-color: var(--warning); }
.path-handle.missing { --handle-color: var(--danger); }
.path-handle svg { width: 100%; height: 100%; display: block; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; pointer-events: none; }
.card:hover .path-handle, .card.selected .path-handle { opacity: 1; }
.path-handle:hover { background: var(--handle-color, var(--success)); color: #fff; }
.card.link-ok .path-handle, .card.link-over .path-handle, .card.link-dim .path-handle, .card.link-no .path-handle, .card.link-linked .path-handle { opacity: 0; pointer-events: none; }
.card:hover .link-handle, .card.selected .link-handle, .card.link-from .link-handle { opacity: 1; }
.link-handle:hover, .card.link-from .link-handle { background: var(--accent); color: #fff; }
/* While a link is being dragged, only the card it started from keeps its handle. */
.card.link-ok .link-handle, .card.link-over .link-handle, .card.link-dim .link-handle,
.card.link-no .link-handle, .card.link-linked .link-handle { opacity: 0; pointer-events: none; }

/* WHILE A LINK IS BEING DRAGGED, every card says what it is to that drag. */
.card.link-ok { outline: 1px dashed var(--accent); outline-offset: 2px; }
.card.link-over { outline: 2px solid var(--accent); outline-offset: 2px; }
.card.link-dim { opacity: 0.4; }
.card.link-no { opacity: 0.75; outline: 2px solid var(--danger); outline-offset: 2px; }
/* Dropped where no link can be made: one red flash over the card, and nothing else
   happens. Paint only (an inset shadow and an outline) — nothing moves. */
/* A file over the card: a thick dashed ring, over everything else the card may be
   showing (opened, selected, a tint), so "letting go replaces THIS record" is never
   in doubt. The overlay's label names the record too (App.vue). */
.card.drop-target { outline: 3px dashed var(--accent); outline-offset: 3px; box-shadow: 0 0 0 6px var(--accent-ring); }
.card.refused { animation: card-refused 0.7s ease-out 1; }
@keyframes card-refused {
  0%, 35% { outline: 2px solid var(--danger); outline-offset: 2px; box-shadow: inset 0 0 0 999px rgba(220, 60, 60, 0.38); }
  100% { outline: 2px solid transparent; outline-offset: 2px; box-shadow: inset 0 0 0 999px rgba(220, 60, 60, 0); }
}
/* At the card's default height each block is exactly --rich-h (the arithmetic in
   cardLayout.ts). Resize the card and `flex: 1` shares the difference among them. */
.card-rich { flex: 1 1 var(--rich-h); min-height: 0; display: flex; flex-direction: column; }
.card-rich-name {
  flex: none; height: var(--rich-label-h); line-height: var(--rich-label-h);
  color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-rich-body {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  border-top: 1px solid var(--card-border); padding: 4px 2px 0;
}
/* Smaller than in the tray: a card is a summary. Images must not steal the drag. */
.card-rich-body :deep(.rich) { font-size: 11px; line-height: 1.4; }
.card-rich-body :deep(.rich h1), .card-rich-body :deep(.rich h2), .card-rich-body :deep(.rich h3) { font-size: 12px; margin: 0.5em 0 0.25em; }
.card-rich-body :deep(.rich p) { margin: 0 0 0.4em; }
.card-rich-body :deep(.rich img) { pointer-events: none; -webkit-user-drag: none; margin: 0.25em 0; }
.card-field { display: flex; gap: 8px; height: var(--row-h); line-height: var(--row-h); }
/* A row with SEVERAL values is as tall as its lines — the height the layout arithmetic
   (cardLayout.rowLines) already counts; a fixed one-row height drew them over the rows below. */
.card-field.tall { height: auto; }
.card-key {
  color: var(--text-muted); flex: none; width: 76px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.port-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.card-list { display: flex; flex-direction: column; }
.draggable { cursor: grab; }
.draggable:hover { color: var(--accent); }
.card-line { height: var(--row-h); line-height: var(--row-h); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-line.more { color: var(--text-faint); font-size: 10px; }
/* A PILL on a card line: two pixels shorter than the row, so consecutive pills do not
   touch — the row's height is arithmetic (cardLayout) and stays what it was. It must
   not clip itself (its actions float past its end); the list clips for it, and takes
   the row's whole width so those actions have room. */
.pill.card-line { height: calc(var(--row-h) - 2px); line-height: calc(var(--row-h) - 2px); margin: 1px 0; overflow: visible; font-size: 11px; }
.card-list.pills { flex: 1; gap: 0; }
/* A junction column's lines: each pair's pill spans the value column, so its two parts
   can be columns of their own — the other end in `--pair-slot`, the status after it.
   On a card too narrow for both it is the NAME that ends in an ellipsis: the status
   column keeps what its widest status needs (`--pair-status`, up to 60% of the line),
   because the status is what the row is read for, and the name is one hover away. */
.card-list.pairs .pill.junction { display: flex; width: 100%; max-width: 100%; }
.card-list.pairs .pill.junction :deep(.pill-text) { display: flex; flex: 1 1 auto; }
.card-list.pairs .pill.junction :deep(.pill-slot) { flex: none; width: min(var(--pair-slot), calc(100% - min(var(--pair-status, 0px), 60%) - 6px)); }
.card-field { align-items: flex-start; }
.card-warn { margin-left: 3px; }
.card-val {
  color: var(--text-primary); overflow: hidden; min-width: 0;
  text-overflow: ellipsis; white-space: nowrap;
}
.card-val.empty { color: var(--text-faint); }
.card-val.derived { color: var(--text-secondary); font-style: italic; }
.card-val.broken { color: var(--danger); }

.handle { position: absolute; opacity: 0; }
.handle-e { top: 0; right: 0; width: 8px; height: 100%; cursor: ew-resize; }
.handle-s { bottom: 0; left: 0; width: 100%; height: 8px; cursor: ns-resize; }
.handle-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; z-index: 1; }
.card:hover .handle { opacity: 1; }
</style>
