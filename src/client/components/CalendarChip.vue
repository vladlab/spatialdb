<!--
  One event on a calendar (VIEWS-BRIEF.md B5): the source's tint as a wash with a
  stripe on the left — the same vocabulary as a grid row painted by a colour rule —
  and the chip's label. A chip that runs on past the edge of its row is drawn OPEN
  on that side (square corners, no stripe), so a span over a week boundary reads as
  one event continuing. "ends before it starts" carries a warning mark.

  Click selects (the ring a canvas card wears); double-click opens the record in the
  tray. The record already open in the tray wears the ring too. No ⤢.
-->
<template>
  <div class="chip" :class="[`tint-${event.tint}`, { 'open-l': openStart, 'open-r': openEnd, sel: selected, opened, tall }]"
       :data-event="event.id" :data-record="event.recordId" :title="title"
       @click.stop="$emit('select', event.id)" @dblclick.stop="$emit('open', event.recordId)">
    <span v-if="event.warn" class="chip-warn" :title="event.warn">⚠</span>
    <span class="chip-label">{{ event.label }}</span>
    <span v-if="tall" class="chip-span">{{ spanLabel(event.start, event.end) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { spanLabel, type CalendarEvent } from '../../contract/calendar';

const props = defineProps<{
  event: CalendarEvent;
  /** Runs on before / after this row: drawn open on that side. */
  openStart?: boolean;
  openEnd?: boolean;
  selected?: boolean;
  /** The record open in the tray. */
  opened?: boolean;
  /** The week layout's roomier chip: a second line with the dates. */
  tall?: boolean;
  /** The source's table, for the tooltip. */
  tableName?: string;
}>();
defineEmits<{ select: [eventId: string]; open: [recordId: string] }>();

const title = computed(() => [props.event.label, spanLabel(props.event.start, props.event.end) + (props.event.days > 1 ? ` (${props.event.days} days)` : ''),
  props.tableName, props.event.warn ? `⚠ ${props.event.warn}` : ''].filter(Boolean).join('\n'));
</script>

<style scoped>
.chip {
  display: flex; align-items: center; gap: 4px; min-width: 0; height: 18px; box-sizing: border-box;
  padding: 0 6px; font-size: 11px; line-height: 18px; cursor: default; user-select: none;
  background: var(--tint-wash); border-left: 3px solid var(--tint); border-radius: 3px; color: var(--text-primary);
}
.chip:hover { background: var(--tint-cap); }
.chip.open-l { border-left: none; border-top-left-radius: 0; border-bottom-left-radius: 0; padding-left: 9px; }
.chip.open-r { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.chip.sel, .chip.opened { box-shadow: 0 0 0 2px var(--accent); position: relative; z-index: 1; }
.chip.tall { height: 34px; flex-direction: column; align-items: flex-start; justify-content: center; gap: 0; line-height: 15px; }
.chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.chip-span { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.chip-warn { color: var(--warning); flex: none; }
.chip.tall .chip-warn { position: absolute; right: 4px; top: 2px; }
.chip.tall { position: relative; }
</style>
