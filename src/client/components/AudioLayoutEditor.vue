<!--
  An audio layout, edited: TRACKS (the containers a vendor sees) and the CHANNELS in
  each. 12 mono tracks and "5.1 + 3× stereo" are the same twelve channels and a
  different layout — that difference is what this editor exists to record, and what
  the compare below exists to catch.

  Every action is one immediate, undoable write of the whole value (a layout is
  small, and each of these is a discrete act — like ticking a box). The operations
  themselves are pure functions in contract/shapes.ts; this file is buttons.

  COPY / PASTE is a feature, not a nicety: layouts are deliberately NOT their own
  table ("a copyable value is enough"), so moving a deliverable's spec onto an edit
  has to be one gesture. The copy is kept in the app (so it works on a plain-HTTP
  LAN, where browsers refuse clipboard access) and also offered to the system
  clipboard when that is allowed.

  COMPARE follows this record's LINKS — in either direction, through any link field
  — to records that have an audio layout of their own, and diffs against the one
  you pick. Nothing is hard-wired to "the deliverable": a file may target one
  deliverable and satisfy another, and you may want either.
-->
<template>
  <div class="al">
    <table v-if="layout.tracks.length" class="al-table">
      <tbody>
        <tr v-for="(t, i) in layout.tracks" :key="i" class="al-track" :class="{ picked: picked.has(i) }">
          <td class="al-pick"><input type="checkbox" :checked="picked.has(i)" title="Select, to merge" @change="togglePick(i)" /></td>
          <td class="al-n">{{ i + 1 }}</td>
          <td class="al-fmt">{{ trackFormat(t) }}</td>
          <td class="al-name"><input :value="t.name" placeholder="name — Full mix, M&E, Dialog…" @change="rename(i, ($event.target as HTMLInputElement).value)" /></td>
          <td class="al-ch" :title="t.channels.join(' ')">{{ t.channels.join(' ') }}</td>
          <td class="al-lang"><input :value="t.language ?? ''" placeholder="lang" maxlength="35" @change="setLang(i, ($event.target as HTMLInputElement).value)" /></td>
          <td class="al-acts">
            <button title="Move up" :disabled="i === 0" @click="apply(moveTrack(layout, i, -1))">↑</button>
            <button title="Move down" :disabled="i === layout.tracks.length - 1" @click="apply(moveTrack(layout, i, 1))">↓</button>
            <button class="split" title="Split into one mono track per channel" :disabled="t.channels.length < 2" @click="apply(splitTrack(layout, i))">split</button>
            <button class="x" title="Remove this track" @click="apply(removeTrack(layout, i))">×</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="al-empty">No tracks yet — add one below, or paste a layout copied from another record.</p>

    <div class="al-bar">
      <span class="al-label">add</span>
      <button v-for="p in LAYOUT_PRESETS" :key="p.id" class="al-btn add-preset" :data-preset="p.id" @click="apply(addPreset(layout, p.id))">{{ p.label }}</button>
      <button class="al-btn merge" :disabled="picked.size < 2" title="Merge the selected tracks into one" @click="merge">merge {{ picked.size > 1 ? picked.size : '' }}</button>
      <span class="spacer" />
      <button class="al-btn copy" :disabled="!layout.tracks.length" title="Copy this layout, to paste onto another record" @click="copy">copy</button>
      <button class="al-btn paste" :disabled="!clipboardLayout" :title="clipboardLayout ? `Replace with the copied layout: ${summarise('audio_layout', clipboardLayout)}` : 'Nothing copied yet'" @click="paste">paste</button>
    </div>

    <div class="al-bar">
      <span class="al-label">compare with</span>
      <select class="al-compare" :value="compareKey" @change="compareKey = ($event.target as HTMLSelectElement).value">
        <option value="">{{ candidates.length ? 'a linked record…' : 'no linked record has an audio layout' }}</option>
        <option v-for="c in candidates" :key="c.key" :value="c.key">{{ c.label }}</option>
      </select>
    </div>
    <div v-if="diff" class="al-diff" :class="{ same: diff.same }">
      <p class="al-verdict">{{ diff.same ? '✓ Matches' : '✗ Does not match' }} <span class="muted">— expected {{ diff.channelCount[0] }} ch, this has {{ diff.channelCount[1] }}</span></p>
      <p v-for="(issue, i) in diff.issues" :key="i" class="al-issue" :class="issue.kind"><b>{{ issue.kind }}</b> {{ issue.detail }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { Store } from '../store';
import { fieldsOf, type FieldRow } from '../state';
import { useDerived } from '../derived';
import {
  AudioLayout, LAYOUT_PRESETS, addPreset, diffLayouts, mergeTracks, moveTrack, removeTrack, shapeOf, splitTrack,
  summarise, trackFormat, type AudioLayout as Layout,
} from '../../contract/shapes';
import { layoutClipboard } from '../layoutClipboard';

const props = defineProps<{ store: Store; recordId: string; field: FieldRow; value: unknown }>();
const emit = defineEmits<{ set: [value: Layout]; unset: [] }>();
const derived = useDerived(props.store);

const layout = computed<Layout>(() => { const r = AudioLayout.safeParse(props.value); return r.success ? r.data : { tracks: [] }; });

/** Write the whole value. An empty layout is "no value", not `{ tracks: [] }`. */
function apply(next: Layout) {
  picked.clear();
  // Nothing changed (a name re-typed as it was, "stereo " trimmed back to "stereo"):
  // write nothing. A no-op mutation is a log row, a broadcast, and — worst — an undo
  // step that visibly does nothing when pressed.
  if (JSON.stringify(next) === JSON.stringify(layout.value)) return;
  if (next.tracks.length) emit('set', next); else emit('unset');
}
const rename = (i: number, name: string) => apply({ tracks: layout.value.tracks.map((t, k) => (k === i ? { ...t, name: name.trim() } : t)) });
function setLang(i: number, raw: string) {
  const language = raw.trim();
  apply({ tracks: layout.value.tracks.map((t, k) => { if (k !== i) return t; const { language: _old, ...rest } = t; void _old; return language ? { ...rest, language } : rest; }) });
}

const picked = reactive(new Set<number>());
const togglePick = (i: number) => { if (picked.has(i)) picked.delete(i); else picked.add(i); };
const merge = () => apply(mergeTracks(layout.value, [...picked]));

/* ── copy / paste ── */
const clipboardLayout = computed(() => layoutClipboard.value);
function copy() {
  layoutClipboard.value = JSON.parse(JSON.stringify(layout.value));
  // Best effort: unavailable outside a secure context (plain HTTP on a LAN).
  try { void navigator.clipboard?.writeText(JSON.stringify(layout.value, null, 2)).catch(() => {}); } catch { /* not allowed here */ }
}
function paste() { if (layoutClipboard.value) apply(JSON.parse(JSON.stringify(layoutClipboard.value))); }

/* ── compare ── */
const compareKey = ref('');
watch(() => props.recordId, () => { compareKey.value = ''; });

/** Records linked to this one, either way, through any link field. */
const linkedIds = computed(() => {
  const me = props.store.state.records.get(props.recordId);
  const ids = new Set<string>();
  if (!me) return ids;
  for (const f of fieldsOf(props.store.state, me.table_id)) if (f.type === 'link') for (const id of derived.linksFrom(props.recordId, f.id)) ids.add(id);
  for (const ref of derived.referencedBy(props.recordId)) for (const id of ref.from) ids.add(id);
  ids.delete(props.recordId);
  return ids;
});
// A linked record's VALUES are only here if its table has been loaded; ask for them.
// Outgoing links point at the field's target table; incoming ones come from the
// table the link field belongs to.
watch(linkedIds, () => {
  const tables = new Set<string>();
  for (const l of props.store.state.links.values()) {
    if (l.from_record !== props.recordId && l.to_record !== props.recordId) continue;
    const f = props.store.state.fields.get(l.field_id);
    if (!f) continue;
    tables.add(f.table_id);
    if (typeof f.options?.target_table_id === 'string') tables.add(f.options.target_table_id);
  }
  for (const t of tables) void props.store.loadTable(t);
}, { immediate: true });

const candidates = computed(() => {
  const out: Array<{ key: string; label: string; layout: Layout }> = [];
  for (const id of linkedIds.value) {
    const rec = props.store.state.records.get(id);
    if (!rec) continue;
    for (const f of fieldsOf(props.store.state, rec.table_id)) {
      if (f.type !== 'structured' || shapeOf(f) !== 'audio_layout') continue;
      const r = AudioLayout.safeParse(rec.data[f.key]);
      if (!r.success || !r.data.tracks.length) continue;
      const table = props.store.state.tables.get(rec.table_id)?.name ?? '';
      out.push({ key: id + f.id, label: `${table} · ${derived.labelOfId(id)} — ${summarise('audio_layout', r.data)}`, layout: r.data });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
});
/** The OTHER record is what is expected; this one is what was found. */
const diff = computed(() => { const c = candidates.value.find((x) => x.key === compareKey.value); return c ? diffLayouts(c.layout, layout.value) : null; });
</script>

<style scoped>
.al { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.al-table { width: 100%; border-collapse: collapse; }
.al-track td { padding: 2px 4px; border-bottom: 1px solid var(--border-main); vertical-align: middle; }
.al-track.picked td { background: rgba(66, 165, 245, 0.12); }
.al-pick { width: 1%; } .al-pick input { margin: 0; }
.al-n { width: 1%; color: var(--text-faint); text-align: right; }
.al-fmt { width: 1%; white-space: nowrap; color: var(--accent); font-weight: 600; }
.al-name input, .al-lang input { width: 100%; box-sizing: border-box; background: none; border: 1px solid transparent; border-radius: 3px; color: inherit; font: inherit; padding: 1px 4px; }
.al-name input:hover, .al-lang input:hover, .al-name input:focus, .al-lang input:focus { border-color: var(--border-main); outline: none; }
.al-lang { width: 52px; }
.al-ch { font-family: ui-monospace, monospace; font-size: 11px; color: var(--text-secondary); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.al-acts { width: 1%; white-space: nowrap; text-align: right; }
.al-acts button { background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: 11px; padding: 0 3px; }
.al-acts button:hover:not(:disabled) { color: var(--accent); }
.al-acts button:disabled { opacity: 0.25; cursor: default; }
.al-acts .x:hover { color: var(--danger) !important; }
.al-empty { margin: 0; color: var(--text-faint); font-size: 11px; }
.al-bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.al-label { color: var(--text-faint); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 2px; }
.al-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 1px 8px; cursor: pointer; font: inherit; font-size: 11px; }
.al-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.al-btn:disabled { opacity: 0.35; cursor: default; }
.spacer { flex: 1; }
.al-compare { flex: 1; min-width: 0; background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 2px 6px; font: inherit; font-size: 11px; }
.al-diff { border: 1px solid var(--danger); border-radius: 4px; padding: 6px 8px; }
.al-diff.same { border-color: var(--success); }
.al-verdict { margin: 0 0 2px; font-weight: 600; }
.al-diff.same .al-verdict { color: var(--success); }
.al-issue { margin: 2px 0 0; }
.al-issue b { text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; margin-right: 6px; color: var(--danger); }
.al-issue.name b, .al-issue.language b { color: var(--warning); }
.muted { color: var(--text-muted); font-weight: 400; }
</style>
