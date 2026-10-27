<!--
  A timeline's audio tracks, READ-ONLY (RESOLVE-BRIEF.md R1.3): what the Resolve
  tool read off a timeline — every audio lane, its format as Resolve says it, and
  the clips on it. Resolve is the source of truth: change it there and ingest
  again, so there is no editor and no "edit as JSON" (StructuredField.vue).

    A1 · stereo                                   1 clip
      EP101_Mix_ST.wav    00:59:30:00 → 01:52:15:16   00:52:45:16
      /mnt/post/EP101_Mix_ST.wav                              ⤴ show

  A header row per track, a row per clip: its name, in and out (the out EXCLUSIVE,
  as the shape has it), and its length. The length is said at the RECORD's rate —
  the field the table's Resolve recipe maps Frame rate (and Drop frame) to — and,
  when the record has none, in frames. A clip with a file shows its path, with
  ⤴ show in the desktop app; one without ("tone") says so.

  Long lists scroll inside a fixed-height box, like a manifest's members, so a
  timeline with forty stems does not push the rest of the record off the tray.
-->
<template>
  <div v-if="ta" class="ta">
    <p v-if="!tracks.length" class="ta-line muted">No audio tracks on this timeline.</p>
    <div v-else class="ta-scroll">
      <table class="ta-table">
        <tbody v-for="t in tracks" :key="t.index" class="ta-track">
          <tr class="ta-head">
            <th colspan="3"><span class="ta-name">{{ t.name || `A${t.index}` }}</span><span class="ta-format">{{ t.format }}</span></th>
            <th class="ta-count">{{ t.clips.length === 1 ? '1 clip' : `${t.clips.length} clips` }}</th>
          </tr>
          <tr v-if="!t.clips.length" class="ta-clip"><td colspan="4" class="muted">no clips</td></tr>
          <template v-for="(c, i) in t.clips" :key="i">
            <tr class="ta-clip">
              <td class="ta-clip-name" :title="c.name">{{ c.name }}</td>
              <td class="ta-tc">{{ c.start }}</td>
              <td class="ta-tc">→ {{ c.end }}</td>
              <td class="ta-len" :title="`${c.frames.toLocaleString()} frames`">{{ lengthOf(c.frames) }}</td>
            </tr>
            <tr class="ta-path-row">
              <td v-if="c.path" colspan="4" class="ta-path"><div class="ta-path-in"><span class="ta-path-text" :title="c.path">{{ c.path }}</span><button v-if="desktop" class="reveal" title="Show in folder" @click.stop="reveal(c.path)">⤴ show</button></div></td>
              <td v-else colspan="4" class="ta-path ta-nofile">no file</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-if="base" class="ta-line muted ta-foot">lengths at {{ baseLabel(base) }} — the record's frame rate</p>
  </div>
  <p v-else class="ta-line ta-bad">This value is not a valid list of timeline audio tracks.</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { fieldsOf } from '../state';
import { invoke, isDesktop, notice } from '../desktop';
import { TimelineAudio } from '../../contract/shapes';
import { baseLabel, canDrop, formatLength, TC_RATES, type TcBase } from '../../contract/timecode';
import { resolveMap, type TablesTools } from '../../contract/tools';

const props = defineProps<{ store: Store; recordId: string; value: unknown }>();

const ta = computed(() => { const r = TimelineAudio.safeParse(props.value); return r.success ? r.data : null; });
const tracks = computed(() => [...(ta.value?.tracks ?? [])].sort((a, b) => a.index - b.index));

/** The record's own timecode base: where its table's Resolve recipe writes Frame rate and Drop frame. */
const base = computed<TcBase | null>(() => {
  const r = props.store.state.records.get(props.recordId);
  const step = r ? (props.store.state.tables.get(r.table_id)?.tools as Partial<TablesTools> | undefined)?.resolve?.steps[0] : undefined;
  if (!r || !step) return null;
  const map = resolveMap(step, fieldsOf(props.store.state, r.table_id));
  const rk = map.get('frame_rate'), dk = map.get('drop_frame');
  const rate = rk ? r.data[rk] : undefined;
  if (typeof rate !== 'number' || !(TC_RATES as readonly number[]).includes(rate)) return null;
  return { rate, drop: canDrop(rate) && dk !== undefined && r.data[dk] === true };
});
const lengthOf = (frames: number) => (base.value ? formatLength(frames, base.value) : `${frames.toLocaleString()} fr`);

const desktop = isDesktop();
const reveal = (path: string) => invoke<string>('reveal', { path })
  .then((r) => { if (r === 'folder') notice('The file is not there any more — its folder was opened.', 'info'); })
  .catch((e) => notice(String(e), 'error'));
</script>

<style scoped>
.ta { font-size: 12px; min-width: 0; }
.ta-line { margin: 0 0 2px; }
.muted { color: var(--text-muted); }
.ta-bad { color: var(--warning); }
.ta-foot { margin-top: 4px; font-size: 11px; }
.ta-scroll { max-height: 260px; overflow-y: auto; border: 1px solid var(--border-main); border-radius: 4px; }
.ta-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
.ta-table td, .ta-table th { padding: 2px 8px; }
/* A track's header: the grid's group-header language — a tinted band. */
.ta-head th { text-align: left; font-weight: 600; background: color-mix(in srgb, var(--accent) 12%, transparent); border-top: 1px solid var(--border-main); }
.ta-track:first-child .ta-head th { border-top: none; }
.ta-name { color: var(--text-primary); }
.ta-format { margin-left: 8px; color: var(--accent); font-weight: 600; }
.ta-count { text-align: right; color: var(--text-muted); font-weight: 400; width: 64px; }
.ta-clip td { padding-top: 4px; }
.ta-clip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 40%; }
.ta-tc { font-family: ui-monospace, monospace; white-space: nowrap; color: var(--text-secondary); width: 22%; }
.ta-len { font-family: ui-monospace, monospace; white-space: nowrap; text-align: right; color: var(--text-muted); width: 64px; }
.ta-path-row td { padding-top: 0; padding-bottom: 4px; border-bottom: 1px solid var(--border-main); }
.ta-track tr:last-child td { border-bottom: none; }
.ta-path { font-family: ui-monospace, monospace; color: var(--text-muted); padding-left: 16px !important; }
.ta-path-in { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ta-nofile { font-family: inherit; font-style: italic; }
.ta-path-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.reveal { flex: none; font-size: 10px; background: none; border: 1px solid var(--border-main); color: var(--text-muted); border-radius: 3px; padding: 0 5px; cursor: pointer; font-family: inherit; }
.reveal:hover { color: var(--accent); border-color: var(--accent); }
</style>
