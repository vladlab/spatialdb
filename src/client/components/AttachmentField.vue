<!--
  An `attachment` field: files that belong to a record — reference stills, the PDF
  a note is about, and later the waveform and QC images the Tauri client produces.

  The VALUE is a list of asset ids and nothing else (contract/richtext.ts). Bytes
  go to the asset store first; only then is the id added to the value. So this
  component needs the server to add a file — it says so plainly if it cannot
  reach it, rather than queueing blobs.

  Every change is written at once (each is a discrete act, like ticking a box), so
  there is no draft and nothing to cancel. Removing a file removes it from THIS
  RECORD; the asset itself stays in the store — another record may use the same
  bytes, and nothing deletes assets yet (PLAN.md).

  Add by: the button, dropping files on it, or pasting while it is focused.
-->
<template>
  <div class="attach" :class="{ over }" tabindex="0"
       @dragover.prevent="over = true" @dragleave="over = false" @drop.prevent="onDrop" @paste="onPaste"
       @click.stop @keydown.stop>
    <div v-for="id in ids" :key="id" class="att" :title="meta(id)?.name || id">
      <a :href="store.assetUrl(id)" target="_blank" rel="noopener" class="att-open">
        <img v-if="isImage(id)" :src="store.assetUrl(id)" :alt="meta(id)?.name ?? ''" loading="lazy" />
        <span v-else class="att-doc">{{ ext(id) }}</span>
      </a>
      <span class="att-name">{{ meta(id)?.name || '…' }}</span>
      <button class="att-x" title="Remove from this record (the file is kept)" @click="remove(id)">×</button>
    </div>

    <button class="att-add" :disabled="busy > 0" @click="picker?.click()">
      {{ busy ? `uploading ${busy}…` : '+ add files' }}
    </button>
    <input ref="picker" type="file" multiple hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" @change="onPick" />
    <p v-if="error" class="att-error">{{ error }}</p>
    <p v-else-if="!ids.length && !busy" class="att-hint">drop files here, paste, or use the button — images and PDF</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Store } from '../store';
import { attachmentError } from '../../contract/richtext';

const props = defineProps<{ store: Store; fieldKey: string; value: unknown }>();
const emit = defineEmits<{ set: [key: string, value: unknown]; unset: [key: string] }>();

const picker = ref<HTMLInputElement>();
const over = ref(false);
const busy = ref(0);
const error = ref('');

const ids = computed(() => (Array.isArray(props.value) ? props.value.filter((v): v is string => typeof v === 'string') : []));
const meta = (id: string) => props.store.assetMeta.get(id);
const isImage = (id: string) => meta(id)?.mime.startsWith('image/') ?? false;
const ext = (id: string) => (meta(id)?.mime === 'application/pdf' ? 'PDF' : '…');

// Names, types and sizes are not in the value — fetch them for whatever is listed.
watch(ids, (now) => void props.store.ensureAssetMeta(now), { immediate: true });

function write(next: string[]) {
  if (!next.length) { emit('unset', props.fieldKey); return; }
  const err = attachmentError(props.fieldKey, next);
  if (err) { error.value = err; return; }
  emit('set', props.fieldKey, next);
}

async function addFiles(files: File[]) {
  error.value = '';
  // Collected first, written ONCE: ten dropped files are one mutation, one undo.
  const added: string[] = [];
  for (const f of files) {
    busy.value++;
    try { added.push((await props.store.uploadAsset(f, f.name)).id); }
    catch (e) { error.value = `${f.name}: ${(e as Error).message}`; }
    finally { busy.value--; }
  }
  const next = [...ids.value];
  for (const id of added) if (!next.includes(id)) next.push(id);   // same bytes twice = one asset
  if (next.length !== ids.value.length) write(next);
}

const remove = (id: string) => write(ids.value.filter((x) => x !== id));
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  void addFiles([...(input.files ?? [])]);
  input.value = '';                       // so picking the same file again still fires
}
function onDrop(e: DragEvent) { over.value = false; void addFiles([...(e.dataTransfer?.files ?? [])]); }
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) { e.preventDefault(); void addFiles(files); }
}
</script>

<style scoped>
.attach {
  width: 100%; display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; outline: none;
  border-radius: 4px; padding: 2px;
}
.attach.over { box-shadow: 0 0 0 2px var(--accent); }
.att { position: relative; width: 96px; font-size: 11px; }
.att-open {
  display: flex; align-items: center; justify-content: center; width: 96px; height: 72px;
  background: var(--controls-bg); border: 1px solid var(--border-main); border-radius: 4px; overflow: hidden;
}
.att-open img { max-width: 100%; max-height: 100%; object-fit: contain; }
.att-doc { color: var(--text-muted); font-weight: 600; letter-spacing: 0.06em; }
.att-name { display: block; margin-top: 2px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-x {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; line-height: 1; padding: 0;
  border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.6); color: #fff; cursor: pointer; visibility: hidden;
}
.att:hover .att-x { visibility: visible; }
.att-add {
  height: 72px; padding: 0 12px; background: none; border: 1px dashed var(--border-main);
  color: var(--text-muted); border-radius: 4px; cursor: pointer; font: inherit; font-size: 12px;
}
.att-add:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.att-hint, .att-error { width: 100%; margin: 0; font-size: 11px; color: var(--text-faint); }
.att-error { color: var(--danger); }
</style>
