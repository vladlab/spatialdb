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
    - a status word in the toolbar — saved · unsaved · uploading — says what state
      your words are in, since nothing else on screen changes when they are saved.

  SAVING is a BUTTON. It used to happen on the way out (click or tab away), and
  the owner found that always felt wrong: clicking another field is not a decision
  to save. Now a Save button shows in the toolbar while there are unsaved words
  (its slot is always reserved, so nothing shifts when it appears), and Ctrl+Enter
  does the same. Leaving the editor saves nothing; the words stay, marked unsaved.
  Escape puts back what was last saved. Still whole-value: a document is one field
  value, a save is one logged, broadcast mutation carrying all of it.

  The one exception is the editor going AWAY (closing the tray, opening another
  record): it still saves then, because the alternative is losing the words with
  no way to get them back.

  TWO PEOPLE, ONE NOTE. Last write wins, but never silently:
    - not editing (no unsaved words of yours): a colleague's save simply appears;
    - editing: their version is NOT pushed into your editor while you type. When
      you save, the editor sees the value changed underneath it and stops to ask —
      keep yours (overwriting theirs) or take theirs (discarding yours).

  AS A PAGE (`page`, NotePage.vue): the same editor filling a browser tab. What
  changes is only the box: no border, no fixed height — the PAGE scrolls, and the
  context line and the toolbar stay at its top — and the text sits in a centred
  column at a reading size. Saving, conflicts, paste and uploads are this file's,
  unchanged; that is the reason the page is a mode of this component and not a
  second editor. The `context` slot is the page's "which note is this" line; the
  state word and Save move up beside it.

  IMAGES go to the asset store on paste or drop and become asset-backed nodes
  (richtext/extensions.ts, richtext/paste.ts). Saving waits for uploads in flight.
-->
<template>
  <!-- @click.stop: this lives inside the panel's field area, which has click handlers of its own. -->
  <div class="rte" :class="{ focused, dirty, page }" @keydown.capture="onSaveKey" @keydown="onKey" @focusout="onFocusOut" @focusin="focused = true" @click.stop>
    <!-- One block, so that on a page the context line and the toolbar stick together. -->
    <div class="rte-top">
      <div v-if="page" class="rte-context">
        <slot name="context" />
        <span class="spacer" />
        <span class="rte-state" :class="state">{{ STATE_TEXT[state] }}</span>
        <button class="rte-save" :class="{ shown: dirty && !conflict }" :disabled="!dirty || conflict || !!uploading"
                tabindex="-1" title="Save (Ctrl+Enter)" @mousedown.prevent @click="commit()">Save</button>
      </div>
      <div class="rte-bar" @mousedown.prevent>
        <button v-for="b in BUTTONS" :key="b.id" :class="{ on: b.on?.() }" :title="b.title" tabindex="-1" @click="b.run">{{ b.label }}</button>
        <!-- A table's SCALE (richtext/tableScale.ts), only while the cursor is in one. Its
             space is always held, so the bar does not reflow as the cursor moves. -->
        <span class="rte-table" :class="{ shown: !!inTable }" title="This table's size — pasted tables are often huge">
          <button class="tbl-smaller" tabindex="-1" :disabled="!inTable || inTable.scale <= TABLE_SCALES[0]" title="Make this table smaller" @click="stepTableScale(editor, -1)">−</button>
          <span class="tbl-scale">{{ Math.round((inTable?.scale ?? 1) * 100) }}%</span>
          <button class="tbl-larger" tabindex="-1" :disabled="!inTable || inTable.scale >= 1" title="Make this table larger (up to full size)" @click="stepTableScale(editor, 1)">+</button>
        </span>
        <template v-if="!page">
          <span class="spacer" />
          <span class="rte-state" :class="state">{{ STATE_TEXT[state] }}</span>
          <!-- Always in the bar, only VISIBLE with something to save: its space is held,
               so the bar never reflows when it shows. -->
          <button class="rte-save" :class="{ shown: dirty && !conflict }" :disabled="!dirty || conflict || !!uploading"
                  tabindex="-1" title="Save (Ctrl+Enter)" @click="commit()">Save</button>
        </template>
      </div>
    </div>

    <div ref="bodyEl" class="rte-body" :style="page ? undefined : { height: height + 'px' }" @click="editor?.commands.focus()">
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
import { HeadingFolds } from '../richtext/folds';
import { stepTableScale, tableAtCursor, TABLE_SCALES } from '../richtext/tableScale';

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
  /** Fill a page instead of sitting in a box (NotePage.vue) — see the note at the top. */
  page?: boolean;
}>();
const emit = defineEmits<{ set: [recordId: string, key: string, value: unknown]; unset: [recordId: string, key: string]; dirty: [dirty: boolean] }>();
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
    // …and without keys that hold null: an attribute the schema gained since a note
    // was saved (a table's `scale`) comes out of the editor as null and is simply
    // absent in the saved note. Those are the same note.
    ? Object.fromEntries(Object.keys(val as object).sort().filter((k) => (val as Record<string, unknown>)[k] !== null).map((k) => [k, (val as Record<string, unknown>)[k]]))
    : val));
