<!--
  The AGENDA layout (VIEWS-BRIEF.md B3): the days of the period that have something
  on them, each with its events — `agendaGroups` (contract/calendar.ts) decides who
  goes where. A multi-day event is listed ONCE, under the day it starts, with its
  span; one that began before the period is listed under the first day, marked
  "continues". Today always has a heading when it is in the period, even with nothing
  on it, so you can find your place.

  Same gestures as a chip: click selects, double-click opens the record.
-->
<template>
  <div class="ag">
    <p v-if="!days.length" class="ag-empty">Nothing between {{ spanLabel(from, to) }}.</p>
    <section v-for="d in days" :key="d.day" class="ag-day" :class="{ today: d.day === today, weekend: isWeekend(d.day) }" :data-day="d.day">
      <h3 class="ag-date">{{ agendaDayLabel(d.day) }}<span v-if="d.day === today" class="ag-today">today</span></h3>
      <p v-if="!d.items.length" class="ag-none">nothing</p>
      <div v-for="it in d.items" :key="it.event.id" class="ag-item" :class="[`tint-${it.event.tint}`, { sel: it.event.id === selectedId, opened: it.event.recordId === openRecordId, continued: it.continued }]"
           :data-event="it.event.id" :data-record="it.event.recordId"
           @click.stop="$emit('select', it.event.id)" @dblclick.stop="$emit('open', it.event.recordId)">
        <i class="ag-swatch" />
        <span class="ag-label">{{ it.event.label }}</span>
        <span v-if="it.continued" class="ag-cont" :title="`Started ${spanLabel(it.event.start, it.event.start)}`">continues</span>
        <span v-if="it.event.days > 1" class="ag-span">{{ spanLabel(it.event.start, it.event.end) }} · {{ it.event.days }} days</span>
        <span v-if="it.event.warn" class="ag-warn" :title="it.event.warn">⚠ {{ it.event.warn }}</span>
        <span class="ag-table">{{ tableNames.get(it.event.tableId) }}</span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { agendaDayLabel, agendaGroups, isWeekend, spanLabel, type AgendaDay, type CalendarEvent } from '../../contract/calendar';

const props = defineProps<{
  events: CalendarEvent[];
  from: string;
  to: string;
  today: string;
  selectedId?: string;
  openRecordId?: string;
  tableNames: Map<string, string>;
}>();
defineEmits<{ select: [eventId: string]; open: [recordId: string] }>();

const days = computed<AgendaDay[]>(() => {
  const g = agendaGroups(props.events, props.from, props.to);
  // Today keeps its heading even with nothing on it — where you are, among what is coming.
  if (g.length && props.from <= props.today && props.today <= props.to && !g.some((d) => d.day === props.today)) {
    g.push({ day: props.today, items: [] });
    g.sort((a, b) => a.day.localeCompare(b.day));
  }
  return g;
});
</script>

<style scoped>
.ag { padding: 8px 16px 24px; max-width: 900px; font-size: 12px; }
.ag-empty { color: var(--text-faint); font-style: italic; margin: 16px 0; }
.ag-day { display: grid; grid-template-columns: 110px minmax(0, 1fr); column-gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border-main); }
.ag-date { grid-row: 1 / span 100; margin: 0; font-size: 12px; font-weight: 600; color: var(--text-secondary); padding-top: 3px; font-variant-numeric: tabular-nums; }
.ag-day.weekend .ag-date { color: var(--text-muted); }
.ag-day.today .ag-date { color: var(--accent); }
.ag-today { display: block; font-weight: 400; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.ag-none { margin: 0; padding: 3px 0; color: var(--text-faint); font-style: italic; }
.ag-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 8px; margin: 1px 0;
  border-radius: 3px; background: var(--tint-wash); border-left: 3px solid var(--tint); cursor: default; user-select: none;
}
.ag-item:hover { background: var(--tint-cap); }
.ag-item.sel, .ag-item.opened { box-shadow: 0 0 0 2px var(--accent); }
.ag-item.continued { border-left-style: dashed; }
.ag-swatch { display: none; }
.ag-label { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; }
.ag-cont { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; flex: none; }
.ag-span { color: var(--text-muted); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
.ag-warn { color: var(--warning); white-space: nowrap; flex: none; }
.ag-table { margin-left: auto; color: var(--text-faint); font-size: 11px; white-space: nowrap; flex: none; }
</style>
