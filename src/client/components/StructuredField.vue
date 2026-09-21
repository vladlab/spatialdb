<!--
  A `structured` field in the record tray. It looks at the field's SHAPE and hands
  the value to whichever component knows that shape:

    manifest       ManifestView — READ-ONLY. A manifest is written by a tool (the
                   desktop drop tool), not typed; it describes files on disk, and a
                   hand-edited one would describe nothing.
    audio_layout   AudioLayoutEditor — tracks, presets, split/merge, copy/paste, compare.
    json           the raw editor below.

  EVERY shape also has "edit as JSON", behind a toggle: the escape hatch for fixing
  one wrong number in a manifest, or for a shape this build has no editor for. It
  saves only what contract/shapes.ts accepts — the same check the server makes —
  and says why when it will not.
-->
<template>
  <div class="sf" @click.stop @keydown.stop>
    <p class="sf-summary" :class="{ empty: value === undefined }">{{ summary || 'empty' }}</p>

    <template v-if="!raw">
      <ManifestView v-if="shape === 'manifest' && value !== undefined" :value="value" />
      <AudioLayoutEditor v-else-if="shape === 'audio_layout'" :store="store" :record-id="recordId" :field="field" :value="value"
                         @set="(v) => $emit('set', field.key, v)" @unset="$emit('unset', field.key)" />
    </template>

    <div v-if="raw" class="sf-raw">
      <textarea v-model="draft" class="sf-json" spellcheck="false" rows="10" />
      <p v-if="error" class="sf-error">{{ error }}</p>
      <div class="sf-line">
        <button class="sf-btn primary save-json" @click="saveRaw">save</button>
        <button class="sf-btn" @click="raw = false">cancel</button>
        <button v-if="value !== undefined" class="sf-btn danger" @click="$emit('unset', field.key); raw = false">clear</button>
      </div>
    </div>
    <button v-else class="sf-toggle edit-json" @click="openRaw">{{ shape === 'json' ? (value === undefined ? 'add…' : 'edit…') : 'edit as JSON…' }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Store } from '../store';
import type { FieldRow } from '../state';
import { shapeOf, structuredError, summarise } from '../../contract/shapes';
import ManifestView from './ManifestView.vue';
import AudioLayoutEditor from './AudioLayoutEditor.vue';

const props = defineProps<{ store: Store; recordId: string; field: FieldRow; value: unknown }>();
const emit = defineEmits<{ set: [key: string, value: unknown]; unset: [key: string] }>();

const shape = computed(() => shapeOf(props.field));
const summary = computed(() => summarise(shape.value, props.value));

const raw = ref(false);
const draft = ref('');
const error = ref('');
function openRaw() {
  draft.value = props.value === undefined ? '{\n  \n}' : JSON.stringify(props.value, null, 2);
  error.value = ''; raw.value = true;
}
function saveRaw() {
  let parsed: unknown;
  try { parsed = JSON.parse(draft.value); } catch (e) { error.value = `not valid JSON — ${(e as Error).message}`; return; }
  const err = structuredError(props.field.key, shape.value, parsed);
  if (err) { error.value = err; return; }
  emit('set', props.field.key, parsed);
  raw.value = false;
}
</script>

<style scoped>
.sf { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sf-summary { margin: 0; font-weight: 600; font-size: 12px; }
.sf-summary.empty { color: var(--text-faint); font-weight: 400; font-style: italic; }
.sf-toggle { align-self: flex-start; background: none; border: none; color: var(--text-muted); cursor: pointer; font: inherit; font-size: 11px; padding: 0; }
.sf-toggle:hover { color: var(--accent); }
.sf-json { width: 100%; box-sizing: border-box; background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 4px; color: var(--text-primary); font: 12px/1.45 ui-monospace, monospace; padding: 8px; resize: vertical; }
.sf-error { margin: 0; color: var(--danger); font-size: 11px; }
.sf-line { display: flex; gap: 6px; }
.sf-btn { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; font-size: 12px; }
.sf-btn.primary { color: var(--accent); border-color: var(--accent); }
.sf-btn.danger:hover { color: var(--danger); border-color: var(--danger); }
</style>