/**
 * A document without the empty paragraph the editor keeps after a last block that is
 * not text (a table, a heading), so there is somewhere to click below it. The editor
 * adds it on the first transaction of any kind — a click, a fold — and a note that
 * merely gained it has not been edited.
 */
function tailless(v: unknown): unknown {
  const d = v as { type?: string; content?: Array<{ type?: string; content?: unknown[] }> } | null;
  const c = d?.content;
  if (!d || d.type !== 'doc' || !c || c.length < 2) return v;
  const last = c[c.length - 1];
  return last.type === 'paragraph' && !last.content?.length ? { ...d, content: c.slice(0, -1) } : v;
}
/** The saved value this editor last agreed with. Compared with props.value to spot a colleague's save. */
let base = json(props.value);
/** What WE last sent, so our own save echoing back through props is not mistaken for theirs. */
let sent = '';

const focused = ref(false);
const dirty = ref(false);
const uploading = ref(0);
const notice = ref('');
const conflict = ref(false);

// For whoever hosts the editor: a page warns before its tab is closed on unsaved words.
watch(dirty, (d) => emit('dirty', d));

const state = computed(() => (uploading.value ? 'uploading' : conflict.value ? 'conflict' : dirty.value ? 'editing' : 'saved'));
const STATE_TEXT = { uploading: 'uploading…', conflict: 'needs your decision', editing: 'unsaved', saved: 'saved' } as const;

