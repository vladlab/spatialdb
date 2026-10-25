<!--
  The MONTH and WEEK layouts (VIEWS-BRIEF.md B3, B5): rows of seven days, Monday
  first, each row a CSS grid whose columns are the days. The day cells are drawn
  behind, spanning every track; each event is packed into a TRACK by `placeEvents`
  (contract/calendar.ts) and placed by grid-column / grid-row, so a span is one
  element per row it crosses and overlapping events stack without colliding.

  Month: 4–6 rows; days outside the month dimmed. Week: one row, taller chips with
  their dates. A row grows to fit its tracks — nothing is hidden behind "+3 more",
  and nothing moves when you hover.

  Read-only in round 4: click selects, double-click opens the record.
-->
<template>
  <div class="cg" :class="{ week: tall }">
    <div class="cg-head">
      <span v-for="(d, i) in WEEKDAY_SHORT" :key="d" class="cg-dow" :class="{ weekend: i >= 5, today: tall && weeks[0][i] === today }">
        <span class="cg-dow-name">{{ d }}</span><span v-if="tall" class="cg-dow-date">{{ dayCellLabel(weeks[0][i]) }}</span>
      </span>
    </div>
    <div v-for="(week, wi) in rows" :key="week.days[0]" class="cg-week" :data-week="week.days[0]"
         :style="{ gridTemplateRows: `${tall ? 4 : 22}px repeat(${week.tracks}, ${tall ? 38 : 22}px) minmax(${tall ? 24 : 8}px, 1fr)` }">
      <div v-for="(d, i) in week.days" :key="d" class="cg-day" :data-day="d"
           :class="{ out: !inPeriod(d), weekend: isWeekend(d), today: d === today }"
           :style="{ gridColumn: `${i + 1}`, gridRow: '1 / -1' }">
        <span v-if="!tall" class="cg-num">{{ dayCellLabel(d) }}</span>
      </div>
      <CalendarChip v-for="p in week.placed" :key="p.event.id + ':' + wi" class="cg-chip" :event="p.event"
                    :style="{ gridColumn: `${p.fromCol + 1} / ${p.toCol + 2}`, gridRow: `${p.track + 2}` }"
                    :open-start="p.continuesBefore" :open-end="p.continuesAfter" :tall="tall"
                    :selected="p.event.id === selectedId" :opened="p.event.recordId === openRecordId"
                    :table-name="tableNames.get(p.event.tableId)"
                    @select="$emit('select', $event)" @open="$emit('open', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CalendarChip from './CalendarChip.vue';
import { WEEKDAY_SHORT, dayCellLabel, isWeekend, placeEvents, type CalendarEvent } from '../../contract/calendar';

const props = defineProps<{
  weeks: string[][];
  events: CalendarEvent[];
  inPeriod: (iso: string) => boolean;
  today: string;
  /** The week layout: one row, roomier chips. */
  tall?: boolean;
  selectedId?: string;
  openRecordId?: string;
  tableNames: Map<string, string>;
}>();
defineEmits<{ select: [eventId: string]; open: [recordId: string] }>();

const rows = computed(() => props.weeks.map((days) => {
  const { placed, tracks } = placeEvents(props.events, days);
  return { days, placed, tracks };
}));
</script>

<style scoped>
.cg { display: flex; flex-direction: column; min-width: 560px; font-size: 12px; }
.cg-head { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--border-main); position: sticky; top: 0; z-index: 2; background: var(--bg-app); }
.cg-dow { padding: 4px 6px; color: var(--text-muted); font-size: 11px; }
.cg-dow.weekend { color: var(--text-faint); }
.cg-dow-date { margin-left: 5px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.cg-dow.today .cg-dow-date { color: var(--accent); font-weight: 600; }
.cg-week {
  display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); row-gap: 2px;
  min-height: 92px; border-bottom: 1px solid var(--border-main);
}
.cg.week .cg-week { min-height: 240px; flex: 1; }
.cg-day { border-right: 1px solid var(--border-main); padding: 2px 6px; min-width: 0; }
.cg-day:last-child { border-right: none; }
.cg-day.weekend { background: rgba(255, 255, 255, 0.02); }
.cg-day.out { opacity: 0.45; }
.cg-day.today { box-shadow: inset 0 2px 0 var(--accent); }
.cg-num { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.cg-day.today .cg-num { color: var(--accent); font-weight: 600; }
.cg-chip { margin: 0 3px; z-index: 1; }
.cg-chip.open-l { margin-left: 0; }
.cg-chip.open-r { margin-right: 0; }
</style>
