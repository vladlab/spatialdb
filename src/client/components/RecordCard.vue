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
    :class="{ selected, dragging, unconfirmed, collapsed, 'link-ok': linkTarget === 'ok', 'link-over': linkTarget === 'over' }"
    :style="style"
    @pointerdown="onPointerDown"
    @pointerenter="$emit('hover', recordId)"
    @pointerleave="$emit('hover', null)"
    @dblclick.stop="$emit('open', recordId)"
    @contextmenu.prevent.stop="$emit('menu', { recordId, x: $event.clientX, y: $event.clientY })"
  >
    <header class="card-head" :style="{ background: tableColor }">
      <span class="card-table">{{ tableName }}</span>
      <button
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
    </div>

    <div v-if="!collapsed && (rows.length || rich?.length)" class="card-body">
      <div v-for="r in rows" :key="r.id" class="card-field" :class="{ 'is-link': r.link }">
        <!-- LINK rows are OUTPUT PORTS, and the port is also where a new link starts:
             press this handle and drag to a card of the table the field points at.
             Only on a link row you can SEE — the field is never guessed (PLAN.md,
             "Linking from the canvas"). It stops the press, or the card would drag. -->
        <span v-if="r.link" class="port-handle" :style="r.color ? { '--port': r.color } : undefined"
              :title="`Drag to a card to link it through “${r.name}”`"
              @pointerdown.stop.prevent="$emit('link-start', { recordId, fieldId: r.id, e: $event })" />
        <span class="card-key"><span v-if="r.color" class="port-dot" :style="{ background: r.color }" />{{ r.name }}</span>
        <span class="card-val" :class="{ empty: !r.text, derived: r.derived, broken: r.broken }">{{ r.text || '—' }}</span>
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
         hit targets fighting the drag surface on a small card. -->
    <div class="handle handle-e" @pointerdown.stop="$emit('resize', { recordId, handle: 'e', e: $event })" />
    <div v-if="!collapsed" class="handle handle-s" @pointerdown.stop="$emit('resize', { recordId, handle: 's', e: $event })" />
    <div v-if="!collapsed" class="handle handle-se" @pointerdown.stop="$emit('resize', { recordId, handle: 'se', e: $event })" />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import type { Store } from '../store';
import {
  CARD_BODY_PAD, CARD_HEAD_H, CARD_RICH_H, CARD_RICH_LABEL_H, CARD_ROW_H, CARD_TITLE_H, CARD_W, effectiveHeight,
} from '../canvas/cardLayout';

// TipTap's renderer is a large chunk; only a canvas that actually shows a note pays for it.
const RichTextView = defineAsyncComponent(() => import('./RichTextView.vue'));

/** One line on the card, already turned into text by the canvas. */
export interface CardRow {
  id: string; name: string; text: string;
  /** A link or lookup: computed from elsewhere, shown in italics as in the grid. */
  derived?: boolean;
  broken?: boolean;
  /** A LINK field's row: an output port, with a handle to drag a new link from. */
  link?: boolean;
  /** A link or backlink row whose field has an arrow colour: the row is a PORT,
   *  and the dot ties it to the arrows that leave from (or land on) it. */
  color?: string;
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
  /** While a link is being dragged: 'ok' = this card could take it, 'over' = it is about to. */
  linkTarget?: 'ok' | 'over' | null;
  dragging: boolean;
  unconfirmed: boolean;
}>();

const emit = defineEmits<{
  (e: 'pointerdown', payload: { recordId: string; e: PointerEvent }): void;
  (e: 'link-start', payload: { recordId: string; fieldId: string; e: PointerEvent }): void;
  (e: 'resize', payload: { recordId: string; handle: 'e' | 's' | 'se'; e: PointerEvent }): void;
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
  height: `${effectiveHeight(props.h, props.rows.length, props.collapsed, props.rich?.length ?? 0)}px`,
  zIndex: String(props.z),
  '--head-h': `${CARD_HEAD_H}px`,
  '--title-h': `${CARD_TITLE_H}px`,
  '--row-h': `${CARD_ROW_H}px`,
  '--body-pad': `${CARD_BODY_PAD / 2}px`,
  '--rich-h': `${CARD_RICH_H}px`,
  '--rich-label-h': `${CARD_RICH_LABEL_H}px`,
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  cursor: grab;
}
.card.dragging { cursor: grabbing; box-shadow: var(--card-shadow-drag); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); }
/* Optimistic rows are faded until the server acknowledges them — the same
   convention as the grid. */
.card.unconfirmed { opacity: 0.55; }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  box-sizing: border-box; height: var(--head-h); flex: none;
  padding: 0 6px 0 8px;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--card-head-text);
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
  font-weight: 600; color: var(--text-primary);
}
.card-fold { color: var(--text-muted); font-size: 10px; width: 14px; }
.card-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-label.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }

.card-body {
  box-sizing: border-box; padding: var(--body-pad) 8px; overflow: hidden;
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
}
.card-field { flex: none; position: relative; }
/* The handle sits at the row's right end, INSIDE the card: `.card` and `.card-body`
   both clip their overflow, so anything hung outside the edge would simply not be
   drawn. The body has 8px of side padding; the handle lives in it (-7px … +3px of the
   row's content edge). Hidden until the row (or a selected card) invites it, so an
   unfolded card is not a column of dots. */
.port-handle {
  position: absolute; right: -7px; top: 50%; width: 10px; height: 10px; margin-top: -5px;
  border-radius: 50%; box-sizing: border-box; cursor: crosshair; z-index: 3;
  background: var(--card-bg); border: 2px solid var(--port, var(--accent));
  opacity: 0; transition: opacity 0.1s ease;
}
.card-field.is-link:hover .port-handle, .card.selected .port-handle { opacity: 1; }
.port-handle:hover { background: var(--port, var(--accent)); }
.card.link-ok { outline: 1px dashed var(--accent); outline-offset: 2px; }
.card.link-over { outline: 2px solid var(--accent); outline-offset: 2px; }
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
.card-key {
  color: var(--text-muted); flex: none; width: 76px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.port-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
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
