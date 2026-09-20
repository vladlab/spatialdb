<!--
  Renders the dialog at the head of client/dialogs.ts's queue. Mounted once, by App.

  Enter confirms, Escape cancels, a click on the backdrop cancels. A DANGEROUS
  confirm (deleting something) does not take Enter from the keyboard by accident:
  focus starts on Cancel, so a stray Enter backs out rather than deletes.
-->
<template>
  <div v-if="current" class="dlg-backdrop" @mousedown.self="cancel">
    <div class="dlg" role="dialog" aria-modal="true" @keydown.stop="onKey">
      <h2>{{ current.opts.title }}</h2>

      <template v-if="current.kind === 'ask'">
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
      <p v-else-if="current.opts.body" class="dlg-body">{{ current.opts.body }}</p>

      <footer>
        <button ref="cancelBtn" class="dlg-cancel" @click="cancel">Cancel</button>
        <button ref="okBtn" class="dlg-ok" :class="{ danger: current.kind === 'confirm' && current.opts.danger }" @click="ok">
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

function ok() {
  const d = current.value;
  if (!d) return;
  settle(d.kind === 'confirm' ? true : { value: value.value, checks: { ...checks }, choice: choice.value });
}
const cancel = () => settle(null);

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); ok(); }
}
</script>

<style scoped>
.dlg-backdrop { position: fixed; inset: 0; z-index: 400; background: rgba(0, 0, 0, 0.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 18vh; }
.dlg { width: min(420px, 92vw); background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 18px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
h2 { margin: 0 0 12px; font-size: 15px; }
.dlg-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; color: var(--text-muted); font-size: 11px; }
.dlg-input, .dlg-select { background: var(--controls-bg); border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 6px 8px; font: inherit; font-size: 13px; }
.dlg-input:focus, .dlg-select:focus { outline: none; border-color: var(--accent); }
.dlg-check { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; cursor: pointer; }
.dlg-hint { flex-basis: 100%; color: var(--text-muted); font-size: 11px; padding-left: 22px; }
.dlg-body { margin: 0 0 14px; color: var(--text-secondary); white-space: pre-line; line-height: 1.45; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
button { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 5px 14px; cursor: pointer; font: inherit; }
button:focus { outline: none; border-color: var(--accent); }
.dlg-ok { color: var(--accent); border-color: var(--accent); }
.dlg-ok.danger { color: var(--danger); border-color: var(--danger); }
</style>
