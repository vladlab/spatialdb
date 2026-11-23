<!--
  Renders the dialog at the head of client/dialogs.ts's queue. Mounted once, by App.

  Enter confirms, Escape cancels, a click on the backdrop cancels. A DANGEROUS
  confirm (deleting something) does not take Enter from the keyboard by accident:
  focus starts on Cancel, so a stray Enter backs out rather than deletes.
-->
<template>
  <div v-if="current" class="dlg-backdrop" @mousedown.self="cancel">
    <div class="dlg" :class="{ wide: !!compare }" role="dialog" aria-modal="true" @keydown.stop="onKey">
      <h2>{{ current.opts.title }}</h2>

      <template v-if="current.kind === 'ask'">
        <p v-if="current.opts.body" class="dlg-body">{{ current.opts.body }}</p>
        <label v-if="!current.opts.noText" class="dlg-field">
          <span v-if="current.opts.label">{{ current.opts.label }}</span>
          <input ref="input" v-model="value" class="dlg-input" :type="current.opts.password ? 'password' : 'text'"
                 :autocomplete="current.opts.password ? 'new-password' : 'off'" :placeholder="current.opts.placeholder" />
        </label>
        <label v-if="current.opts.select" class="dlg-field">
          <span>{{ current.opts.select.label }}</span>
          <select v-model="choice" class="dlg-select">
            <option v-for="o in current.opts.select.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label v-for="c in current.opts.checkboxes ?? []" :key="c.key" class="dlg-check" :title="c.hint">
          <input v-model="checks[c.key]" type="checkbox" /> {{ c.label }}
          <span v-if="c.hint" class="dlg-hint">{{ c.hint }}</span>
        </label>
      </template>
      <template v-else>
        <!-- Before / after (a file dropped onto a record): the verdict, then both sides row by row, what differs marked. -->
        <template v-if="compare">
          <p v-if="compare.verdict" class="dlg-verdict" :class="compare.verdict.tone">{{ compare.verdict.text }}</p>
          <table class="dlg-compare">
            <thead><tr><th></th><th v-for="h in compare.head" :key="h">{{ h }}</th></tr></thead>
            <tbody>
              <tr v-for="r in compare.rows" :key="r.label" :class="{ differs: r.differs }">
                <th>{{ r.label }}</th>
                <td v-for="(c, i) in r.cells" :key="i">{{ c }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-if="current.opts.body" class="dlg-body">{{ current.opts.body }}</p>
      </template>

      <footer>
        <button v-if="!(current.kind === 'confirm' && current.opts.noCancel)" ref="cancelBtn" class="dlg-cancel" @click="cancel">{{ current.kind === 'confirm' && current.opts.cancelText ? current.opts.cancelText : 'Cancel' }}</button>
        <button ref="okBtn" class="dlg-ok" :class="{ danger: current.opts.danger }" :disabled="blocked" @click="ok">
          {{ current.opts.okText ?? (current.kind === 'confirm' ? 'OK' : 'Create') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { dialogQueue, settle } from '../dialogs';

const current = computed(() => dialogQueue[0]);
const compare = computed(() => (current.value?.kind === 'confirm' ? current.value.opts.compare : undefined));
const value = ref('');
const choice = ref('');
const checks = reactive<Record<string, boolean>>({});
const input = ref<HTMLInputElement>();
const okBtn = ref<HTMLButtonElement>();
const cancelBtn = ref<HTMLButtonElement>();

watch(current, (d) => {
  if (!d) return;
  for (const k of Object.keys(checks)) delete checks[k];
  if (d.kind === 'ask') {
    value.value = d.opts.initial ?? '';
    choice.value = d.opts.select?.initial ?? d.opts.select?.options[0]?.value ?? '';
    for (const c of d.opts.checkboxes ?? []) checks[c.key] = c.initial ?? false;
  }
  void nextTick(() => {
    if (d.kind === 'ask' && !d.opts.noText) { input.value?.focus(); input.value?.select(); }
    else if (d.kind === 'confirm' && d.opts.danger) cancelBtn.value?.focus();
    else okBtn.value?.focus();
  });
}, { immediate: true });

/** An ask with `mustMatch` cannot be confirmed — by click or by Enter — until it has been typed. */
const blocked = computed(() => {
  const d = current.value;
  return !!d && d.kind === 'ask' && d.opts.mustMatch !== undefined && value.value.trim() !== d.opts.mustMatch;
});

function ok() {
  const d = current.value;
  if (!d || blocked.value) return;
  settle(d.kind === 'confirm' ? true : { value: value.value, checks: { ...checks }, choice: choice.value });
}
const cancel = () => settle(null);

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); ok(); }
}
</script>

<style scoped>
.dlg-backdrop { position: fixed; inset: 0; z-index: 400; background: var(--bg-overlay); display: flex; justify-content: center; align-items: flex-start; padding-top: 18vh; }
.dlg { width: min(420px, 92vw); background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
.dlg.wide { width: min(680px, 94vw); }
h2 { margin: 0 0 12px; font-size: 15px; }
.dlg-verdict { margin: 0 0 10px; padding: 6px 10px; border-radius: 4px; border-left: 3px solid var(--border-main); background: var(--controls-bg); color: var(--text-primary); line-height: 1.4; }
.dlg-verdict.same { border-left-color: var(--success, var(--accent)); }
.dlg-verdict.differs { border-left-color: var(--warning); }
.dlg-compare { width: 100%; border-collapse: collapse; margin: 0 0 12px; table-layout: fixed; font-size: 12px; }
.dlg-compare th, .dlg-compare td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--border-main); }
.dlg-compare thead th { color: var(--text-muted); font-weight: 600; font-size: 11px; }
.dlg-compare th:first-child { width: 78px; color: var(--text-muted); font-weight: 400; white-space: nowrap; }
.dlg-compare td { color: var(--text-primary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.dlg-compare tr.differs th:first-child { color: var(--warning); font-weight: 600; }
.dlg-compare tr.differs td { background: color-mix(in srgb, var(--warning) 16%, transparent); }
.dlg-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; color: var(--text-muted); font-size: 11px; }
.dlg-input, .dlg-select { background: var(--controls-bg); border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 6px 8px; font: inherit; font-size: 13px; }
.dlg-input:focus, .dlg-select:focus { outline: none; border-color: var(--accent); }
.dlg-check { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; cursor: pointer; }
.dlg-hint { flex-basis: 100%; color: var(--text-muted); font-size: 11px; padding-left: 22px; }
.dlg-body { margin: 0 0 14px; color: var(--text-secondary); white-space: pre-line; line-height: 1.45; max-height: 60vh; overflow-y: auto; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
button { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 5px 14px; cursor: pointer; font: inherit; }
button:focus { outline: none; border-color: var(--accent); }
.dlg-ok { color: var(--accent); border-color: var(--accent); }
.dlg-ok.danger { color: var(--danger); border-color: var(--danger); }
.dlg-ok:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
