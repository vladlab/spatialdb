<!--
  The rich text editor — a `rich_text` field, in the record tray.

  IT IS ALWAYS THERE. The first version swapped a rendered view for an editor when
  you clicked, and a toolbar appeared with it: the text shifted, the field's height
  changed, the fields below it moved, and the owner — rightly — called it jumpy.
  "I'd rather see more UI than get lost." So now:

    - the editor is mounted as long as the record is open; there is no view mode;
    - the toolbar is permanent;
    - the writing area has a FIXED height that only you change (drag its bottom
      edge; remembered in this browser), and scrolls inside itself;
    - a status word in the toolbar — saved · editing · uploading — says what state
      your words are in, since nothing else on screen changes when they are saved.

  SAVING. Still whole-value and still on the way OUT (click or tab away, or
  Ctrl+Enter): a document is one field value, a save is one logged, broadcast
  mutation carrying all of it, so per-keystroke saving would be thousands of log
  rows per note. Escape puts back what was last saved.

  TWO PEOPLE, ONE NOTE. Last write wins, but never silently:
    - not editing (no unsaved words of yours): a colleague's save simply appears;
    - editing: their version is NOT pushed into your editor while you type. When
      you save, the editor sees the value changed underneath it and stops to ask —
      keep yours (overwriting theirs) or take theirs (discarding yours).

  IMAGES go to the asset store on paste or drop and become asset-backed nodes
  (richtext/extensions.ts, richtext/paste.ts). Saving waits for uploads in flight.
-->
<template>
  <!-- @click.stop: this lives inside the panel's field area, which has click handlers of its own. -->
  <div class="rte" :class="{ focused, dirty }" @keydown="onKey" @focusout="onFocusOut" @focusin="focused = true" @click.stop>
    <div class="rte-bar" @mousedown.prevent>
      <button v-for="b in BUTTONS" :key="b.id" :class="{ on: b.on?.() }" :title="b.title" tabindex="-1" @click="b.run">{{ b.label }}</button>
      <span class="spacer" />
      <span class="rte-state" :class="state">{{ STATE_TEXT[state] }}</span>
    </div>

    <div ref="bodyEl" class="rte-body" :style="{ height: height + 'px' }" @click="editor?.commands.focus()">
      <EditorContent :editor="editor" />
    </div>

    <p v-if="notice" class="rte-notice">{{ notice }}</p>
    <div v-if="conflict" class="rte-conflict" @mousedown.prevent>
      <span>Someone else saved this note while you were editing it.</span>
      <button @click="resolve('mine')">Keep mine (overwrite theirs)</button>
      <button @click="resolve('theirs')">Take theirs (discard mine)</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import type { Store } from '../store';
import { richExtensions } from '../richtext/extensions';
import { adoptImagesInHtml, imageFilesOf, imageTag } from '../richtext/paste';
import { isEmptyRichText, richTextError } from '../../contract/richtext';

const props = defineProps<{
  store: Store;
  /**
   * WHICH record this document belongs to — carried by the editor itself, and sent
   * back with every save. The editor also saves as it UNMOUNTS (so closing the tray
   * or jumping to another record never loses words), and by then the panel around
   * it is already showing the NEXT record: a save addressed to "the panel's current
   * record" would write this note onto the wrong one.
   */
  recordId: string;
  fieldKey: string;
  value: unknown;
}>();
const emit = defineEmits<{ set: [recordId: string, key: string, value: unknown]; unset: [recordId: string, key: string] }>();
/** Fixed at mount: `props.recordId` is reactive and must not be trusted during unmount. */
const ownRecordId = props.recordId;

/**
 * A document as a string, for COMPARING — with object keys sorted. The same note
 * arrives in two key orders: as TipTap builds it, and as Postgres returns it (jsonb
 * stores keys sorted by length, then alphabetically). Compared as plain JSON those
 * differ, the editor decides it has unsaved changes the moment a saved value comes
 * back through the stream, and "save" rewrites an identical note.
 */
const json = (v: unknown): string => JSON.stringify(v ?? null, (_k, val) =>
  (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val as object).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
    : val));
/** The saved value this editor last agreed with. Compared with props.value to spot a colleague's save. */
let base = json(props.value);
/** What WE last sent, so our own save echoing back through props is not mistaken for theirs. */
let sent = '';

const focused = ref(false);
const dirty = ref(false);
const uploading = ref(0);
const notice = ref('');
const conflict = ref(false);

const state = computed(() => (uploading.value ? 'uploading' : conflict.value ? 'conflict' : dirty.value ? 'editing' : 'saved'));
const STATE_TEXT = { uploading: 'uploading…', conflict: 'needs your decision', editing: 'editing — saves when you click away', saved: 'saved' } as const;