/* ── height: fixed, yours to change, remembered ── */
const HEIGHT_KEY = 'spatialdb.rte.height';
const readHeight = () => { try { return Math.max(140, Number(localStorage.getItem(HEIGHT_KEY)) || 340); } catch { return 340; } };
const height = ref(readHeight());
const bodyEl = ref<HTMLElement>();
let ro: ResizeObserver | undefined;
onMounted(() => {
  if (props.page || !bodyEl.value || typeof ResizeObserver === 'undefined') return;   // a page has no height of its own
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
  extensions: [
    ...richExtensions(props.store.assetUrl, 'Write, or paste an email — screenshots paste in too…'),
    // Heading folds are the EDITOR's and this browser's (richtext/folds.ts), remembered per note.
    HeadingFolds.configure({ noteKey: `${props.recordId}:${props.fieldKey}` }),
  ],
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
  if (json(doc) === base || json(tailless(doc)) === json(tailless(JSON.parse(base)))) return false;
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

/** The table the cursor is in, for the scale control. Read in the template, which re-renders on every transaction. */
const inTable = computed(() => tableAtCursor(editor.value));
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

/**
 * Ctrl+Enter saves — caught on the way DOWN (capture), before the editor sees it.
 * Caught on the way up, as it was, the editor had already acted on the key: to it
 * Ctrl+Enter is "line break", so every keyboard save also added an empty line where
 * the cursor stood, and saved that.
 */
function onSaveKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); commit(); }
}
function onKey(e: KeyboardEvent) {
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
  focused.value = false;                // and nothing else: leaving is not saving (the Save button is)
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
.rte-table { visibility: hidden; display: inline-flex; align-items: center; gap: 1px; margin-left: 6px; padding-left: 6px; border-left: 1px solid var(--border-main); }
.rte-table.shown { visibility: visible; }
.rte-table button:disabled { opacity: 0.35; cursor: default; }
.tbl-scale { font-size: 11px; color: var(--text-secondary); min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }
/* Room in the left margin for a heading's fold chevron (richtext/folds.ts). */
.rte-bar .rte-save, .rte-context .rte-save {
  visibility: hidden; color: var(--on-accent); background: var(--accent); border-color: var(--accent);
  padding: 0 10px; margin-left: 2px; font-weight: 600;
}
.rte .rte-save.shown { visibility: visible; }
.rte .rte-save:hover:not(:disabled) { color: var(--on-accent); filter: brightness(1.1); }
.rte .rte-save:disabled { cursor: default; opacity: 0.6; }
/* Fixed slot, so the toolbar does not reflow when the word changes. */
.rte-state { font-size: 11px; color: var(--text-faint); white-space: nowrap; padding: 0 4px; }
.rte-state.editing { color: var(--warning); }
.rte-state.uploading { color: var(--warning); }
.rte-state.conflict { color: var(--danger); }
/* The height is the user's, never the content's: it scrolls inside, and the fields
   below it never move. `resize: vertical` needs a non-visible overflow to work. */
.rte-body { min-height: 140px; max-height: 80vh; overflow-y: auto; resize: vertical; padding: 10px 12px 10px 24px; cursor: text; box-sizing: border-box; }
.rte-body :deep(.ProseMirror) { min-height: 100%; }
.rte-notice { margin: 0; padding: 4px 10px; color: var(--warning); font-size: 11px; border-top: 1px solid var(--border-main); }
.rte-conflict {
  padding: 8px 10px; border-top: 1px solid var(--warning);
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px;
}

/* ── as a page (NotePage.vue) ──────────────────────────────────────────────
   The box comes off: the page behind is the paper, the page scrolls, and the two
   lines at the top stay put. `--note-col` is the reading column; `--note-gap` is
   what is left of the page on either side of it (never less than the page's own
   padding), so the toolbar's first button and the text's left edge share a line. */
.rte.page {
  --note-col: 750px; --note-pad: 28px;
  --note-gap: max(var(--note-pad), calc((100% - var(--note-col)) / 2));
  border: none; border-radius: 0; background: none; min-height: 100%;
}
.rte.page .rte-top { position: sticky; top: 0; z-index: 5; background: var(--bg-chrome); border-bottom: 1px solid var(--border-main); }
.rte-context {
  display: flex; align-items: center; gap: 6px; height: 38px; box-sizing: border-box; padding: 0 12px;
  border-bottom: 1px solid var(--line-soft); min-width: 0;
}
.rte-context .rte-save {
  border: 1px solid var(--accent); border-radius: 3px; height: 24px; cursor: pointer; font: inherit; font-size: 12px;
}
/* less the 8px a button keeps around its glyph: the B sits over the text's left edge */
.rte.page .rte-bar { border-bottom: none; padding: 5px calc(var(--note-gap) - 8px); }
.rte.page .rte-bar button { min-width: 28px; height: 26px; font-size: 13px; }
.rte.page .rte-body { min-height: 0; max-height: none; overflow: visible; resize: none; flex: 1; padding: 36px 0 45vh; }
.rte.page .rte-notice, .rte.page .rte-conflict { position: sticky; bottom: 0; background: var(--bg-chrome); padding-left: var(--note-gap); padding-right: var(--note-gap); }
/* The text: a reading size, in the column. Every top-level block is held to the
   column and centred in the page… */
.rte.page .rte-body :deep(.ProseMirror) { font-size: 15px; line-height: 1.65; min-height: 40vh; }
.rte.page .rte-body :deep(.ProseMirror > *) { max-width: var(--note-col); margin-left: var(--note-gap); margin-right: var(--note-gap); }
.rte.page .rte-body :deep(.ProseMirror h1) { font-size: 24px; }
.rte.page .rte-body :deep(.ProseMirror h2) { font-size: 20px; }
.rte.page .rte-body :deep(.ProseMirror h3) { font-size: 17px; }
.rte.page .rte-body :deep(.ProseMirror code) { font-size: 13.5px; }
/* …except what is allowed to be WIDER than the text. A table is as wide as its
   columns need, up to the page, centred — but never narrower than the column, so a
   small one still starts on the text's left edge. An image starts on that edge and
   may run on to the right as far as the page goes. */
.rte.page .rte-body :deep(.ProseMirror > table), .rte.page .rte-body :deep(.ProseMirror > .tableWrapper) {
  width: fit-content; min-width: min(var(--note-col), calc(100% - 2 * var(--note-pad))); max-width: calc(100% - 2 * var(--note-pad));
  margin-left: auto; margin-right: auto;
}
.rte.page .rte-body :deep(.ProseMirror > img) { max-width: calc(100% - var(--note-gap) - var(--note-pad)); margin-right: var(--note-pad); }
.rte-conflict button { background: none; border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; }
</style>
