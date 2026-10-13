<!--
  Relationship arrows: one per link whose two records are both on the canvas.

  WHERE AN ARROW ATTACHES: the CARD's edge, on whichever sides give the shortest
  run (`bestSides`) — folded or not, whatever fields it shows. An arrow is a
  relationship between two records, not two cells. (Arrows once left from the link
  field's ROW, as in a node editor; the owner retired that, and later the per-row
  link handles too — a link now starts from the card's one handle.) WHICH
  relationship an arrow is, is said by its colour, and by its label when selected.

  Card rectangles are arithmetic (canvas/cardLayout.ts), so none of this measures
  the DOM, same as the rest of the canvas.

  COLOUR and DIRECTION come from the link FIELD (contract/arrows.ts), so they mean
  the same on every canvas. `reversed` puts the arrowhead at the record that holds
  the link: "Previous version" is stored on OEV2, but the flow reads OEV1 → OEV2.
-->
<template>
  <!-- The SVG itself takes no pointer events (the canvas beneath it must still pan and
       box-select); each arrow's fat, invisible HIT path opts back in. -->
  <svg class="arrow-layer" :style="{ pointerEvents: 'none' }">
    <g :transform="svgTransform">
      <g
        v-for="a in arrows"
        :key="a.key"
        class="arrow"
        :class="{ dimmed: focusIds && focusIds.size > 0 && !a.touches.some((t) => focusIds!.has(t)) && a.key !== selectedKey && !pulseKeys?.has(a.key), selected: a.key === selectedKey, pulse: pulseKeys?.has(a.key) }"
        :style="a.color ? { '--arrow': a.color } : undefined"
        :data-field="a.fieldId"
        :data-key="a.key"
      >
        <path :d="a.path" class="arrow-hit"
              @pointerdown.stop="$emit('select', a.link)"
              @contextmenu.prevent.stop="$emit('menu', a.link, $event)" />
        <path :d="a.path" class="arrow-line" />
        <path :d="a.head" class="arrow-head" />
      </g>

      <!-- A SELECTED arrow says which relationship it is: "Outputs", "Based on". Drawn
           at the curve's midpoint and counter-scaled, so it reads the same at any zoom.
           Its box is sized from the character count — nothing here measures the DOM. -->
      <g v-if="selectedArrow" class="arrow-label" :transform="`translate(${selectedArrow.mid.x}, ${selectedArrow.mid.y}) scale(${1 / transform.scale})`">
        <rect :x="-labelW / 2" y="-10" :width="labelW" height="20" rx="4" />
        <text y="4" text-anchor="middle">{{ selectedArrow.label }}</text>
      </g>

      <!-- Dragging a new link out of a card's handle (CanvasView drives this). -->
      <g v-if="rubber" class="rubber" :class="{ valid: rubber.valid }" :style="rubber.color ? { '--rubber': rubber.color } : undefined">
        <path :d="rubber.path" class="arrow-line" />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  anchorPoint, arrowheadPath, bestSides, bezierMid, bezierPath, type Point, type Rect,
} from '../canvas/geometry';
import type { ArrowStyle } from '../../contract/arrows';

const props = defineProps<{
  transform: { x: number; y: number; scale: number };
  links: Array<{ field_id: string; from_record: string; to_record: string; label?: string }>;
  rects: Map<string, Rect>;
  styles?: Map<string, ArrowStyle>;
  /** The selected cards: arrows touching none of them dim (focus mode). Null/empty = no dimming. */
  focusIds?: ReadonlySet<string> | null;
  /** `field|from|to` of the selected arrow, if any. */
  selectedKey?: string | null;
  /** field id → its name, for the selected arrow's label. */
  fieldNames?: Map<string, string>;
  /** Arrows to PULSE once (same keys as `selectedKey`): a link just made by a drag, or the one a drag found already there. */
  pulseKeys?: ReadonlySet<string> | null;
  /** A link being dragged out of a card's handle: from the handle to the pointer, world coordinates. */
  rubber?: { path: string; valid: boolean; color?: string } | null;
}>();
defineEmits<{
  select: [link: { field_id: string; from_record: string; to_record: string }];
  menu: [link: { field_id: string; from_record: string; to_record: string }, e: MouseEvent];
}>();

