<!--
  Two records SIDE BY SIDE through a comparing link: the owner (found) on the left,
  the target (expected) on the right, paired fields aligned, each row marked with its
  verdict. Read-only; the values are the records' own, live. COMPARE-BRIEF.md §4.
-->
<template>
  <div class="sbs">
    <header class="sbs-head">
      <span class="sbs-col">{{ ownerLabel }} <i>found</i></span>
      <span class="sbs-mid" />
      <span class="sbs-col">{{ targetLabel }} <i>expected</i></span>
      <button class="sbs-close" title="Close" @click="$emit('close')">×</button>
    </header>
    <p class="sbs-verdict" :class="{ same: result?.same }">
      {{ result ? (result.same ? '✓ No differences' : `✗ ${result.results.filter((r) => r.status === 'differ' || r.status === 'missing').length} difference(s)`) : 'loading…' }}
    </p>
    <table v-if="result" class="sbs-table">
      <tbody>
        <template v-for="(r, i) in result.results" :key="i">
          <tr class="sbs-row" :class="r.status">
            <td class="sbs-name">{{ nameOf(r.pair.from) }}</td>
            <td class="sbs-val">{{ r.found }}</td>
            <td class="sbs-rule" :title="r.detail">{{ mark(r.status) }} <span class="sbs-rulename">{{ RULE_LABELS[r.pair.rule] }}</span></td>
            <td class="sbs-val">{{ r.expected }}</td>
            <td class="sbs-name">{{ nameOf(r.pair.to) }}</td>
          </tr>
          <!-- An AUDIO LAYOUT pair: the two layouts track by track, aligned, the differing
               tracks marked — JSON told nobody what was wrong. Then the diff's own words. -->
          <tr v-if="r.layouts" class="sbs-layout" :class="r.status">
            <td />
            <td colspan="3" class="sbs-tracks">
              <div class="tr-grid">
                <template v-for="k in Math.max(r.layouts.found.tracks.length, r.layouts.expected.tracks.length)" :key="k">
                  <span class="tr-cell found" :class="{ off: trackOff(r, k - 1) }">{{ trackText(r.layouts.found.tracks[k - 1]) }}</span>
                  <span class="tr-n">{{ k }}</span>
                  <span class="tr-cell expected" :class="{ off: trackOff(r, k - 1) }">{{ trackText(r.layouts.expected.tracks[k - 1]) }}</span>
                </template>
              </div>
              <ul v-if="r.layouts.diff.issues.length" class="tr-issues">
                <li v-for="(iss, j) in r.layouts.diff.issues" :key="j"><b>{{ iss.kind }}</b>{{ iss.track !== undefined ? ` (track ${iss.track})` : '' }}: {{ iss.detail }}</li>
              </ul>
            </td>
            <td />
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { useDerived } from '../derived';
import { RULE_LABELS, type PairResult, type Status } from '../../contract/compare';
import { trackFormat, type AudioTrack } from '../../contract/shapes';

const props = defineProps<{ store: Store; linkId: string; ownerId: string; targetId: string }>();
defineEmits<{ close: [] }>();
const derived = useDerived(props.store);
const result = computed(() => derived.compare(props.linkId, props.ownerId, props.targetId));
const ownerLabel = computed(() => derived.labelOfId(props.ownerId));
const targetLabel = computed(() => derived.labelOfId(props.targetId));
const nameOf = (id: string) => props.store.state.fields.get(id)?.name ?? '?';
const mark = (s: Status) => ({ match: '✓', differ: '✗', missing: '∅', unspecified: '·' }[s]);
/** "5.1 · Full mix · L R C LFE Ls Rs · en" — or "—" for a track the other side has and this one lacks. */
const trackText = (t: AudioTrack | undefined) => (t ? [trackFormat(t), t.name || '(unnamed)', t.channels.join(' '), t.language ?? ''].filter(Boolean).join(' · ') : '—');
/** Is track `i` (1-based in the diff) one the diff points at, or beyond the shorter layout? */
function trackOff(r: PairResult, i: number): boolean {
  const l = r.layouts; if (!l) return false;
  if (i >= l.found.tracks.length || i >= l.expected.tracks.length) return true;
  if (l.diff.issues.some((x) => x.track === i + 1)) return true;
  // count / order / grouping issues have no track: every track is suspect.
  return l.diff.issues.some((x) => x.track === undefined && (x.kind === 'count' || x.kind === 'order' || x.kind === 'grouping'));
}
</script>

<style scoped>
.sbs { border: 1px solid var(--border-main); border-radius: 6px; margin: 8px 0; font-size: 12px; overflow: hidden; }
.sbs-head { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: var(--controls-bg); border-bottom: 1px solid var(--border-main); }
.sbs-col { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sbs-col i { color: var(--text-faint); font-size: 10px; font-style: normal; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 4px; }
.sbs-mid { width: 90px; }
.sbs-close { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; }
.sbs-verdict { margin: 0; padding: 4px 8px; font-weight: 600; color: var(--danger); border-bottom: 1px solid var(--border-main); }
.sbs-verdict.same { color: var(--success); }
.sbs-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.sbs-row td { padding: 3px 6px; border-bottom: 1px solid var(--border-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sbs-name { color: var(--text-faint); font-size: 11px; width: 18%; }
.sbs-val { width: 27%; }
.sbs-rule { width: 10%; text-align: center; white-space: nowrap; }
.sbs-rulename { display: block; color: var(--text-faint); font-size: 9px; }
.sbs-row.differ .sbs-val, .sbs-row.missing .sbs-val { color: var(--danger); }
.sbs-layout td { padding: 0 6px 6px; border-bottom: 1px solid var(--border-main); }
.sbs-tracks { white-space: normal; }
.tr-grid { display: grid; grid-template-columns: 1fr 22px 1fr; gap: 1px 6px; align-items: center; font-family: var(--font-mono, monospace); font-size: 11px; }
.tr-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.tr-cell.off { color: var(--danger); }
.tr-n { text-align: center; color: var(--text-faint); }
.tr-issues { margin: 4px 0 0; padding-left: 16px; color: var(--text-secondary); font-size: 11px; }
.sbs-layout.match .tr-cell { color: var(--text-muted); }
.sbs-row.differ .sbs-rule, .sbs-row.missing .sbs-rule { color: var(--danger); font-weight: 700; }
.sbs-row.match .sbs-rule { color: var(--success); }
.sbs-row.unspecified td { color: var(--text-faint); }
</style>
