<!--
  A manifest, read-only: what a Files record physically is on disk.

    file          one line.
    bundle        a table of members (an IMF or DCP folder), with sizes.
    sequence      a frame-range line — never a file list; that is the point of the
                  shape — plus its gaps, if any.
    channel_set   the mono files of one mix, each with the channel it carries.

  Long member lists scroll inside a fixed-height box, so a 600-file DCP does not
  push the rest of the record off the tray.
-->
<template>
  <div v-if="m" class="mv">
    <p v-if="m.kind === 'file'" class="mv-line">One file · {{ formatBytes(m.size) }}<span v-if="m.hash" class="mv-hash" :title="m.hash"> · {{ short(m.hash) }}</span></p>

    <template v-else-if="m.kind === 'sequence'">
      <p class="mv-line"><code>{{ m.pattern }}</code></p>
      <p class="mv-line">frames {{ m.first }}–{{ m.last }} · {{ m.count.toLocaleString() }} files</p>
      <p v-if="m.gaps.length" class="mv-line mv-bad">missing: {{ m.gaps.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ') }}</p>
      <p v-else class="mv-line mv-ok">no gaps</p>
    </template>

    <template v-else>
      <p v-if="m.kind === 'bundle' && m.source" class="mv-line muted">read from {{ m.source }}</p>
      <div class="mv-scroll">
        <table class="mv-table">
          <tbody>
            <tr v-for="(x, i) in m.members" :key="i">
              <td v-if="m.kind === 'channel_set'" class="mv-ch">{{ (x as { channel: string }).channel }}</td>
              <td class="mv-path" :title="x.path">{{ x.path }}</td>
              <td v-if="m.kind === 'bundle'" class="mv-size">{{ formatBytes((x as { size: number }).size) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
  <p v-else class="mv-line mv-bad">This value is not a valid manifest — use “edit as JSON” to see it.</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Manifest, formatBytes } from '../../contract/shapes';

const props = defineProps<{ value: unknown }>();
const m = computed(() => { const r = Manifest.safeParse(props.value); return r.success ? r.data : null; });
const short = (h: string) => (h.length > 22 ? `${h.slice(0, 20)}…` : h);
</script>

<style scoped>
.mv { font-size: 12px; min-width: 0; }
.mv-line { margin: 0 0 2px; }
.mv-line code { font-size: 11px; word-break: break-all; }
.muted { color: var(--text-muted); }
.mv-hash { color: var(--text-muted); font-family: ui-monospace, monospace; font-size: 11px; }
.mv-ok { color: var(--success); }
.mv-bad { color: var(--warning); }
.mv-scroll { max-height: 220px; overflow-y: auto; border: 1px solid var(--border-main); border-radius: 4px; }
.mv-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.mv-table td { padding: 2px 8px; border-bottom: 1px solid var(--border-main); }
.mv-table tr:last-child td { border-bottom: none; }
.mv-path { font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 0; width: 100%; }
.mv-size, .mv-ch { white-space: nowrap; color: var(--text-muted); text-align: right; }
.mv-ch { text-align: left; color: var(--accent); font-weight: 600; width: 1%; }
</style>