/* ── height: fixed, yours to change, remembered ── */
const HEIGHT_KEY = 'spatialdb.rte.height';
const readHeight = () => { try { return Math.max(140, Number(localStorage.getItem(HEIGHT_KEY)) || 340); } catch { return 340; } };
const height = ref(readHeight());
const bodyEl = ref<HTMLElement>();
let ro: ResizeObserver | undefined;
onMounted(() => {
  if (!bodyEl.value || typeof ResizeObserver === 'undefined') return;
  // The body is `resize: vertical`; this is how dragging its edge is noticed.
  ro = new ResizeObserver(() => {
    const h = Math.round(bodyEl.value?.offsetHeight ?? 0);
    if (h >= 140 && h !== height.value) { height.value = h; try { localStorage.setItem(HEIGHT_KEY, String(h)); } catch { /* unavailable */ } }
  });
  ro.observe(bodyEl.value);
});

/* ── uploads ── */
const upload = async (file: Blob, name?: string) => {
  uploading.value++;
  try { return await props.store.uploadAsset(file, name); } finally { uploading.value--; }
};
async function insertFiles(files: File[]) {
  for (const f of files) {
    try { editor.value?.chain().focus().insertContent(imageTag(await upload(f, f.name))).run(); }
    catch (e) { notice.value = `Could not upload ${f.name}: ${(e as Error).message}`; }
  }
}

const editor = useEditor({
  content: (props.value as object | undefined) ?? '',
  extensions: richExtensions(props.store.assetUrl, 'Write, or paste an email — screenshots paste in too…'),
  onUpdate: ({ editor: ed }) => { dirty.value = differsFromBase(ed.getJSON()); },
  editorProps: {
    handlePaste(_view, event) {
      const files = imageFilesOf(event.clipboardData);
      const html = event.clipboardData?.getData('text/html') ?? '';
      // A bare screenshot: files and no meaningful HTML.
      if (files.length && !/<(p|div|table|span|br)\b/i.test(html)) { void insertFiles(files); return true; }
      if (/<img\b/i.test(html)) {
        void adoptImagesInHtml(html, upload).then(({ html: clean, dropped, failed }) => {
          editor.value?.chain().focus().insertContent(clean).run();
          const bits = [];
          if (dropped) bits.push(`${dropped} linked image${dropped === 1 ? ' was' : 's were'} not copied — they live on another server; paste a screenshot instead`);
          if (failed) bits.push(`${failed} image${failed === 1 ? '' : 's'} failed to upload`);
          notice.value = bits.join('. ');
        });
        return true;
      }
      return false;   // plain text / imageless HTML: TipTap's own paste is right
    },
    handleDrop(_view, event) {
      const files = imageFilesOf((event as DragEvent).dataTransfer);
      if (!files.length) return false;
      event.preventDefault();
      void insertFiles(files);
      return true;
    },
  },
});
onBeforeUnmount(() => { ro?.disconnect(); commit(); editor.value?.destroy(); });

/** An untouched editor holds an empty paragraph where the saved value is "nothing"; that is not a difference. */
function differsFromBase(doc: unknown) {
  if (json(doc) === base) return false;
  return !(isEmptyRichText(doc) && isEmptyRichText(JSON.parse(base)));
}

/* ── a colleague's save ── */
watch(() => props.value, (v) => {
  const now = json(v);
  if (now === base) return;
  if (now === sent) { base = now; dirty.value = differsFromBase(editor.value?.getJSON()); return; }   // our own save, echoing back
  if (dirty.value) return;                 // you have unsaved words: decided at save time, not now
  base = now;                              // nothing of yours to lose: their version simply appears
  editor.value?.commands.setContent((v as object | undefined) ?? '', { emitUpdate: false });
});

