<!--
  A CANVAS NOTE (CANVAS-BRIEF.md D1–D3): a rich_text field with `canvasNote` — quick
  notes typed right on a card, with lists and checklists and nothing heavier
  (contract/richtext.ts NOTE_NODES). One component for the card and the tray.

  READING (every card): the note drawn from its value. A CHECKBOX works here, with no
  editing at all — one click, one record.update, one Ctrl+Z (`toggleTask`).

  TYPING (`editing`): a live editor in place — mounted only for the note being typed
  in (a canvas of fifty cards has one editor, not fifty). It SAVES AS YOU TYPE: about
  a second after typing stops, and at once when the caret leaves. One typing SESSION
  is ONE undo step (the owner, Nov 14 2026): the first save of a session is an
  ordinary step — it remembers the note as it was before — and the saves after it
  are not steps at all. So Ctrl+Z after leaving the note puts back what was there
  before you started; inside the note, Ctrl+Z is the editor's own word-by-word undo.

  The status in the label line ("saving…", "saved", "changed elsewhere") has its
  room kept whether it shows or not, so nothing moves. A colleague's save arriving
  while you type does not replace the words under your caret — it is said, and the
  last save wins (the owner accepted that for notes).
-->
<template>
  <div class="cn" :class="{ editing: live, tray: mode === 'tray' }" @pointerdown="onPointerDown" @click="onClick"
       @keydown="live ? onKey($event) : undefined" @wheel="live && $event.stopPropagation()" @dblclick="live && $event.stopPropagation()">
    <div class="cn-label">
      <span class="cn-name">{{ name }}</span>
      <span class="cn-state" :class="state" aria-live="polite">{{ STATE_WORDS[state] }}</span>
    </div>
    <div class="cn-body">
      <EditorContent v-if="live && editor" :editor="editor" class="cn-editor" />
      <div v-else-if="!empty" class="rich cn-read" v-html="html" />
      <div v-else class="cn-empty">{{ placeholder }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import { generateHTML } from '@tiptap/core';
import type { Store } from '../store';
import { noteExtensions } from '../richtext/extensions';
import { isEmptyRichText, richTextError, toggleTask } from '../../contract/richtext';

const props = withDefaults(defineProps<{
  store: Store; recordId: string; fieldKey: string; name: string; value: unknown;
  /** The card's note: typed in only once `editing` is handed to it. The tray's: always editable. */
  mode?: 'card' | 'tray';
  editing?: boolean;
  /** The card is selected (alone): only then does a click type here — the first click on a card selects it. Read at the PRESS. */
  armed?: boolean;
}>(), { mode: 'card', editing: false, armed: false });
/** `done`: the caret left (Esc, a click away) — the card stops editing. `start`: a click asked to type here. */
const emit = defineEmits<{ done: []; start: [] }>();

const placeholder = 'Type a note…';
const STATE_WORDS = { idle: '', saving: 'saving…', saved: 'saved', elsewhere: 'changed elsewhere' } as const;
const empty = computed(() => isEmptyRichText(props.value));
const viewExtensions = noteExtensions();
const html = computed(() => {
  try { return props.value ? generateHTML(props.value as Parameters<typeof generateHTML>[0], viewExtensions) : ''; }
  catch { return '<p><em>This note could not be displayed.</em></p>'; }
});

/* ── one key per value, for comparing ours with what comes back ── */
const json = (v: unknown) => JSON.stringify(v ?? null, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().filter((k) => (val as Record<string, unknown>)[k] !== null).map((k) => [k, (val as Record<string, unknown>)[k]])) : val));

/* ── saving ── */
const editor = shallowRef<Editor | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
/** In this session: has the first (undoable) save been made? */
const savedInSession = ref(false);
/** What we last wrote — its echo through the stream is not "changed elsewhere". */
let sent: string | null = null;
const unsaved = ref(false);
/** "saved" stays said for a moment after the last save — after the editor has closed too. */
const showSaved = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;
const elsewhere = ref(false);
const state = computed(() => (elsewhere.value ? 'elsewhere'
  : unsaved.value || props.store.unconfirmed.value.has(props.recordId) ? 'saving'
  : showSaved.value ? 'saved' : 'idle'));

function write(doc: unknown, undoable: boolean) {
  const empty = isEmptyRichText(doc);
  if (!empty && richTextError(props.fieldKey, doc, { canvasNote: true })) return;   // the editor cannot make one; never send what the server refuses
  sent = json(empty ? undefined : doc);
  props.store.mutate(empty
    ? { type: 'record.update', id: props.recordId, set: {}, unset: [props.fieldKey] }
    : { type: 'record.update', id: props.recordId, set: { [props.fieldKey]: doc }, unset: [] }, { undoable });
}
/** Save now, if there is anything of ours not yet written. */
function flush() {
  clearTimeout(timer); timer = undefined;
  if (!unsaved.value || !editor.value) return;
  const doc = editor.value.getJSON();
  unsaved.value = false;
  if (json(isEmptyRichText(doc) ? undefined : doc) === json(isEmptyRichText(props.value) ? undefined : props.value)) return;
  write(doc, !savedInSession.value);       // ONE step per session: only the first save is one
  savedInSession.value = true;
  showSaved.value = true; clearTimeout(savedTimer); savedTimer = setTimeout(() => { showSaved.value = false; }, 2500);
}

