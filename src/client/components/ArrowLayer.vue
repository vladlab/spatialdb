<!--
  Relationship arrows: one per link whose two records are both on the canvas.

  WHERE AN ARROW ATTACHES depends on the card, and this is the node-editor idea:

  - A FOLDED card (or one not showing the field) takes the arrow at its EDGE, on
    whichever side gives the shortest run (`bestSides`).
  - An UNFOLDED card showing the link field has the arrow leave from that field's
    ROW — an output port. If the card at the other end shows a BACKLINK field
    mirroring the same link, the arrow lands on THAT row — an input port.

  So a folded board reads as "what connects to what", and unfolding a card tells
  you WHICH relationship each arrow is, because its inputs, outputs and version
  links leave from different rows. Ports are on the left or right edge only (a
  row has no top or bottom), picked by which way the other card lies.

  Row positions are arithmetic — `rowPortY` in canvas/cardLayout.ts — so none of
  this measures the DOM, same as the rest of the canvas.

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
        :class="{ dimmed: highlightId && !a.touches.includes(highlightId) && a.key !== selectedKey, selected: a.key === selectedKey }"
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

      <!-- Dragging a new link out of a port (CanvasView drives this). -->
      <g v-if="rubber" class="rubber" :class="{ valid: rubber.valid }" :style="rubber.color ? { '--rubber': rubber.color } : undefined">
        <path :d="rubber.path" class="arrow-line" />
      </g>
    </g>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  anchorPoint, arrowheadPath, bestSides, bezierMid, bezierPath, type AnchorSide, type Point, type Rect,
} from '../canvas/geometry';
import type { ArrowStyle } from '../../contract/arrows';

/** For one card: the y-offset (from its top) of each row that can act as a port. */
export interface CardPorts {
  /** link field id → row y. Arrows for that field LEAVE here. */
  out: Map<string, number>;
  /** SOURCE link field id (of a backlink row) → row y. Arrows for that field LAND here. */
  in: Map<string, number>;
}

const props = defineProps<{
  transform: { x: number; y: number; scale: number };
  links: Array<{ field_id: string; from_record: string; to_record: string }>;
  rects: Map<string, Rect>;
  ports?: Map<string, CardPorts>;
  styles?: Map<string, ArrowStyle>;
  highlightId?: string | null;
  /** `field|from|to` of the selected arrow, if any. */
  selectedKey?: string | null;
  /** field id → its name, for the selected arrow's label. */
  fieldNames?: Map<string, string>;
  /** A link being dragged out of a port: from the port to the pointer, world coordinates. */
  rubber?: { path: string; valid: boolean; color?: string } | null;
}>();
defineEmits<{
  select: [link: { field_id: string; from_record: string; to_record: string }];
  menu: [link: { field_id: string; from_record: string; to_record: string }, e: MouseEvent];
}>();

const svgTransform = computed(
  () => `translate(${props.transform.x}, ${props.transform.y}) scale(${props.transform.scale})`,
);

const GAP = 4;   // same stand-off as anchorPoint, so ported and edge ends look alike

/** A port on the side of `r` that faces `other`. */
function portEnd(r: Rect, y: number, other: Rect): { p: Point; side: AnchorSide } {
  const side: AnchorSide = other.x + other.w / 2 >= r.x + r.w / 2 ? 'right' : 'left';
  return { side, p: { x: side === 'right' ? r.x + r.w + GAP : r.x - GAP, y: r.y + y } };
}

const arrows = computed(() => {
  const out: Array<{ key: string; fieldId: string; path: string; head: string; touches: string[]; color?: string; mid: Point; link: typeof props.links[number] }> = [];
  for (const l of props.links) {
    const from = props.rects.get(l.from_record);
    const to = props.rects.get(l.to_record);
    if (!from || !to) continue;   // endpoint not on this canvas

    const outY = props.ports?.get(l.from_record)?.out.get(l.field_id);
    const inY = props.ports?.get(l.to_record)?.in.get(l.field_id);
    const edge = bestSides(from, to);
    const a = outY !== undefined ? portEnd(from, outY, to) : { side: edge.from, p: anchorPoint(from, edge.from) };
    const b = inY !== undefined ? portEnd(to, inY, from) : { side: edge.to, p: anchorPoint(to, edge.to) };

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

export interface ArrowLink { field_id: string; from_record: string; to_record: string }
const selectedArrow = computed(() => {
  const a = props.selectedKey ? arrows.value.find((x) => x.key === props.selectedKey) : undefined;
  return a ? { mid: a.mid, label: props.fieldNames?.get(a.fieldId) ?? 'link' } : null;
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
</style>