const cmd = () => editor.value!.chain().focus();
const is = (name: string, attrs?: Record<string, unknown>) => editor.value?.isActive(name, attrs) ?? false;
const BUTTONS: Array<{ id: string; label: string; title: string; run: () => void; on?: () => boolean }> = [
  { id: 'b', label: 'B', title: 'Bold (Ctrl+B)', run: () => cmd().toggleBold().run(), on: () => is('bold') },
  { id: 'i', label: 'I', title: 'Italic (Ctrl+I)', run: () => cmd().toggleItalic().run(), on: () => is('italic') },
  { id: 's', label: 'S', title: 'Strikethrough', run: () => cmd().toggleStrike().run(), on: () => is('strike') },
  { id: 'c', label: '<>', title: 'Code', run: () => cmd().toggleCode().run(), on: () => is('code') },
  { id: 'h2', label: 'H2', title: 'Heading', run: () => cmd().toggleHeading({ level: 2 }).run(), on: () => is('heading', { level: 2 }) },
  { id: 'h3', label: 'H3', title: 'Subheading', run: () => cmd().toggleHeading({ level: 3 }).run(), on: () => is('heading', { level: 3 }) },
  { id: 'ul', label: '•', title: 'Bullet list', run: () => cmd().toggleBulletList().run(), on: () => is('bulletList') },
  { id: 'ol', label: '1.', title: 'Numbered list', run: () => cmd().toggleOrderedList().run(), on: () => is('orderedList') },
  { id: 'todo', label: '☐', title: 'Checklist', run: () => cmd().toggleTaskList().run(), on: () => is('taskList') },
  { id: 'q', label: '❝', title: 'Quote', run: () => cmd().toggleBlockquote().run(), on: () => is('blockquote') },
  { id: 'pre', label: '{ }', title: 'Code block', run: () => cmd().toggleCodeBlock().run(), on: () => is('codeBlock') },
  { id: 'hr', label: '―', title: 'Divider', run: () => cmd().setHorizontalRule().run() },
  { id: 'tbl', label: '▦', title: 'Insert a 3×3 table', run: () => cmd().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
];

/** Write, if there is something of yours to write. False = held back (uploading, invalid, or a conflict to settle). */
function commit(force = false): boolean {
  const doc = editor.value?.getJSON();
  if (!doc || !differsFromBase(doc)) { dirty.value = false; return true; }
  if (uploading.value) { notice.value = 'Waiting for uploads to finish…'; return false; }
  if (!force && json(props.value) !== base) { conflict.value = true; return false; }
  if (isEmptyRichText(doc)) {
    sent = json(undefined);
    if (props.value !== undefined) emit('unset', ownRecordId, props.fieldKey);
  } else {
    const err = richTextError(props.fieldKey, doc);
    if (err) { notice.value = err; return false; }
    sent = json(doc);
    emit('set', ownRecordId, props.fieldKey, doc);
  }
  base = sent; dirty.value = false; notice.value = '';
  return true;
}

function resolve(which: 'mine' | 'theirs') {
  conflict.value = false;
  if (which === 'mine') { commit(true); return; }
  base = json(props.value); dirty.value = false;
  editor.value?.commands.setContent((props.value as object | undefined) ?? '', { emitUpdate: false });
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commit(); return; }
  if (e.key === 'Escape') {
    // With unsaved words, Escape means "put it back" and must not also close the
    // tray. With none, let it through: the tray's own Escape closes it.
    if (!dirty.value) { editor.value?.commands.blur(); return; }
    e.preventDefault(); e.stopPropagation();
    dirty.value = false;
    editor.value?.commands.setContent(JSON.parse(base) ?? '', { emitUpdate: false });
    return;
  }
  // Everything else stays in here: the tray, the grid and the canvas all listen for keys.
  e.stopPropagation();
}

/** Focus left the WHOLE editor (not just moved between the text and the toolbar). */
function onFocusOut(e: FocusEvent) {
  const to = e.relatedTarget as Node | null;
  if (to && (e.currentTarget as HTMLElement).contains(to)) return;
  focused.value = false;
  if (!conflict.value) commit();        // the choice is on screen; do not decide for them
}

defineExpose({ commit });
</script>

<style scoped>
.rte { width: 100%; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--border-main); border-radius: 6px; background: var(--controls-bg); }
.rte.focused { border-color: var(--accent); }
.rte-bar {
  display: flex; flex-wrap: wrap; gap: 2px; align-items: center; padding: 4px 6px;
  border-bottom: 1px solid var(--border-main); min-height: 30px; box-sizing: border-box;
}
.rte-bar button {
  background: none; border: 1px solid transparent; color: var(--text-secondary); border-radius: 3px;
  min-width: 24px; height: 22px; padding: 0 5px; cursor: pointer; font: inherit; font-size: 12px;
}
.rte-bar button:hover { border-color: var(--border-main); color: var(--text-primary); }
.rte-bar button.on { color: var(--accent); border-color: var(--accent); }
.spacer { flex: 1; }
/* Fixed slot, so the toolbar does not reflow when the word changes. */
.rte-state { font-size: 11px; color: var(--text-faint); white-space: nowrap; padding: 0 4px; }
.rte-state.editing { color: var(--warning); }
.rte-state.uploading { color: var(--warning); }
.rte-state.conflict { color: var(--danger); }
/* The height is the user's, never the content's: it scrolls inside, and the fields
   below it never move. `resize: vertical` needs a non-visible overflow to work. */
.rte-body { min-height: 140px; max-height: 80vh; overflow-y: auto; resize: vertical; padding: 10px 12px; cursor: text; box-sizing: border-box; }
.rte-body :deep(.ProseMirror) { min-height: 100%; }
.rte-notice { margin: 0; padding: 4px 10px; color: var(--warning); font-size: 11px; border-top: 1px solid var(--border-main); }
.rte-conflict {
  padding: 8px 10px; border-top: 1px solid var(--warning);
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px;
}
.rte-conflict button { background: none; border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; }
</style>
