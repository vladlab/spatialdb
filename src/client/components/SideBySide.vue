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
        <tr v-for="(r, i) in result.results" :key="i" class="sbs-row" :class="r.status">
          <td class="sbs-name">{{ nameOf(r.pair.from) }}</td>
          <td class="sbs-val">{{ r.found }}</td>
          <td class="sbs-rule" :title="r.detail">{{ mark(r.status) }} <span class="sbs-rulename">{{ RULE_LABELS[r.pair.rule] }}</span></td>
          <td class="sbs-val">{{ r.expected }}</td>
          <td class="sbs-name">{{ nameOf(r.pair.to) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Store } from '../store';
import { useDerived } from '../derived';
import { RULE_LABELS, type Status } from '../../contract/compare';

const props = defineProps<{ store: Store; linkId: string; ownerId: string; targetId: string }>();
defineEmits<{ close: [] }>();
const derived = useDerived(props.store);
const result = computed(() => derived.compare(props.linkId, props.ownerId, props.targetId));
const ownerLabel = computed(() => derived.labelOfId(props.ownerId));
const targetLabel = computed(() => derived.labelOfId(props.targetId));
const nameOf = (id: string) => props.store.state.fields.get(id)?.name ?? '?';
const mark = (s: Status) => ({ match: '✓', differ: '✗', missing: '∅', unspecified: '·' }[s]);
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
.sbs-row.differ .sbs-rule, .sbs-row.missing .sbs-rule { color: var(--danger); font-weight: 700; }
.sbs-row.match .sbs-rule { color: var(--success); }
.sbs-row.unspecified td { color: var(--text-faint); }
</style>