const svgTransform = computed(
  () => `translate(${props.transform.x}, ${props.transform.y}) scale(${props.transform.scale})`,
);


const arrows = computed(() => {
  const out: Array<{ key: string; fieldId: string; path: string; head: string; touches: string[]; color?: string; mid: Point; link: typeof props.links[number] }> = [];
  for (const l of props.links) {
    const from = props.rects.get(l.from_record);
    const to = props.rects.get(l.to_record);
    if (!from || !to) continue;   // endpoint not on this canvas

    // Every arrow anchors to the CARD, on whichever sides face each other — never to a
    // field's row (see the header).
    const edge = bestSides(from, to);
    const a = { side: edge.from, p: anchorPoint(from, edge.from) };
    const b = { side: edge.to, p: anchorPoint(to, edge.to) };

    // `reversed` swaps which end gets the head; the geometry is otherwise identical.
    const style = props.styles?.get(l.field_id);
    const [tail, tip] = style?.reversed ? [b, a] : [a, b];
    out.push({
      key: `${l.field_id}|${l.from_record}|${l.to_record}`,
      fieldId: l.field_id,
      path: bezierPath(tail.p, tail.side, tip.p, tip.side),
      head: arrowheadPath(tip.p, tip.side),
      touches: [l.from_record, l.to_record],
      color: style?.color,
      mid: bezierMid(tail.p, tail.side, tip.p, tip.side),
      link: l,
    });
  }
  return out;
});

/**
 * A link, or a JUNCTION ROW drawn as one (sql/016): `field_id` is then the junction
 * TABLE's id (what the style, legend and hide-list key on), `junction` the row, and
 * `label` what the selected arrow says — its status, not a field name.
 */
export interface ArrowLink { field_id: string; from_record: string; to_record: string; junction?: string; label?: string }
const selectedArrow = computed(() => {
  const a = props.selectedKey ? arrows.value.find((x) => x.key === props.selectedKey) : undefined;
  return a ? { mid: a.mid, label: a.link.label ?? props.fieldNames?.get(a.fieldId) ?? 'link' } : null;
});
const labelW = computed(() => Math.max(40, (selectedArrow.value?.label.length ?? 0) * 6.6 + 18));
</script>

<style scoped>
.arrow-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  overflow: visible;
}
/* Both read `--arrow`, which a coloured field overrides per arrow (inline, above). */
.arrow-line {
  fill: none;
  stroke: var(--arrow);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.arrow-head {
  fill: var(--arrow);
}
.arrow {
  transition: opacity 0.12s ease;
}
/* Hovering a card fades every arrow it isn't part of, which is the cheapest way
   to answer "what is this connected to" on a dense canvas. */
/* The hit area: far wider than the 1.5px line, invisible, and the ONLY part of this
   layer that takes the pointer. `stroke` = only the stroke, never the fill. */
.arrow-hit { fill: none; stroke: transparent; stroke-width: 14; vector-effect: non-scaling-stroke; pointer-events: stroke; cursor: pointer; }
.arrow:hover .arrow-line { stroke-width: 2.5; }
.arrow.selected .arrow-line { stroke-width: 3; stroke: var(--accent); }
.arrow.selected .arrow-head { fill: var(--accent); }
.arrow-label rect { fill: var(--controls-bg); stroke: var(--accent); stroke-width: 1; }
.arrow-label text { fill: var(--text-primary); font-size: 11px; font-family: inherit; pointer-events: none; }
.rubber .arrow-line { stroke-dasharray: 5 4; stroke: var(--text-muted); stroke-width: 2; }
.rubber.valid .arrow-line { stroke: var(--rubber, var(--accent)); stroke-dasharray: none; }
.arrow.dimmed {
  opacity: 0.15;
}
/* "THIS one": a link a drag just made, or the one it found already there. A thick
   stroke that settles back — stroke only, so nothing is measured and nothing moves. */
.arrow.pulse .arrow-line { animation: arrow-pulse 1.1s ease-out 1; }
@keyframes arrow-pulse {
  0%, 30% { stroke-width: 4; }
  100% { stroke-width: 1.5; }
}
</style>
