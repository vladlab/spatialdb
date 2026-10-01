<!--
  A video layout, edited: what is on a file and where — a mini EDL. The strip on
  top is the picture of it (VideoLayoutStrip); the table under it is where it is
  typed. The rules of the shape are at the top of contract/videoLayout.ts; the two
  that shape this editor:

    START   typed, it is PINNED — and shown at full strength. Left empty, the item
            starts where the block before it ends: the cell then shows what was
            worked out, greyed, behind a ↳. So a head build is entered as the spec
            writes it ("3 seconds of black, then bars…") and a pinned block after it
            (picture at 01:00:00:00) is CHECKED against the sum — ✓, a gap, or an
            overlap, said in words under the table.
    LENGTH  "3s", "1m30s", "72f", "00:00:03:00" — or "open" for a length the spec
            does not know (the program), or nothing at all for a marker.

  Every change is one immediate, undoable write of the whole value, as in the audio
  layout editor; the operations are pure functions in the contract. A value this
  editor would write is checked with the same schema the server uses first — a
  refusal is said here, beside what was typed, not in a failed save.

  Copy / paste is the cell's own (Ctrl+C / Ctrl+V on the field — cellClipboard.ts
  carries a structured value to a field of the same shape), so there are no
  buttons for it here.
-->
<template>
  <div class="vl">
    <div class="vl-base">
      <select class="vl-rate" :value="String(layout.rate)" title="The rate the timecode counts at" @change="setRate(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="r in TC_RATES" :key="r" :value="String(r)">{{ r }} fps</option>
      </select>
      <label class="vl-drop" :class="{ off: !canDrop(layout.rate) }" :title="canDrop(layout.rate) ? 'Drop-frame timecode' : 'Drop-frame exists at 29.97 and 59.94'">
        <input type="checkbox" :checked="layout.drop" :disabled="!canDrop(layout.rate)" @change="setDrop(($event.target as HTMLInputElement).checked)" /> drop-frame
      </label>
    </div>

    <VideoLayoutStrip v-if="layout.items.length" class="vl-strip" :value="layout" />

    <table v-if="layout.items.length" class="vl-table">
      <thead>
        <tr class="vl-head">
          <th /><th>item</th><th>start</th><th>length</th><th class="vl-end" title="Where the next item starts (the out point, exclusive)">ends</th><th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in layout.items" :key="i" class="vl-item" :class="rows[i].type">
          <td class="vl-kind">
            <span v-if="rows[i].type === 'marker'" class="vl-pinmark" title="A marker: one frame to be aware of" />
            <span v-else class="vl-sw" :class="`vl-k-${it.kind ?? 'other'}`" :title="`${VIDEO_KIND_LABELS[it.kind ?? 'other']} — click to change (the kind sets the colour)`">
              <select class="vl-kindsel" :value="it.kind ?? 'other'" @change="setKind(i, ($event.target as HTMLSelectElement).value)">
                <option v-for="k in VIDEO_KINDS" :key="k" :value="k">{{ VIDEO_KIND_LABELS[k] }}</option>
              </select>
            </span>
          </td>
          <td class="vl-name"><input :value="it.label" maxlength="80" @change="relabel(i, ($event.target as HTMLInputElement).value)" /></td>
          <td class="vl-start">
            <input :value="it.start ?? ''" :placeholder="startHint(i)" :title="it.start ? 'Typed (pinned). Clear it to follow the item before.' : 'Empty: starts where the block before it ends. Type a timecode to pin it.'"
                   @change="setStart(i, $event.target as HTMLInputElement)" />
            <span v-if="rows[i].landed" class="vl-ok" title="The blocks before it add up to exactly this timecode">✓</span>
          </td>
          <td class="vl-len"><input :value="lenText(i)" title="3s · 1m30s · 72f · 00:00:03:00 · open (length unknown) · empty for a marker" @change="setLen(i, $event.target as HTMLInputElement)" /></td>
          <td class="vl-end">{{ endText(i) }}</td>
          <td class="vl-acts">
            <button title="Move up" :disabled="i === 0" @click="apply(moveItem(layout, i, -1))">↑</button>
            <button title="Move down" :disabled="i === layout.items.length - 1" @click="apply(moveItem(layout, i, 1))">↓</button>
            <button class="x" title="Remove this item" @click="apply(removeItem(layout, i))">×</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="vl-empty">No items yet — add the first below and give it a start timecode.</p>

    <p v-if="headLine" class="vl-note ok">✓ {{ headLine }}</p>
    <p v-for="(issue, i) in resolved.issues" :key="'is' + i" class="vl-note" :class="issue.kind">⚠ {{ issue.detail }}</p>
    <p v-if="unanchored" class="vl-note hint">No start timecode yet — type one on the first item and the rest follow.</p>
    <p v-if="error" class="vl-note error">{{ error }}</p>

    <div class="vl-bar">
      <span class="vl-label">add</span>
      <button v-for="p in VIDEO_PRESETS" :key="p.id" class="vl-btn add-item" :data-preset="p.id" @click="apply(addItem(layout, p.id))">{{ p.label }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import type { FieldRow } from '../state';
import { TC_RATES, canDrop, completeTc, formatLength, labelToTc, lengthToTc, parseLength, tcFps } from '../../contract/timecode';
import {
  VIDEO_KINDS, VIDEO_KIND_LABELS, VIDEO_PRESETS, VideoLayout, addItem, moveItem, patchItem, rebase, removeItem, resolveLayout,
  type VideoLayout as Layout,
} from '../../contract/videoLayout';
import VideoLayoutStrip from './VideoLayoutStrip.vue';

const props = defineProps<{ store: Store; recordId: string; field: FieldRow; value: unknown }>();
const emit = defineEmits<{ set: [value: Layout]; unset: [] }>();

/**
 * The base an EMPTY layout starts at. A layout with no items is no value at all, so
 * its rate has nowhere to be stored yet: it is kept here until the first item is
 * added. It starts from the record's own frame rate when it has one (a Files record
 * probed by the desktop client does), else 23.976.
 */
const recordRate = (): number => {
  const v = props.store.state.records.get(props.recordId)?.data.frame_rate;
  return typeof v === 'number' && (TC_RATES as readonly number[]).includes(v) ? v : 23.976;
};
const draftBase = ref({ rate: recordRate(), drop: false });

const layout = computed<Layout>(() => {
  const r = VideoLayout.safeParse(props.value);
  return r.success ? r.data : { rate: draftBase.value.rate, drop: draftBase.value.drop, items: [] };
});
const base = computed(() => ({ rate: layout.value.rate, drop: layout.value.drop }));
const resolved = computed(() => resolveLayout(layout.value));
const rows = computed(() => resolved.value.items);
const tc = (n: number) => labelToTc(n, base.value);

const error = ref('');

/** Write the whole value — if the schema the server uses accepts it. An empty layout is "no value". */
function apply(next: Layout) {
  error.value = '';
  if (JSON.stringify(next) === JSON.stringify(layout.value)) return;      // nothing changed: no log row, no dead undo step
  if (!next.items.length) { draftBase.value = { rate: next.rate, drop: next.drop }; if (props.value !== undefined) emit('unset'); return; }
  const r = VideoLayout.safeParse(next);
  if (!r.success) { error.value = r.error.issues[0].message; return; }
  emit('set', r.data);
}

const setRate = (rate: number) => apply(rebase(layout.value, rate, layout.value.drop));
const setDrop = (drop: boolean) => apply(rebase(layout.value, layout.value.rate, drop));
const relabel = (i: number, label: string) => apply(patchItem(layout.value, i, { label: label.trim() }));
const setKind = (i: number, kind: string) => apply(patchItem(layout.value, i, { kind: kind === 'other' ? undefined : kind }));

function setStart(i: number, input: HTMLInputElement) {
  const typed = input.value.trim();
  if (!typed) return apply(patchItem(layout.value, i, { start: undefined }));
  const start = completeTc(typed, base.value);
  if (!start) { error.value = `“${typed}” is not a timecode at ${layout.value.rate}${layout.value.drop ? ' drop-frame' : ''} — HH:MM:SS:FF, frames 00 to ${String(tcFps(layout.value.rate) - 1).padStart(2, '0')}`; return; }
  input.value = start;                                                    // "59:27:00" reads back as it is stored
  apply(patchItem(layout.value, i, { start }));
}

function setLen(i: number, input: HTMLInputElement) {
  const typed = input.value.trim().toLowerCase();
  if (!typed) return apply(patchItem(layout.value, i, { duration: undefined }));
  if (typed === 'open' || typed === '~' || typed === '?') { input.value = 'open'; return apply(patchItem(layout.value, i, { duration: 'open' })); }
  const n = parseLength(typed, base.value);
  if (n === null) { error.value = `“${typed}” is not a length — try 3s, 1m30s, 72f, 00:00:03:00, or “open”`; return; }
  if (n === 0) { error.value = 'A length of zero is a marker — clear the cell instead'; return; }
  if (n >= 24 * 3600 * tcFps(layout.value.rate)) { error.value = 'A length is under 24 hours'; return; }
  input.value = formatLength(n, base.value);
  apply(patchItem(layout.value, i, { duration: lengthToTc(n, base.value) }));
}

const lenText = (i: number) => { const r = rows.value[i]; return r.type === 'open' ? 'open' : r.type === 'span' ? formatLength(r.length!, base.value) : ''; };
const endText = (i: number) => { const r = rows.value[i]; return r.end !== null ? tc(r.end) : ''; };
/** What an empty start cell shows: the timecode worked out for it, or what it comes after, or a prompt. */
function startHint(i: number): string {
  const r = rows.value[i];
  if (r.start !== null) return `↳ ${tc(r.start)}`;
  if (r.follows !== null) return `↳ after ${rows.value[r.follows].label || `item ${r.follows + 1}`}`;
  return 'start tc';
}
const unanchored = computed(() => layout.value.items.length > 0 && resolved.value.fileStart === null);

/**
 * "Head adds up — 33s before Program lands on 01:00:00:00": said ONCE, for the
 * picture, when everything from the first frame of file to it is accounted for.
 * (Every pinned block that lands wears a ✓ in its row; a line for each would be
 * noise on a layout where every start is typed.)
 */
const headLine = computed(() => {
  const pic = rows.value.find((r) => r.type !== 'marker' && r.kind === 'picture');
  const file = resolved.value.fileStart;
  if (!pic || !pic.landed || file === null || resolved.value.issues.some((x) => x.item <= pic.index)) return '';
  return `Head adds up — ${formatLength(pic.start! - file, base.value)} before ${pic.label || 'picture'} lands on ${tc(pic.start!)}`;
});
</script>

<style scoped>
.vl { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; container-type: inline-size; }
/* ENDS is the one column that can be done without — an item's end is the next one's
   start, shown there behind its ↳ — so a narrow tray drops it rather than squeeze the
   names. Widen the tray and it is back. */
@container (max-width: 470px) { .vl-end { display: none; } }
.vl-base { display: flex; align-items: center; gap: 10px; }
.vl-rate { background: var(--controls-bg); color: var(--text-primary); border: 1px solid var(--border-main); border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 4px; }
.vl-drop { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); font-size: 11px; }
.vl-drop.off { color: var(--text-faint); }
.vl-drop input { margin: 0; }
.vl-strip { margin: 4px 0 2px; }
.vl-table { width: 100%; border-collapse: collapse; }
.vl-item td { padding: 2px 3px; border-bottom: 1px solid var(--border-main); vertical-align: middle; }
.vl-head th { padding: 0 4px 3px; text-align: left; font-weight: 400; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); border-bottom: 1px solid var(--border-main); }
.vl-kind { width: 1%; }
.vl-sw { position: relative; display: block; width: 12px; height: 12px; border-radius: 3px; --vl-a: 0.65; }
/* The swatch IS the kind picker: a native select laid invisibly over it. */
.vl-kindsel { position: absolute; inset: -3px; width: 18px; height: 18px; opacity: 0; cursor: pointer; }
.vl-pinmark { display: block; width: 0; height: 12px; margin-left: 5px; border-left: 1.5px solid var(--text-primary); }
.vl-item input { width: 100%; box-sizing: border-box; background: none; border: 1px solid transparent; border-radius: 3px; color: inherit; font: inherit; padding: 1px 4px; }
.vl-item input:hover, .vl-item input:focus { border-color: var(--border-main); outline: none; }
.vl-item input::placeholder { color: var(--text-muted); font-style: normal; }
.vl-start { width: 112px; white-space: nowrap; position: relative; }
.vl-start input, .vl-len input, .vl-end { font-family: ui-monospace, monospace; font-size: 11px; }
.vl-start input { width: 98px; }
.vl-ok { color: var(--success); font-weight: 600; margin-left: 2px; }
.vl-len { width: 92px; }
.vl-item .vl-end { width: 1%; white-space: nowrap; color: var(--text-muted); }
.vl-acts { width: 1%; white-space: nowrap; text-align: right; }
.vl-acts button { background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: 11px; padding: 0 3px; }
.vl-acts button:hover:not(:disabled) { color: var(--accent); }
.vl-acts button:disabled { opacity: 0.25; cursor: default; }
.vl-acts .x:hover { color: var(--danger) !important; }
.vl-empty { margin: 0; color: var(--text-faint); font-size: 11px; }
.vl-note { margin: 0; font-size: 11px; color: var(--text-secondary); }
.vl-note.ok { color: var(--success); }
.vl-note.gap { color: var(--warning); }
.vl-note.overlap, .vl-note.error { color: var(--danger); }
.vl-note.hint { color: var(--text-muted); }
.vl-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.vl-label { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 2px; }
.vl-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.vl-btn:hover { color: var(--accent); border-color: var(--accent); }
</style>