/* ── the editor: made when typing starts, destroyed when it ends ── */
function startEditing() {
  if (editor.value) return;
  savedInSession.value = false; elsewhere.value = false;
  editor.value = new Editor({
    content: (props.value as object | undefined) ?? '',
    extensions: noteExtensions(placeholder),
    onUpdate: () => { unsaved.value = true; clearTimeout(timer); timer = setTimeout(flush, 1000); },
    onBlur: () => { flush(); if (props.mode === 'card') emit('done'); else endSession(); },
  });
  // On a card, typing starts where the click was asked for it: put the caret in. The
  // tray's editor is always there and must not take the focus from whatever has it.
  if (props.mode === 'card') void nextTick(() => editor.value?.commands.focus('end'));
}
function endSession() { flush(); savedInSession.value = false; elsewhere.value = false; }
function stopEditing() {
  flush();
  editor.value?.destroy(); editor.value = null;
  savedInSession.value = false; elsewhere.value = false;
}
watch(() => props.editing || props.mode === 'tray', (on) => (on ? startEditing() : stopEditing()), { immediate: true });
onBeforeUnmount(() => { stopEditing(); clearTimeout(savedTimer); });

/** A save of someone else's arriving while the editor is open. */
watch(() => props.value, (v) => {
  if (!editor.value) return;
  const now = json(v);
  if (now === sent) return;                                            // our own, echoing back
  if (unsaved.value || editor.value.isFocused) { elsewhere.value = true; return; }   // never under the caret
  editor.value.commands.setContent((v as object | undefined) ?? '', { emitUpdate: false });
});

/* ── input ── */
let downAt: { x: number; y: number } | null = null;
let armedAtDown = false;
function onPointerDown(e: PointerEvent) {
  // While typing, the pointer is the editor's: the card must not start a drag.
  if (live.value) { e.stopPropagation(); return; }
  // A checkbox, read-only: ticked by its click below — the press must not drag the card.
  if ((e.target as HTMLElement).closest('input[type="checkbox"]')) { e.stopPropagation(); return; }
  downAt = { x: e.clientX, y: e.clientY };
  armedAtDown = props.armed;
}
function onClick(e: MouseEvent) {
  if (live.value) return;
  // A link in a note is read here, not followed: the record tray or the note page opens it.
  if ((e.target as HTMLElement).closest('a')) e.preventDefault();
  const box = (e.target as HTMLElement).closest('input[type="checkbox"]') as HTMLInputElement | null;
  if (box) {
    e.preventDefault(); e.stopPropagation();
    const all = [...(e.currentTarget as HTMLElement).querySelectorAll('.cn-read input[type="checkbox"]')];
    const next = toggleTask(props.value, all.indexOf(box));
    if (next !== props.value) write(next, true);
    return;
  }
  // A click — a press and release that did not travel — asks to type here. Whether it
  // may (only on a card that is already selected) is the canvas's to say.
  if (!armedAtDown || (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4)) return;
  emit('start');
}
function onKey(e: KeyboardEvent) {
  // Nothing typed here reaches the canvas — Space is a space, Z a letter, Delete deletes text.
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); flush(); editor.value?.commands.blur(); if (props.mode === 'card') emit('done'); }
}
/** An editor is open on this note (`editing` is the card's REQUEST; the tray's is always open). */
const live = computed(() => !!editor.value);

defineExpose({ flush });
</script>

<style scoped>
.cn { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.cn-label { flex: none; display: flex; justify-content: space-between; gap: 6px; height: var(--rich-label-h, 16px); line-height: var(--rich-label-h, 16px);
  color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.cn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Its room is kept even empty: nothing moves when it appears. */
.cn-state { flex: none; min-width: 9em; text-align: right; text-transform: none; letter-spacing: 0; font-style: italic; }
.cn-state.elsewhere { color: var(--warning); font-style: normal; }
.cn-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; border-top: 1px solid var(--card-border); padding: 3px 2px 0; font-size: 12px; cursor: text; }
.tray .cn-body { min-height: 80px; max-height: 320px; border: 1px solid var(--border-main); border-radius: 6px; padding: 6px 8px; background: var(--bg-app); }
.editing .cn-body { box-shadow: inset 0 0 0 1px var(--accent); border-radius: 3px; }
.cn-empty { color: var(--text-faint); font-style: italic; }
.cn-body :deep(p) { margin: 0 0 2px; }
.cn-body :deep(ul), .cn-body :deep(ol) { margin: 0 0 2px; padding-left: 18px; }
.cn-body :deep(ul[data-type="taskList"]) { list-style: none; padding-left: 2px; }
.cn-body :deep(li[data-type="taskItem"]) { display: flex; gap: 6px; align-items: flex-start; }
.cn-body :deep(li[data-type="taskItem"] > label) { flex: none; margin-top: 1px; }
.cn-body :deep(li[data-type="taskItem"] > div) { flex: 1; min-width: 0; }
.cn-body :deep(li[data-checked="true"] > div) { color: var(--text-muted); text-decoration: line-through; }
.cn-body :deep(input[type="checkbox"]) { cursor: pointer; margin: 0; accent-color: var(--accent); }
.cn-body :deep(.ProseMirror) { outline: none; min-height: 1.4em; }
.cn-body :deep(.ProseMirror p.is-editor-empty:first-child::before) { content: attr(data-placeholder); color: var(--text-faint); float: left; height: 0; pointer-events: none; font-style: italic; }
</style>
